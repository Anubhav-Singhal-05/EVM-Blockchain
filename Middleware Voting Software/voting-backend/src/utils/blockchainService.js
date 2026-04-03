/**
 * blockchainService.js
 * ---------------------
 * Handles all interaction with the deployed VotingContract on Ganache.
 * Called by the POST /api/voters/upload-to-blockchain route.
 *
 * PIPELINE:
 *  1. Decrypt E2 → uid, E1, TS2
 *  2. Decrypt E1 → uid, F1, F2, V, TS1
 *  3. Fetch registered fingerprints from Global MongoDB DB
 *  4. Verify fingerprints (threshold configurable via FP_THRESHOLD env var)
 *  5a. PASS → castVote on blockchain
 *  5b. FAIL → record rejection, skip block
 */

const Web3 = require("web3");
const path = require("path");
const { decryptFromHash }                          = require("./rsa");
const { verifyFingerprints }                       = require("./fingerprintMatcher");
const { connectGlobalDB, getVoterFingerprints }    = require("./globalDb");

// ── Config ─────────────────────────────────────────────────────────

const GANACHE_URL      = process.env.GANACHE_URL          || "http://127.0.0.1:7545";
const BLOCKCHAIN_BUILD = process.env.BLOCKCHAIN_BUILD_PATH ||
  path.join(__dirname, "..", "..", "..", "..", "Blockchain Software", "blockchain", "build", "contracts");

const SEP          = "||";
const IDX_F1       = Number(process.env.E1_F1_INDEX   ?? 1);
const IDX_F2       = Number(process.env.E1_F2_INDEX   ?? 2);
const IDX_VOTE     = Number(process.env.E1_VOTE_INDEX  ?? 3);
const IDX_TS1      = Number(process.env.E1_TS1_INDEX   ?? 4);
const FP_THRESHOLD = Number(process.env.FP_THRESHOLD   ?? 80);

// ── Helpers ────────────────────────────────────────────────────────

function splitByDoublePipe(str) {
  const parts = [];
  let idx = 0;
  while (idx <= str.length) {
    const next = str.indexOf(SEP, idx);
    if (next === -1) { parts.push(str.slice(idx)); break; }
    parts.push(str.slice(idx, next));
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
  const fields   = splitByDoublePipe(plain);
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

// ── Main export ────────────────────────────────────────────────────

/**
 * Upload all completed hash_records to the blockchain with fingerprint verification.
 * @param {Array} records  - Rows: { uid, hash2 }
 * @returns {object}       - { uploaded, rejected, skipped, errored, details[], tally{} }
 */
async function uploadToBlockchain(records) {
  // Connect to Global DB
  await connectGlobalDB();

  // Connect to blockchain
  const web3     = new Web3(GANACHE_URL);
  const accounts = await web3.eth.getAccounts();
  const owner    = accounts[0];
  const netId    = await web3.eth.net.getId();

  let contractJson;
  try {
    contractJson = require(path.join(BLOCKCHAIN_BUILD, "VotingContract.json"));
  } catch {
    throw new Error(
      `Cannot load VotingContract.json from: ${BLOCKCHAIN_BUILD}\n` +
      `Make sure the Blockchain Software has been compiled (npx truffle compile).`
    );
  }

  const deployed = contractJson.networks[netId];
  if (!deployed) {
    throw new Error(
      `VotingContract not deployed on Ganache network ${netId}. ` +
      `Run: npx truffle migrate --network development`
    );
  }

  const contract = new web3.eth.Contract(contractJson.abi, deployed.address);

  let uploaded = 0, rejected = 0, skipped = 0, errored = 0;
  const details = [];

  for (const row of records) {
    const { uid, hash2 } = row;

    // Layer 1 — Decrypt E2
    let e1, ts2;
    try {
      ({ e1, ts2 } = decryptE2(hash2));
    } catch (err) {
      details.push({ uid, status: "error", reason: `E2 decrypt: ${err.message}` });
      errored++;
      continue;
    }

    // Layer 2 — Decrypt E1 → extract F1, F2, V, TS1
    let f1, f2, vote, ts1;
    try {
      ({ f1, f2, vote, ts1 } = decryptE1(e1));
    } catch (err) {
      details.push({ uid, status: "error", reason: `E1 decrypt: ${err.message}` });
      errored++;
      continue;
    }

    // Fetch registered fingerprints from Global DB
    let globalRecord;
    try {
      globalRecord = await getVoterFingerprints(uid);
      if (!globalRecord) {
        details.push({ uid, status: "rejected", vote, reason: "Voter not found in Global DB" });
        rejected++;
        continue;
      }
    } catch (err) {
      details.push({ uid, status: "error", reason: `Global DB lookup: ${err.message}` });
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
      details.push({
        uid, status: "rejected", vote,
        reason: `Fingerprint mismatch (F1: ${score1.toFixed(1)}%, F2: ${score2.toFixed(1)}%, threshold: ${FP_THRESHOLD}%)`,
        fpScore1: score1, fpScore2: score2,
      });
      rejected++;
      continue;
    }

    // castVote on-chain
    try {
      const tx = await contract.methods
        .castVote(uid, vote, e1, ts1, hash2, ts2)
        .send({ from: owner, gas: 3_000_000 });

      details.push({
        uid, status: "uploaded", vote, txHash: tx.transactionHash,
        fpScore1: score1, fpScore2: score2,
      });
      uploaded++;
    } catch (err) {
      const reason = err.message.match(/revert (.+)/)?.[1] || err.message;
      const isAlreadyRecorded = reason.includes("already recorded");
      details.push({
        uid, status: isAlreadyRecorded ? "skipped" : "error",
        reason, vote, fpScore1: score1, fpScore2: score2,
      });
      if (isAlreadyRecorded) skipped++;
      else errored++;
    }
  }

  // Read on-chain tally
  const tally = { total: 0, candidates: {} };
  try {
    tally.total      = Number(await contract.methods.getTotalVotes().call());
    const candidates = await contract.methods.getAllCandidates().call();
    for (const c of candidates) {
      tally.candidates[c] = Number(await contract.methods.getCandidateVotes(c).call());
    }
  } catch { /* non-fatal */ }

  return {
    contractAddress: deployed.address,
    fpThreshold: FP_THRESHOLD,
    uploaded,
    rejected,
    skipped,
    errored,
    details,
    tally,
  };
}

module.exports = { uploadToBlockchain };
