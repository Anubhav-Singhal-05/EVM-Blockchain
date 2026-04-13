/**
 * upload_votes.js  —  Bridge: Middleware API → Blockchain
 * ----------------------------------------------------------
 * Fetches completed vote records from the Middleware Voting Software
 * (Device 2) via its REST API, performs two-layer RSA decryption,
 * verifies fingerprints against the Global MongoDB DB (Atlas),
 * and calls castVote() on the local Ganache blockchain for votes
 * that pass verification.
 *
 * ┌──────────────┐   HTTP GET    ┌──────────────────────┐
 * │  Middleware  │ ◄──────────── │  Blockchain Machine  │
 * │  (Device 2)  │   export API  │      (Device 3)      │
 * │  MySQL DB    │ ─────────────►│  upload_votes.js     │
 * └──────────────┘  { records }  │        │             │
 *                                │  decrypt E2  (base64)│
 *                                │   → uid, H1, ts2     │
 *                                │  decrypt H1  (hex)   │
 *                                │   → v, f1, f2, ts1   │
 * ┌──────────────┐               │  B64→bytes matching  │
 * │ MongoDB Atlas│ ◄─────────────│  verify fingerprints │
 * │  Global DB   │ ─────────────►│        │             │
 * └──────────────┘  f1_g, f2_g   │  castVote() ─────────┼──► Ganache
 *                                └──────────────────────┘
 *
 * ENCRYPTION FORMATS:
 *   E2 (H2):  Middleware RSA  → base64( comma-sep decimal ciphertext )
 *             Plaintext:  uid || H1_hex || TS2          (separator: "||")
 *
 *   H1 (E1):  ESP32 RSA      → concatenated 4-char UPPERCASE HEX blocks
 *             Plaintext:  v | f1_b64 | f2_b64 | ts1    (separator: "|")
 *             (vote is padded to 15 chars)
 *
 * FINGERPRINT MATCHING:
 *   Both the ESP32-sent fingerprints (inside H1) and the stored
 *   global DB fingerprints are Base64-encoded raw byte arrays from
 *   the AS608 sensor. We decode both to raw Buffers and compare
 *   bit-by-bit using inverted Hamming distance.
 *
 * CONFIGURATION (in .env):
 *   MIDDLEWARE_API_URL  - Base URL of the Middleware backend
 *                         e.g. http://192.168.1.10:5000
 *   MIDDLEWARE_API_KEY  - Shared secret for X-API-Key header
 *   GLOBAL_DB_API_URL   - Base URL of the local global-db service
 *                         e.g. http://localhost:3000
 *   GANACHE_URL         - Local Ganache RPC (default: http://127.0.0.1:7545)
 *   FP_THRESHOLD        - Fingerprint match % required (default: 80)
 *
 * Usage:
 *   node scripts/upload_votes.js
 */

require("dotenv").config();
const https = require("https");
const http = require("http");
const Web3 = require("web3");
const path = require("path");

const { connectGlobalDB, disconnectGlobalDB, getVoterFingerprints } = require("./global_db");

// ── Config ────────────────────────────────────────────────────────────

const MIDDLEWARE_API_URL = (process.env.MIDDLEWARE_API_URL || "").replace(/\/$/, "");
const MIDDLEWARE_API_KEY = process.env.MIDDLEWARE_API_KEY || "";
const GANACHE_URL = process.env.GANACHE_URL || "http://127.0.0.1:7545";
const FP_THRESHOLD = Number(process.env.FP_THRESHOLD ?? 80);

// ── RSA constants (same toy RSA used by ESP32 and Middleware) ─────────

const RSA_N = 3233;   // p=61, q=53
const RSA_D = 2753;   // private exponent

/**
 * Modular exponentiation using BigInt (handles large numbers safely).
 */
function modPow(base, exp, mod) {
  let result = 1n;
  base = BigInt(base) % BigInt(mod);
  exp = BigInt(exp);
  mod = BigInt(mod);
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return Number(result);
}

// ── E2 (H2) Decryption ────────────────────────────────────────────────
// E2 format: base64( comma-separated decimal RSA ciphertext )
// Produced by Middleware's rsa.js → encryptToHash(plaintext)
// Plaintext structure: uid || H1_hex || ts2   (separator = "||")

/**
 * Decrypt an E2 / H2 blob produced by the Middleware.
 *
 * @param {string} hash2Base64 - The base64-encoded ciphertext from DB2
 * @returns {{ uid: string, h1Hex: string, ts2: string }}
 */
