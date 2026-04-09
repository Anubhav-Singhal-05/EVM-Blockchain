/**
 * blockchainService.js
 * ---------------------
 * Handles all interaction with the deployed VotingContract on Ganache.
 * Used by the /api/voters/upload-to-blockchain route.
 *
 * Reads the compiled contract artifact from the Blockchain Software's
 * build directory (relative path configured via BLOCKCHAIN_BUILD_PATH).
 */

const Web3 = require("web3");
const path = require("path");
const { decryptFromHash } = require("./rsa");

// ── Config (from .env) ─────────────────────────────────────────────

const GANACHE_URL         = process.env.GANACHE_URL         || "http://127.0.0.1:7545";
const BLOCKCHAIN_BUILD    = process.env.BLOCKCHAIN_BUILD_PATH
  || path.join(__dirname, "..", "..", "..", "..", "Blockchain Software", "blockchain", "build", "contracts");

// E1 format after decryption: "uid||F1||F2||V||TS1"
const SEP      = "||";
const IDX_VOTE = Number(process.env.E1_VOTE_INDEX ?? 3);
const IDX_TS1  = Number(process.env.E1_TS1_INDEX  ?? 4);

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

/**
 * Decrypt E2 (hash2) → { uid, e1, ts2 }
 * hash2 = encryptToHash("uid||h1_base64||ts2_iso")
 * h1 may itself contain "||", so we split on first and last occurrence.
 */
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

/**
 * Decrypt E1 (h1) → { vote, ts1 }
 * h1 = encryptToHash("uid||F1||F2||V||TS1")
 */
function decryptE1(h1) {
  const plain  = decryptFromHash(h1);
  const fields = splitByDoublePipe(plain);
  if (fields.length <= Math.max(IDX_VOTE, IDX_TS1)) {
    throw new Error(
      `E1 has only ${fields.length} fields (need ≥${Math.max(IDX_VOTE,IDX_TS1)+1}): "${plain.slice(0,60)}..."`
    );
  }
  return { vote: fields[IDX_VOTE], ts1: fields[IDX_TS1] };
}

// ── Main export ────────────────────────────────────────────────────

/**
 * Upload all completed hash_records to the blockchain.
 * @param {Array} records  Rows from: SELECT hr.uid, hr.hash2, hr.created_at FROM hash_records hr
 * @returns {object}       { uploaded, skipped, errored, details[], tally{} }
 */
async function uploadToBlockchain(records) {
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

  let uploaded = 0, skipped = 0, errored = 0;
  const details = [];

  for (const row of records) {
    const { uid, hash2 } = row;

    // Layer 1 — decrypt E2
    let e1, ts2;
    try {
      ({ e1, ts2 } = decryptE2(hash2));
    } catch (err) {
      details.push({ uid, status: "error", reason: `E2 decrypt: ${err.message}` });
      errored++;
      continue;
    }

    // Layer 2 — decrypt E1
    let vote, ts1;
    try {
      ({ vote, ts1 } = decryptE1(e1));
    } catch (err) {
      details.push({ uid, status: "error", reason: `E1 decrypt: ${err.message}` });
      errored++;
      continue;
    }

    // castVote on-chain
    try {
      const tx = await contract.methods
        .castVote(uid, vote, e1, ts1, hash2, ts2)
        .send({ from: owner, gas: 3_000_000 });
      details.push({ uid, status: "uploaded", vote, txHash: tx.transactionHash });
      uploaded++;
    } catch (err) {
      const reason = err.message.match(/revert (.+)/)?.[1] || err.message;
      const isAlreadyRecorded = reason.includes("already recorded");
      details.push({ uid, status: isAlreadyRecorded ? "skipped" : "error", reason, vote });
      if (isAlreadyRecorded) skipped++;
      else errored++;
    }
  }

  // Read tally from chain
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
    uploaded,
    skipped,
    errored,
    details,
    tally,
  };
}

module.exports = { uploadToBlockchain };
