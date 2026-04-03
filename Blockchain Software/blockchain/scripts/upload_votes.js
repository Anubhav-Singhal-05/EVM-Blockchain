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
 *                                │  decrypt E2 → E1     │
 * ┌──────────────┐               │  extract F1,F2,V,TS1 │
 * │ MongoDB Atlas│ ◄─────────────│  verify fingerprints │
 * │  Global DB   │ ─────────────►│        │             │
 * └──────────────┘  F1_g, F2_g   │  castVote() ─────────┼──► Ganache
 *                                └──────────────────────┘
 *
 * CONFIGURATION (in .env):
 *   MIDDLEWARE_API_URL  - Base URL of the Middleware backend
 *                         e.g. http://192.168.1.10:5000
 *   MIDDLEWARE_API_KEY  - Shared secret for X-API-Key header
 *   MONGODB_URI         - MongoDB Atlas connection string
 *   GANACHE_URL         - Local Ganache RPC (default: http://127.0.0.1:7545)
 *   FP_THRESHOLD        - Fingerprint match % required (default: 80)
 *
 * Usage:
 *   node scripts/upload_votes.js
 */

require("dotenv").config();
const https  = require("https");
const http   = require("http");
const Web3   = require("web3");
const path   = require("path");
const { decryptFromHash }                             = require("./rsa");
const { verifyFingerprints }                          = require("./fingerprint_matcher");
const { connectGlobalDB, disconnectGlobalDB, getVoterFingerprints } = require("./global_db");

// ── Config ────────────────────────────────────────────────────────────

const MIDDLEWARE_API_URL = (process.env.MIDDLEWARE_API_URL || "").replace(/\/$/, "");
const MIDDLEWARE_API_KEY = process.env.MIDDLEWARE_API_KEY || "";
const GANACHE_URL        = process.env.GANACHE_URL        || "http://127.0.0.1:7545";
const FP_THRESHOLD       = Number(process.env.FP_THRESHOLD ?? 80);

// E1 field indices (split by "||"):  uid || F1 || F2 || V || TS1
const SEP      = "||";
const IDX_F1   = Number(process.env.E1_F1_INDEX   ?? 1);
const IDX_F2   = Number(process.env.E1_F2_INDEX   ?? 2);
const IDX_VOTE = Number(process.env.E1_VOTE_INDEX  ?? 3);
const IDX_TS1  = Number(process.env.E1_TS1_INDEX   ?? 4);

// ── HTTP helper ───────────────────────────────────────────────────────

/**
 * Simple GET request returning parsed JSON.
 * Works with both http:// and https:// URLs.
 * No external dependency — uses Node's built-in http/https modules.
 */
function getJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith("https") ? https : http;
    const options = { headers };

    const req = lib.get(url, options, (res) => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 401) {
          return reject(new Error("Middleware API: 401 Unauthorized — check MIDDLEWARE_API_KEY"));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Middleware API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Middleware API: invalid JSON response — ${data.slice(0, 100)}`)); }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Middleware API request timed out after 15s"));
    });
  });
}

// ── Decrypt helpers ───────────────────────────────────────────────────

function splitFields(plaintext) {
  const parts = [];
  let idx = 0;
  while (idx <= plaintext.length) {
    const next = plaintext.indexOf(SEP, idx);
    if (next === -1) { parts.push(plaintext.slice(idx)); break; }
    parts.push(plaintext.slice(idx, next));
    idx = next + SEP.length;
  }
  return parts;
}

function decryptE2(hash2) {
  const plain = decryptFromHash(hash2);
  const first = plain.indexOf(SEP);
  const last  = plain.lastIndexOf(SEP);
  if (first === -1 || first === last) {
    throw new Error(`Unexpected E2 format: "${plain.slice(0, 60)}..."`);
  }
  return {
    uid: plain.slice(0, first),
    e1:  plain.slice(first + SEP.length, last),
    ts2: plain.slice(last + SEP.length),
  };
}

function decryptE1(h1) {
  const plain    = decryptFromHash(h1);
  const fields   = splitFields(plain);
  const required = Math.max(IDX_F1, IDX_F2, IDX_VOTE, IDX_TS1) + 1;
  if (fields.length < required) {
    throw new Error(
      `E1 has only ${fields.length} fields (need ≥${required}): "${plain.slice(0, 60)}..."`
    );
  }
  return {
    uid:  fields[0],
    f1:   fields[IDX_F1],
    f2:   fields[IDX_F2],
    vote: fields[IDX_VOTE],
    ts1:  fields[IDX_TS1],
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  if (!MIDDLEWARE_API_URL) {
    console.error(
      "[ERROR] MIDDLEWARE_API_URL is not set in .env\n" +
      "        Set it to the Middleware machine's address, e.g.:\n" +
      "        MIDDLEWARE_API_URL=http://192.168.1.10:5000"
    );
    process.exit(1);
  }

  // 1. Fetch completed vote records from Middleware API
  const exportUrl = `${MIDDLEWARE_API_URL}/api/voters/export-for-blockchain`;
  console.log(`[Middleware API] Fetching records from: ${exportUrl}`);

  let apiResponse;
  try {
    apiResponse = await getJSON(exportUrl, {
      "X-API-Key":    MIDDLEWARE_API_KEY,
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

  // 2. Connect to MongoDB Atlas (Global Voter DB)
  console.log("[GlobalDB] Connecting to MongoDB Atlas...");
  await connectGlobalDB();
  console.log("[GlobalDB] Connected.\n");

  // 3. Connect to local Ganache / VotingContract
  const web3      = new Web3(GANACHE_URL);
  const accounts  = await web3.eth.getAccounts();
  const owner     = accounts[0];
  const networkId = await web3.eth.net.getId();

  const contractJson = require(path.join(__dirname, "..", "build", "contracts", "VotingContract.json"));
  const deployed     = contractJson.networks[networkId];

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
  console.log(`[Blockchain] FP threshold: ${FP_THRESHOLD}%\n`);
  console.log(`${"─".repeat(65)}`);

  // 4. Process each record
  let uploaded = 0, rejected = 0, skipped = 0, errored = 0;

  for (const row of records) {
    const { uid, hash2, voterName } = row;
    const label = `${uid} (${voterName || "unknown"})`;

    // Decrypt E2 → uid, e1, ts2
    let e1, ts2;
    try {
      ({ e1, ts2 } = decryptE2(hash2));
    } catch (err) {
      console.log(`  ✗ ${label} — E2 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    // Decrypt E1 → f1, f2, vote, ts1
    let f1, f2, vote, ts1;
    try {
      ({ f1, f2, vote, ts1 } = decryptE1(e1));
    } catch (err) {
      console.log(`  ✗ ${label} — E1 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    // Fetch registered fingerprints from MongoDB Atlas
    let globalRecord;
    try {
      globalRecord = await getVoterFingerprints(uid);
      if (!globalRecord) {
        console.log(`  ✗ ${label} — Not found in Global DB. Rejecting.`);
        rejected++;
        continue;
      }
    } catch (err) {
      console.log(`  ✗ ${label} — Global DB error: ${err.message}`);
      errored++;
      continue;
    }

    // Fingerprint verification
    const { passed, score1, score2 } = verifyFingerprints(
      f1, f2,
      globalRecord.fingerprint_1,
      globalRecord.fingerprint_2,
      FP_THRESHOLD
    );

    if (!passed) {
      console.log(
        `  ✗ ${label} — REJECTED  (F1: ${score1.toFixed(1)}%, F2: ${score2.toFixed(1)}%, threshold: ${FP_THRESHOLD}%)`
      );
      rejected++;
      continue;
    }

    console.log(`  ✓ ${label} — VERIFIED  (F1: ${score1.toFixed(1)}%, F2: ${score2.toFixed(1)}%)`);

    // castVote on-chain
    try {
      const tx = await contract.methods
        .castVote(uid, vote, e1, ts1, hash2, ts2)
        .send({ from: owner, gas: 3_000_000 });

      console.log(`  ✓ ${label} — Vote="${vote}" → Block added. Tx=${tx.transactionHash}`);
      uploaded++;
    } catch (err) {
      const reason = err.message.match(/revert (.+)/)?.[1] || err.message;
      if (reason.includes("already recorded")) {
        console.log(`  ⚠ ${label} — Already on-chain (skipped).`);
        skipped++;
      } else {
        console.log(`  ✗ ${label} — castVote error: ${reason}`);
        errored++;
      }
    }

    console.log();
  }

  // 5. Summary
  console.log(`${"═".repeat(65)}`);
  console.log(`[RESULTS]`);
  console.log(`  ✓ Uploaded  : ${uploaded}`);
  console.log(`  ✗ Rejected  : ${rejected}  (fingerprint mismatch or voter not found)`);
  console.log(`  ⚠ Skipped   : ${skipped}  (already on-chain)`);
  console.log(`  ✗ Errors    : ${errored}`);

  if (uploaded > 0 || skipped > 0) {
    const total      = await contract.methods.getTotalVotes().call();
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