function decryptE2(hash2Base64) {
  // 1. base64 → "c1,c2,c3,..." → array of numbers
  const commaSep = Buffer.from(hash2Base64, "base64").toString("utf8");
  const cipherNums = commaSep.split(",").map(Number);

  // 2. RSA decrypt each number → character
  const plaintext = cipherNums
    .map(c => String.fromCharCode(modPow(c, RSA_D, RSA_N)))
    .join("");

  // 3. Split on "||" — structure: uid || H1_hex || ts2
  const parts = plaintext.split("||");
  if (parts.length < 3) {
    throw new Error(
      `E2 plaintext has ${parts.length} parts (expected 3). ` +
      `Preview: "${plaintext.slice(0, 80)}..."`
    );
  }

  return {
    uid: parts[0],
    h1Hex: parts[1],          // This is the raw H1 hex string from the ESP
    ts2: parts.slice(2).join("||"),  // ts2 is the remainder (ISO-8601)
  };
}

// ── H1 (E1) Decryption ────────────────────────────────────────────────
// H1 format: concatenated 4-char UPPERCASE HEX blocks
// Produced by ESP32's sprintf("%04X", rsa_encrypt(char))
// Plaintext structure: v(padded 15) | f1_b64 | f2_b64 | ts1
//                      (separator = "|")

/**
 * Decrypt an H1 blob produced by the ESP32.
 *
 * @param {string} h1Hex - Concatenated 4-char hex blocks (e.g. "020C0755...")
 * @returns {{ vote: string, f1: string, f2: string, ts1: string }}
 */
function decryptH1(h1Hex) {
  if (!h1Hex || h1Hex.length % 4 !== 0) {
    throw new Error(
      `H1 hex string has invalid length ${h1Hex?.length}. ` +
      `Must be a multiple of 4.`
    );
  }

  // Parse into 4-char chunks → decimal → RSA decrypt → char
  const plaintext = [];
  for (let i = 0; i < h1Hex.length; i += 4) {
    const hexChunk = h1Hex.slice(i, i + 4);
    const cipherVal = parseInt(hexChunk, 16);
    const charCode = modPow(cipherVal, RSA_D, RSA_N);
    plaintext.push(String.fromCharCode(charCode));
  }
  const plain = plaintext.join("");

  // Split on "|" (single pipe) — structure: vote(padded) | f1 | f2 | ts1
  const parts = plain.split("|");
  if (parts.length < 4) {
    throw new Error(
      `H1 plaintext has ${parts.length} fields (expected ≥4). ` +
      `Preview: "${plain.slice(0, 80)}..."`
    );
  }

  // vote is padded to 15 chars — trim trailing spaces
  const vote = parts[0].trimEnd();
  const f1 = parts[1];
  const f2 = parts[2];
  // ts1 can contain "|" theoretically; join remaining parts
  const ts1 = parts.slice(3).join("|");

  return { vote, f1, f2, ts1 };
}

// ── Fingerprint Matching ──────────────────────────────────────────────
// Both f1/f2 (from H1) and f1_g/f2_g (from Global DB) are
// Base64-encoded raw byte arrays captured by the AS608 sensor.
// We decode both to raw Buffers and compare using inverted Hamming distance.

/**
 * Count set bits (popcount) in a byte.
 * @param {number} byte
 * @returns {number}
 */
function popcount(byte) {
  let count = 0;
  let x = byte & 0xFF;
  while (x) { count += x & 1; x >>>= 1; }
  return count;
}

/**
 * Compute byte-level similarity via inverted Hamming distance.
 * @param {Buffer} buf1
 * @param {Buffer} buf2
 * @returns {number} 0–100
 */
function byteSimilarity(buf1, buf2) {
  const len = Math.min(buf1.length, buf2.length);
  if (len === 0) return 0;
  let matchingBits = 0;
  for (let i = 0; i < len; i++) {
    matchingBits += (8 - popcount(buf1[i] ^ buf2[i]));
  }
  return (matchingBits / (len * 8)) * 100;
}

/**
 * Decode a Base64 fingerprint string → raw Buffer of bytes.
 * The ESP32 encodes the raw AS608 sensor bytes as Base64 before sending.
 *
 * @param {string} b64 - Base64 string
 * @returns {Buffer}
 */
function fingerprintToBuffer(b64) {
  if (!b64 || typeof b64 !== "string") {
    throw new Error("Fingerprint is null/undefined or not a string");
  }
  return Buffer.from(b64, "base64");
}

/**
 * Match two Base64 fingerprints by decoding to raw bytes first.
 *
 * @param {string} fp1b64 - Fingerprint from ESP32 (via H1 decryption)
 * @param {string} fp2b64 - Registered fingerprint from Global DB
 * @returns {number} Similarity score 0–100
 */
