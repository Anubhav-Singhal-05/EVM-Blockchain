/**
 * api_server.js  —  Blockchain Read API
 * ─────────────────────────────────────────────────────────────────────
 * Exposes a lightweight REST API that reads vote data directly from the
 * local Ganache blockchain and serves it to the Voting Frontend.
 *
 * The frontend (React/Vite on this same machine) calls these endpoints
 * to display election results, turnout statistics, and per-voter status
 * WITHOUT needing direct access to Ganache or the contract JSON.
 *
 * ┌─────────────────┐   HTTP GET       ┌──────────────────────┐
 * │  Voting Frontend│ ◄──────────────  │  api_server.js       │
 * │  (React/Vite)   │  :4000/api/votes │  (this file)         │
 * └─────────────────┘                  │       │              │
 *                                      │  web3 │              │
 *                                      │       ▼              │
 *                                      │   Ganache :7545      │
 *                                      └──────────────────────┘
 *
 * ENDPOINTS:
 *   GET /api/votes           — all on-chain vote records
 *   GET /api/votes/:vid      — single voter's on-chain record
 *   GET /api/stats           — aggregate tally (totals, candidates)
 *   GET /api/health          — liveness check
 *
 * USAGE:
 *   npm run api              (from blockchain/ directory)
 *   node scripts/api_server.js
 *
 * CONFIGURATION (.env):
 *   GANACHE_URL    - Ganache RPC  (default: http://127.0.0.1:7545)
 *   API_PORT       - Port to listen on  (default: 4000)
 *   API_CORS_ORIGIN - Allowed CORS origin  (default: *)
 */

require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const Web3    = require("web3");
const path    = require("path");

// ── Config ────────────────────────────────────────────────────────────
const GANACHE_URL       = process.env.GANACHE_URL   || "http://127.0.0.1:7545";
const PORT              = Number(process.env.API_PORT ?? 4000);
const CORS_ORIGIN       = process.env.API_CORS_ORIGIN || "*";

// ── Express setup ────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// ── Web3 + Contract (loaded once at startup) ─────────────────────────
let web3, contract, contractReady = false, initError = null;

async function initBlockchain() {
  try {
    web3 = new Web3(GANACHE_URL);

    // Verify Ganache is reachable
    await web3.eth.getBlockNumber();

    const networkId   = await web3.eth.net.getId();
    const contractJson = require(path.join(__dirname, "..", "build", "contracts", "VotingContract.json"));
    const deployed     = contractJson.networks[networkId];

    if (!deployed) {
      throw new Error(
        `VotingContract not deployed on network ${networkId}. ` +
        `Run: npx truffle migrate --network development`
      );
    }

    contract = new web3.eth.Contract(contractJson.abi, deployed.address);
    contractReady = true;

    console.log(`✅ Connected to Ganache at ${GANACHE_URL}`);
    console.log(`✅ VotingContract at ${deployed.address} (network ${networkId})`);
  } catch (err) {
    initError = err.message;
    console.error(`❌ Blockchain init failed: ${err.message}`);
    console.error(`   → Start Ganache and deploy the contract, then restart this server.`);
  }
}

// ── Middleware: guard for blockchain readiness ───────────────────────
function requireBlockchain(req, res, next) {
  if (!contractReady) {
    return res.status(503).json({
      error: "Blockchain not ready",
      detail: initError || "Contract not yet initialised",
    });
  }
  next();
}

// ── Helper: fetch a single vote record by VID ────────────────────────
async function fetchVoteRecord(vid) {
  try {
    const r = await contract.methods.getVote(vid).call();
    // getVote returns (vid, vote, e1, ts1, e2, ts2)
    return {
      vid:  r[0],
      vote: r[1].trim(),      // remove vote-padding spaces
      e1:   r[2],
      ts1:  r[3],
      e2:   r[4],
      ts2:  r[5],
    };
  } catch {
    // contract reverts with "No vote found for this VID"
    return null;
  }
}

// ── Helper: fetch all vote records ───────────────────────────────────
async function fetchAllVotes() {
  const vids = await contract.methods.getAllVIDs().call();
  const votes = await Promise.all(vids.map(fetchVoteRecord));
  return votes.filter(Boolean);
}

// ── Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Quick liveness/readiness probe.
 */
app.get("/api/health", async (req, res) => {
  if (!contractReady) {
    return res.status(503).json({
      status: "degraded",
      ganache: GANACHE_URL,
      error: initError || "Contract not initialised",
    });
  }

  try {
    const blockNumber = await web3.eth.getBlockNumber();
    const totalVotes  = await contract.methods.getTotalVotes().call();
    res.json({
      status:     "ok",
      ganache:    GANACHE_URL,
      blockNumber: Number(blockNumber),
      totalVotes:  Number(totalVotes),
    });
  } catch (err) {
    res.status(500).json({ status: "error", detail: err.message });
  }
});

/**
 * GET /api/votes
 * Returns all on-chain vote records.
 *
 * Response shape (matches what App.jsx expects):
 * {
 *   count: 3,
 *   votes: [
 *     { vid, vote, e1, ts1, e2, ts2 },
 *     ...
 *   ]
 * }
 */
app.get("/api/votes", requireBlockchain, async (req, res) => {
  try {
    const votes = await fetchAllVotes();
    res.json({ count: votes.length, votes });
  } catch (err) {
    console.error("[GET /api/votes] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/votes/:vid
 * Returns the on-chain record for a single voter.
 *
 * 200 → { vid, vote, e1, ts1, e2, ts2 }
 * 404 → { error: "Voter has not voted yet" }
 */
app.get("/api/votes/:vid", requireBlockchain, async (req, res) => {
  try {
    const vid    = req.params.vid.toUpperCase().trim();
    const record = await fetchVoteRecord(vid);
    if (!record) {
      return res.status(404).json({ error: "Voter has not voted yet", vid });
    }
    res.json(record);
  } catch (err) {
    console.error(`[GET /api/votes/${req.params.vid}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Aggregate tally: total votes, per-candidate counts, list of all VIDs.
 *
 * {
 *   totalVotes: 5,
 *   candidates: [
 *     { name: "BJP", votes: 3 },
 *     { name: "INC", votes: 2 }
 *   ],
 *   vids: ["UID001", "UID032", ...]
 * }
 */
app.get("/api/stats", requireBlockchain, async (req, res) => {
  try {
    const [totalVotes, candidateNames, vids] = await Promise.all([
      contract.methods.getTotalVotes().call(),
      contract.methods.getAllCandidates().call(),
      contract.methods.getAllVIDs().call(),
    ]);

    const candidates = await Promise.all(
      candidateNames.map(async (name) => {
        const count = await contract.methods.getCandidateVotes(name).call();
        return { name: name.trim(), votes: Number(count) };
      })
    );

    res.json({
      totalVotes: Number(totalVotes),
      candidates,
      vids,
    });
  } catch (err) {
    console.error("[GET /api/stats] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 404 catch-all ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Start ─────────────────────────────────────────────────────────────
initBlockchain().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Blockchain API Server running on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`     GET /api/health      — liveness check`);
    console.log(`     GET /api/votes       — all on-chain votes`);
    console.log(`     GET /api/votes/:vid  — single voter record`);
    console.log(`     GET /api/stats       — aggregate tally`);
    console.log(`\n   CORS origin: ${CORS_ORIGIN}`);
    console.log(`   Serving data from Ganache: ${GANACHE_URL}\n`);
  });
});
