/**
 * upload_votes.js  —  Bridge: Middleware DB → Blockchain
 * -------------------------------------------------------
 * Reads all H2 (hash2) records from the Middleware Voting Software's
 * MySQL database, performs two-layer RSA decryption to recover the
 * plaintext vote (V), then calls castVote() on the deployed
 * VotingContract on Ganache for each voter.
 *
 * TWO-LAYER DECRYPTION:
 *   Layer 1 (E2 → uid, E1, TS2):
 *     hash2 = encryptToHash("uid||h1||ts2")
 *     → decryptFromHash(hash2) → "uid||h1_base64||ts2_iso"
 *
 *   Layer 2 (E1 → uid, F1, F2, V, TS1):
 *     h1    = encryptToHash("uid||F1||F2||V||TS1")
 *     → decryptFromHash(h1)    → "uid||F1||F2||CandidateA||ts1_iso"
 *     field index [3] = V (vote), [4] = TS1
 *
 * ASSUMPTIONS:
 *   – ESP32 uses the same toy RSA key pair (p=61, q=53) as the middleware.
 *   – H1 plaintext format: "uid||F1||F2||V||TS1" (fields split by "||").
 *   – DB credentials and Ganache URL are read from .env in this directory.
 *   – VotingContract is already deployed (truffle migrate).
 *
 * Usage:
 *   node scripts/upload_votes.js
 */

require("dotenv").config();
const mysql = require("mysql2/promise");
const Web3  = require("web3");
const path  = require("path");
const { decryptFromHash } = require("./rsa");

// ── Config ──────────────────────────────────────────────────────────

const DB_CONFIG = {
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "voting_db",
};
const GANACHE_URL = process.env.GANACHE_URL || "http://127.0.0.1:7545";

// E1 format: "uid||F1||F2||V||TS1"  (0-indexed fields split by "||")
const SEP         = "||";
const IDX_VOTE    = Number(process.env.E1_VOTE_INDEX ?? 3);
const IDX_TS1     = Number(process.env.E1_TS1_INDEX  ?? 4);

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Split a decrypted plaintext by "||".
 * Uses a simple string-split approach that handles the double-pipe separator.
 */
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

/**
 * Decrypt E2 (hash2) → { uid, e1, ts2 }
 * hash2 = encryptToHash("uid||h1_base64||ts2_iso")
 * The h1 field itself may contain "||" (if F1/F2 do), so we split on
 * the FIRST and LAST "||" only (uid is first, ts2 is last ISO timestamp).
 */
function decryptE2(hash2) {
  const plain  = decryptFromHash(hash2);
  const first  = plain.indexOf(SEP);
  const last   = plain.lastIndexOf(SEP);

  if (first === -1 || first === last) {
    throw new Error(`E2 plaintext format unexpected: "${plain.slice(0, 60)}..."`);
  }

  const uid = plain.slice(0, first);
  const ts2 = plain.slice(last + SEP.length);
  const e1  = plain.slice(first + SEP.length, last);
  return { uid, e1, ts2 };
}

/**
 * Decrypt E1 (h1) → { vote, ts1, rawFields }
 * h1 = encryptToHash("uid||F1||F2||V||TS1")
 */
function decryptE1(h1) {
  const plain  = decryptFromHash(h1);
  const fields = splitFields(plain);

  if (fields.length <= Math.max(IDX_VOTE, IDX_TS1)) {
    throw new Error(
      `E1 plaintext has only ${fields.length} fields (expected ≥${Math.max(IDX_VOTE, IDX_TS1) + 1}): "${plain.slice(0, 60)}..."`
    );
  }

  return {
    vote:      fields[IDX_VOTE],
    ts1:       fields[IDX_TS1],
    rawFields: fields,
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  // 1. Connect to MySQL
  console.log("[DB] Connecting to MySQL at", `${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  const db = await mysql.createConnection(DB_CONFIG);
  console.log("[DB] Connected.\n");

  // 2. Fetch all hash_records (E2 rows), joined with voters for reference
  const [rows] = await db.execute(`
    SELECT
      hr.uid      AS uid,
      hr.hash2    AS hash2,
      hr.created_at AS hr_created,
      v.name      AS voter_name,
      v.hash1     AS hash1_direct,
      v.timestamp2 AS ts2_direct
    FROM hash_records hr
    LEFT JOIN voters v ON v.uid = hr.uid
    ORDER BY hr.created_at ASC
  `);

  console.log(`[DB] Found ${rows.length} record(s) in hash_records.\n`);

  if (rows.length === 0) {
    console.log("Nothing to upload. Run the voting hardware flow first.");
    await db.end();
    return;
  }

  // 3. Connect to Ganache
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
    await db.end();
    process.exit(1);
  }

  const contract = new web3.eth.Contract(contractJson.abi, deployed.address);
  console.log(`[Blockchain] Contract : ${deployed.address}`);
  console.log(`[Blockchain] Owner    : ${owner}\n`);

  // 4. Process each record
  let uploaded = 0, skipped = 0, errored = 0;

  for (const row of rows) {
    const { uid, hash2, voter_name } = row;
    const label = `${uid} (${voter_name || "unknown"})`;

    // ── Layer 1: decrypt E2 → uid, e1, ts2 ──
    let e1, ts2;
    try {
      const dec = decryptE2(hash2);
      e1  = dec.e1;
      ts2 = dec.ts2;
    } catch (err) {
      console.log(`  ✗ ${label} — E2 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    // ── Layer 2: decrypt E1 → vote, ts1 ──
    let vote, ts1;
    try {
      const dec = decryptE1(e1);
      vote = dec.vote;
      ts1  = dec.ts1;
    } catch (err) {
      console.log(`  ✗ ${label} — E1 decrypt failed: ${err.message}`);
      errored++;
      continue;
    }

    // ── Call castVote on-chain ──
    try {
      const tx = await contract.methods
        .castVote(uid, vote, e1, ts1, hash2, ts2)
        .send({ from: owner, gas: 3_000_000 });

      console.log(`  ✓ ${label}  Vote="${vote}"  Tx=${tx.transactionHash}`);
      uploaded++;
    } catch (err) {
      const reason = err.message.match(/revert (.+)/)?.[1] || err.message;
      console.log(`  ✗ ${label} — ${reason}`);
      // "Vote already recorded" counts as a skip, not a hard error
      if (reason.includes("already recorded")) skipped++;
      else errored++;
    }
  }

  // 5. Summary
  console.log(`\n${"─".repeat(55)}`);
  console.log(`[Done]  Uploaded: ${uploaded}  Skipped: ${skipped}  Errors: ${errored}`);

  if (uploaded > 0) {
    const total      = await contract.methods.getTotalVotes().call();
    const candidates = await contract.methods.getAllCandidates().call();

    console.log(`\n── On-Chain Tally ──`);
    console.log(`   Total votes: ${total}`);
    for (const c of candidates) {
      const cnt = await contract.methods.getCandidateVotes(c).call();
      console.log(`   ${c}: ${cnt}`);
    }
  }

  await db.end();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