function matchFingerprints(fp1b64, fp2b64) {
  if (!fp1b64 || !fp2b64) return 0;

  let buf1, buf2;
  try {
    buf1 = fingerprintToBuffer(fp1b64);
    buf2 = fingerprintToBuffer(fp2b64);
  } catch {
    // Fallback: exact string equality (for mock/test data)
    return fp1b64 === fp2b64 ? 100 : 0;
  }

  // If the decoded buffers are too small, it's probably mock/test data
  if (buf1.length < 10 || buf2.length < 10) {
    console.log(`    [FP] Warning: Buffer too small (${buf1.length}B / ${buf2.length}B) — using exact match`);
    return fp1b64 === fp2b64 ? 100 : 0;
  }

  const score = byteSimilarity(buf1, buf2);
  return score;
}

/**
 * Verify a voter's two fingerprints against both registered ones.
 * Either finger matching above the threshold is sufficient.
 *
 * @param {string} f1     - Primary fingerprint from H1 (base64)
 * @param {string} f2     - Secondary fingerprint from H1 (base64)
 * @param {string} f1_g   - Registered primary FP from Global DB (base64)
 * @param {string} f2_g   - Registered secondary FP from Global DB (base64)
 * @param {number} [threshold]
 * @returns {{ passed: boolean, score1: number, score2: number }}
 */
function verifyFingerprints(f1, f2, f1_g, f2_g, threshold = FP_THRESHOLD) {
  const score1 = matchFingerprints(f1, f1_g);
  const score2 = matchFingerprints(f2, f2_g);
  const passed = score1 > threshold || score2 > threshold;
  return { passed, score1, score2 };
}

// ── HTTP helper ───────────────────────────────────────────────────────

/**
 * Simple GET → parsed JSON helper. Works with http:// and https://.
 */
function getJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const options = { headers };

    const req = lib.get(url, options, (res) => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 401) {
          return reject(new Error("Middleware API: 401 Unauthorized — check MIDDLEWARE_API_KEY"));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`API: invalid JSON — ${data.slice(0, 100)}`)); }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("API request timed out after 15s"));
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  if (!MIDDLEWARE_API_URL) {
    console.error(
      "[ERROR] MIDDLEWARE_API_URL is not set in .env\n" +
      "        e.g. MIDDLEWARE_API_URL=http://192.168.1.10:5000"
    );
    process.exit(1);
  }

  // ── Step 1: Fetch completed vote records ──────────────────────────
  const exportUrl = `${MIDDLEWARE_API_URL}/api/voters/export-for-blockchain`;
  console.log(`[Middleware API] Fetching records from: ${exportUrl}`);

  let apiResponse;
  try {
    apiResponse = await getJSON(exportUrl, {
      "X-API-Key": MIDDLEWARE_API_KEY,
      "Content-Type": "application/json",
    });
  } catch (err) {
    console.error(`[Middleware API] ✗ ${err.message}`);
    process.exit(1);
  }

  const records = apiResponse.records || [];
  console.log(`[Middleware API] Received ${records.length} completed vote record(s).\n`);

  if (records.length === 0) {
    console.log("Nothing to upload. Ask the voting official to process votes first.");
    return;
  }

  // ── Step 2: Connect to Global DB ─────────────────────────────────
  console.log("[GlobalDB] Connecting to voting-global-db...");
  await connectGlobalDB();
  console.log("[GlobalDB] Connected.\n");

  // ── Step 3: Connect to Ganache / VotingContract ───────────────────
  const web3 = new Web3(GANACHE_URL);
  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const networkId = await web3.eth.net.getId();

  const contractJson = require(path.join(__dirname, "..", "build", "contracts", "VotingContract.json"));
  const deployed = contractJson.networks[networkId];

  if (!deployed) {
    console.error(
      `[ERROR] VotingContract not deployed on Ganache network ${networkId}.\n` +
      `        Run: npx truffle migrate --network development`
    );
    await disconnectGlobalDB();
    process.exit(1);
  }

  const contract = new web3.eth.Contract(contractJson.abi, deployed.address);
  console.log(`[Blockchain] Contract  : ${deployed.address}`);
  console.log(`[Blockchain] Owner     : ${owner}`);
  console.log(`[Blockchain] Threshold : ${FP_THRESHOLD}%\n`);
  console.log(`${"─".repeat(65)}`);

  // ── Step 4: Process each record ───────────────────────────────────
  let uploaded = 0, rejected = 0, skipped = 0, errored = 0;

  for (const row of records) {
    const { uid: rowUid, hash2, voterName } = row;
    const rowLabel = `${rowUid} (${voterName || "unknown"})`;

    // ── 4a. Decrypt E2 (H2) — produced by Middleware ─────────────
    let uid, h1Hex, ts2;
    try {
      ({ uid, h1Hex, ts2 } = decryptE2(hash2));
    } catch (err) {
      console.log(`  ✗ ${rowLabel} — E2 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    const label = `${uid} (${voterName || "unknown"})`;

    // ── 4b. Check on-chain duplicate before expensive operations ──
    // The VotingContract has a require(!exists) guard but we check
    // here first to give a clear "already on-chain" message and
    // skip fingerprint verification entirely.
    try {
      const onChainRecord = await contract.methods.getVote(uid).call().catch(() => null);
      if (onChainRecord && onChainRecord.vid) {
        console.log(`  ⚠ ${label} — Already on-chain. Skipping.`);
        skipped++;
        console.log();
        continue;
      }
    } catch {
      // getVote reverts if not found — that is fine, continue processing
    }

    // ── 4c. Decrypt H1 (E1) — produced by ESP32 ──────────────────
    let vote, f1, f2, ts1;
    try {
      ({ vote, f1, f2, ts1 } = decryptH1(h1Hex));
    } catch (err) {
      console.log(`  ✗ ${label} — H1 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    console.log(`  [${uid}]  Vote: "${vote}"  |  ts1: ${ts1}  |  ts2: ${ts2}`);
    console.log(`    F1 length: ${f1?.length ?? 0} chars  |  F2 length: ${f2?.length ?? 0} chars`);

    // ── 4d. Fetch registered fingerprints from Global DB ──────────
    let globalRecord;
    try {
      globalRecord = await getVoterFingerprints(uid);
      if (!globalRecord) {
        console.log(`  ✗ ${label} — UID not found in Global DB. Rejecting.`);
        rejected++;
        console.log();
        continue;
      }
    } catch (err) {
      console.log(`  ✗ ${label} — Global DB error: ${err.message}`);
      errored++;
      console.log();
      continue;
    }

    const { fingerprint_1: f1_g, fingerprint_2: f2_g } = globalRecord;

    if (!f1_g || !f2_g) {
      console.log(`  ✗ ${label} — Global DB returned null fingerprints. Rejecting.`);
      rejected++;
      console.log();
      continue;
    }

    // ── 4e. Fingerprint verification ─────────────────────────────
    // Both sides are Base64 → decoded to raw byte arrays for comparison.
    const { passed, score1, score2 } = verifyFingerprints(f1, f2, f1_g, f2_g);

    if (!passed) {
      console.log(
        `  ✗ ${label} — REJECTED  ` +
        `(F1: ${score1.toFixed(1)}%, F2: ${score2.toFixed(1)}%, threshold: ${FP_THRESHOLD}%)`
      );
      rejected++;
      console.log();
      continue;
    }

    console.log(
      `  ✓ ${label} — VERIFIED  ` +
      `(F1: ${score1.toFixed(1)}%, F2: ${score2.toFixed(1)}%)`
    );

    // ── 4f. Cast vote on-chain ────────────────────────────────────
    // Parameters: vid, vote, e1(=h1Hex), ts1, e2(=hash2), ts2
    // The contract's require(!exists) is the final duplicate guard.
    try {
      const tx = await contract.methods
        .castVote(uid, vote.trim(), h1Hex, ts1, hash2, ts2)
        .send({ from: owner, gas: 3_000_000 });

      console.log(`  ✓ ${label} — Vote="${vote.trim()}" → Tx: ${tx.transactionHash}`);
      uploaded++;
    } catch (err) {
      const reason = err.message.match(/revert (.+)/)?.[1] || err.message;
      if (reason.toLowerCase().includes("already recorded")) {
        console.log(`  ⚠ ${label} — Already on-chain (contract revert, skipped).`);
        skipped++;
      } else {
        console.log(`  ✗ ${label} — castVote error: ${reason}`);
        errored++;
      }
    }

    console.log();
  }

  // ── Step 5: Summary ───────────────────────────────────────────────
  console.log(`${"═".repeat(65)}`);
  console.log(`[RESULTS]`);
  console.log(`  ✓ Uploaded  : ${uploaded}`);
  console.log(`  ✗ Rejected  : ${rejected}  (fingerprint mismatch or voter not in global DB)`);
  console.log(`  ⚠ Skipped   : ${skipped}  (already recorded on-chain)`);
  console.log(`  ✗ Errors    : ${errored}`);

  if (uploaded > 0 || skipped > 0) {
    const total = await contract.methods.getTotalVotes().call();
    const candidates = await contract.methods.getAllCandidates().call();
    console.log(`\n── On-Chain Tally ──`);
    console.log(`   Total votes: ${total}`);
    for (const c of candidates) {
      const cnt = await contract.methods.getCandidateVotes(c).call();
      console.log(`   ${c}: ${cnt}`);
    }
  }

  await disconnectGlobalDB();
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
