/**
 * api_server.js  —  Blockchain Data REST API
 * ─────────────────────────────────────────────────────────────────────
 * A lightweight HTTP server that reads live data from the deployed
 * VotingContract on Ganache and serves it as JSON for the frontend.
 *
 * The frontend (Device 1) calls these endpoints over the local network.
 *
 * ENDPOINTS:
 *   GET /api/health                 — Server + contract status
 *   GET /api/tally                  — Candidate-wise vote counts + total
 *   GET /api/votes                  — All individual vote records (VID, V)
 *   GET /api/votes/:vid             — Specific voter's full record
 *   GET /api/stats                  — Aggregate stats (for charts/graphs)
 *
 * CONFIGURATION (.env):
 *   GANACHE_URL          — Ganache RPC (default: http://127.0.0.1:7545)
 *   API_PORT             — Port to listen on (default: 4000)
 *   API_CORS_ORIGIN      — Allowed CORS origin (default: *)
 *
 * Usage:
 *   node scripts/api_server.js
 *   npm run api
 */

require("dotenv").config();
const http = require("http");
const Web3 = require("web3");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────

const GANACHE_URL  = process.env.GANACHE_URL   || "http://127.0.0.1:7545";
const PORT         = Number(process.env.API_PORT || 4000);
const CORS_ORIGIN  = process.env.API_CORS_ORIGIN || "*";

// ── Blockchain setup ──────────────────────────────────────────────────

let contract = null;
let web3     = null;

async function initBlockchain() {
  web3 = new Web3(GANACHE_URL);
  const networkId    = await web3.eth.net.getId();
  const contractJson = require(path.join(__dirname, "..", "build", "contracts", "VotingContract.json"));
  const deployed     = contractJson.networks[networkId];

  if (!deployed) {
    throw new Error(
      `VotingContract not deployed on Ganache network ${networkId}. ` +
      `Run: npx truffle migrate --network development`
    );
  }

  contract = new web3.eth.Contract(contractJson.abi, deployed.address);
  console.log(`[Blockchain] Contract: ${deployed.address}`);
  return deployed.address;
}

// ── Data readers ──────────────────────────────────────────────────────

async function getTally() {
  const [total, candidates] = await Promise.all([
    contract.methods.getTotalVotes().call(),
    contract.methods.getAllCandidates().call(),
  ]);

  const breakdown = {};
  await Promise.all(
    candidates.map(async (c) => {
      breakdown[c] = Number(await contract.methods.getCandidateVotes(c).call());
    })
  );

  return {
    total:     Number(total),
    candidates: breakdown,
  };
}

async function getAllVotes() {
  const vids = await contract.methods.getAllVIDs().call();
  const records = await Promise.all(
    vids.map(async (vid) => {
      const r = await contract.methods.getVote(vid).call();
      return {
        vid:   r[0],
        vote:  r[1],
        ts1:   r[3],
        ts2:   r[5],
        // encrypted blobs — included for auditability
        e1:    r[2],
        e2:    r[4],
      };
    })
  );
  return records;
}

async function getVoteByVID(vid) {
  const r = await contract.methods.getVote(vid).call();
  return {
    vid:  r[0],
    vote: r[1],
    e1:   r[2],
    ts1:  r[3],
    e2:   r[4],
    ts2:  r[5],
  };
}

async function getStats() {
  const [tally, vids] = await Promise.all([
    getTally(),
    contract.methods.getAllVIDs().call(),
  ]);

  // Build timeline: votes per hour
  const allVotes = await getAllVotes();
  const hourBuckets = {};
  for (const v of allVotes) {
    if (!v.ts2) continue;
    const d    = new Date(v.ts2);
    const hour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
    hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
  }

  const timeline = Object.entries(hourBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour, count }));

  // Candidate percentages
  const candidateStats = Object.entries(tally.candidates).map(([name, votes]) => ({
    name,
    votes,
    percentage: tally.total > 0 ? Number(((votes / tally.total) * 100).toFixed(2)) : 0,
  }));

  return {
    totalVotes:     tally.total,
    candidateStats,
    timeline,
    fetchedAt:      new Date().toISOString(),
  };
}

// ── HTTP Router ───────────────────────────────────────────────────────

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

async function router(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  CORS_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method !== "GET") return sendError(res, 405, "Method Not Allowed");

  const url = req.url.split("?")[0].replace(/\/$/, "");

  try {
    // ── GET /api/health ──────────────────────────────────────────────
    if (url === "/api/health" || url === "/") {
      const networkId = await web3.eth.net.getId();
      const block     = await web3.eth.getBlockNumber();
      sendJSON(res, 200, {
        status:          "ok",
        contractAddress: contract.options.address,
        ganacheUrl:      GANACHE_URL,
        networkId:       Number(networkId),
        currentBlock:    Number(block),
        timestamp:       new Date().toISOString(),
      });

    // ── GET /api/tally ───────────────────────────────────────────────
    } else if (url === "/api/tally") {
      sendJSON(res, 200, await getTally());

    // ── GET /api/votes ───────────────────────────────────────────────
    } else if (url === "/api/votes") {
      const votes = await getAllVotes();
      sendJSON(res, 200, { count: votes.length, votes });

    // ── GET /api/votes/:vid ──────────────────────────────────────────
    } else if (url.startsWith("/api/votes/")) {
      const vid = decodeURIComponent(url.replace("/api/votes/", ""));
      if (!vid) return sendError(res, 400, "VID is required");
      try {
        const record = await getVoteByVID(vid);
        sendJSON(res, 200, record);
      } catch (err) {
        if (err.message.includes("not found") || err.message.includes("revert")) {
          sendError(res, 404, `No vote found for voter ID: ${vid}`);
        } else {
          throw err;
        }
      }

    // ── GET /api/stats ───────────────────────────────────────────────
    } else if (url === "/api/stats") {
      sendJSON(res, 200, await getStats());

    // ── 404 ──────────────────────────────────────────────────────────
    } else {
      sendJSON(res, 404, {
        error:    "Not Found",
        available: ["/api/health", "/api/tally", "/api/votes", "/api/votes/:vid", "/api/stats"],
      });
    }
  } catch (err) {
    console.error(`[Error] ${req.url} —`, err.message);
    sendError(res, 500, err.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  EVM Blockchain  —  Data API Server`);
  console.log(`${"═".repeat(55)}`);
  console.log(`[Ganache ] Connecting to ${GANACHE_URL} ...`);

  try {
    const contractAddress = await initBlockchain();
    console.log(`[Contract] Loaded at ${contractAddress}`);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  }

  const server = http.createServer(router);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n[API] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[API] CORS origin: ${CORS_ORIGIN}\n`);
    console.log("  Available endpoints:");
    console.log(`    GET http://localhost:${PORT}/api/health`);
    console.log(`    GET http://localhost:${PORT}/api/tally`);
    console.log(`    GET http://localhost:${PORT}/api/votes`);
    console.log(`    GET http://localhost:${PORT}/api/votes/:vid`);
    console.log(`    GET http://localhost:${PORT}/api/stats`);
    console.log(`\n  The frontend (Device 1) can call:`);
    console.log(`    http://<this-machine-ip>:${PORT}/api/tally`);
    console.log(`    http://<this-machine-ip>:${PORT}/api/stats\n`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
