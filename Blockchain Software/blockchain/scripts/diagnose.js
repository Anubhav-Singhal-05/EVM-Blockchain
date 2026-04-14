/**
 * diagnose.js  —  System Health Check
 * ─────────────────────────────────────────────────────────────────────
 * Tests every component of the EVM Blockchain system independently.
 * Run this before running upload_votes.js to catch config issues early.
 *
 * Usage:
 *   node scripts/diagnose.js
 *
 * Checks performed:
 *   [1] .env configuration — required keys are present
 *   [2] Ganache — reachable and VotingContract is deployed
 *   [3] Middleware API (Device 2) — reachable and export endpoint responds
 *   [4] voting-global-db (local) — reachable and fingerprint lookup works
 *   [5] RSA decryption — sanity check with a known round-trip
 *   [6] Fingerprint matcher — sanity check with identical and different templates
 */

require("dotenv").config();
const http   = require("http");
const https  = require("https");
const Web3   = require("web3");
const path   = require("path");
const { encryptToHash, decryptFromHash } = require("./rsa");
const { matchScore }                     = require("./fingerprint_matcher");
const { connectGlobalDB, disconnectGlobalDB, getVoterFingerprints } = require("./global_db");

// ── Colours ───────────────────────────────────────────────────────────
const G = (s) => `\x1b[32m${s}\x1b[0m`;  // green
const R = (s) => `\x1b[31m${s}\x1b[0m`;  // red
const Y = (s) => `\x1b[33m${s}\x1b[0m`;  // yellow
const B = (s) => `\x1b[34m${s}\x1b[0m`;  // blue
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let passed = 0, failed = 0, warned = 0;

function ok(msg) { console.log(`  ${G("✓")} ${msg}`); passed++; }
function fail(msg) { console.log(`  ${R("✗")} ${msg}`); failed++; }
function warn(msg) { console.log(`  ${Y("⚠")} ${msg}`); warned++; }
function section(title) { console.log(`\n${B("─".repeat(60))}\n  ${B(title)}\n${B("─".repeat(60))}`); }

// ── HTTP helper ───────────────────────────────────────────────────────
function getJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        if (res.statusCode === 401) return reject(new Error("401 Unauthorized — check API key"));
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 150)}`));
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error(`Invalid JSON: ${data.slice(0, 100)}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Request timed out after 10s")); });
  });
}

// ── TEST 1: .env config ───────────────────────────────────────────────
async function checkConfig() {
  section("CHECK 1 — .env Configuration");

  const required = {
    MIDDLEWARE_API_URL:  "URL of the Middleware backend (e.g. http://192.168.1.10:5000)",
    MIDDLEWARE_API_KEY:  "Shared API key (must match BLOCKCHAIN_API_KEY in middleware .env)",
    GANACHE_URL:         "Local Ganache RPC URL",
    GLOBAL_DB_API_URL:   "Local voting-global-db URL (e.g. http://localhost:3000)",
  };

  const optional = {
    FP_THRESHOLD: `Fingerprint match threshold % (currently: ${process.env.FP_THRESHOLD ?? "not set → 80"})`,
    API_PORT:     `Blockchain Data API port (currently: ${process.env.API_PORT ?? "not set → 4000"})`,
  };

  for (const [key, desc] of Object.entries(required)) {
    if (process.env[key]) ok(`${key} = ${DIM(process.env[key])}`);
    else fail(`${key} is missing — ${desc}`);
  }

  for (const [key, desc] of Object.entries(optional)) {
    if (process.env[key]) ok(`${key} = ${DIM(process.env[key])}`);
    else warn(`${key} not set — ${desc}`);
  }
}

// ── TEST 2: Ganache ───────────────────────────────────────────────────
async function checkGanache() {
  section("CHECK 2 — Ganache + VotingContract");

  const url = process.env.GANACHE_URL || "http://127.0.0.1:7545";
  let web3, accounts, networkId;

  try {
    web3      = new Web3(url);
    accounts  = await Promise.race([
      web3.eth.getAccounts(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))
    ]);
    networkId = await web3.eth.net.getId();
    ok(`Ganache reachable at ${url}`);
    ok(`Network ID: ${networkId}`);
    ok(`Accounts: ${accounts.length} found (owner = ${accounts[0]})`);
  } catch (err) {
    fail(`Cannot connect to Ganache at ${url} — ${err.message}`);
    warn("Make sure Ganache GUI is open with the EVM-Blockchain workspace.");
    return;
  }

  let contractJson;
  try {
    contractJson = require(path.join(__dirname, "..", "build", "contracts", "VotingContract.json"));
    ok("VotingContract.json build artifact found.");
  } catch {
    fail("VotingContract.json not found — run: npx truffle compile");
    return;
  }

  const deployed = contractJson.networks[networkId];
  if (!deployed) {
    fail(`VotingContract NOT deployed on network ${networkId}`);
    warn("Run: npx truffle migrate --network development --reset");
  } else {
    ok(`VotingContract deployed at ${deployed.address}`);
    try {
      const contract = new web3.eth.Contract(contractJson.abi, deployed.address);
      const total    = await contract.methods.getTotalVotes().call();
      ok(`getTotalVotes() = ${total} (contract is responding)`);
    } catch (err) {
      fail(`Contract call failed: ${err.message}`);
    }
  }
}

// ── TEST 3: Middleware API ────────────────────────────────────────────
async function checkMiddlewareAPI() {
  section("CHECK 3 — Middleware API (Device 2 — over WiFi)");

  const base = (process.env.MIDDLEWARE_API_URL || "").replace(/\/$/, "");
  const key  = process.env.MIDDLEWARE_API_KEY || "";

  if (!base) { fail("MIDDLEWARE_API_URL not set — skipping"); return; }

  // 3a. Basic reachability
  try {
    await getJSON(`${base}/api/voters`, { "X-API-Key": key });
    ok(`Middleware server reachable at ${base}`);
  } catch (err) {
    if (err.message.startsWith("HTTP")) {
      ok(`Middleware server reachable at ${base} (got ${err.message})`);
    } else {
      fail(`Cannot reach middleware at ${base} — ${err.message}`);
      warn("Check that the Middleware is running and both machines are on the same WiFi.");
      return;
    }
  }

  // 3b. Export endpoint — no key (should 401)
  try {
    await getJSON(`${base}/api/voters/export-for-blockchain`, {});
    warn("Export endpoint returned 200 with NO key — BLOCKCHAIN_API_KEY may not be set on middleware.");
  } catch (err) {
    if (err.message.includes("401")) {
      ok("Export endpoint correctly returns 401 without API key.");
    } else {
      fail(`Export endpoint error (no key): ${err.message}`);
    }
  }

  // 3c. Export endpoint — with correct key
  try {
    const res = await getJSON(`${base}/api/voters/export-for-blockchain`, { "X-API-Key": key });
    const count = res.body.count ?? res.body.records?.length ?? "?";
    ok(`Export endpoint → ${count} completed vote record(s).`);
    if (count === 0) warn("No completed votes yet — process some votes on Device 2 first.");
  } catch (err) {
    fail(`Export endpoint with API key failed: ${err.message}`);
  }
}

// ── TEST 4: voting-global-db (local HTTP API) ────────────────────────
async function checkGlobalDB() {
  section("CHECK 4 — voting-global-db (local HTTP API)");

  const url = (process.env.GLOBAL_DB_API_URL || "http://localhost:3000").replace(/\/$/, "");

  // 4a. Reachability
  try {
    await connectGlobalDB();
    ok(`voting-global-db reachable at ${url}`);
  } catch (err) {
    fail(`Cannot reach voting-global-db: ${err.message}`);
    warn("Run: cd voting-global-db && node server.js");
    return;
  }

  // 4b. Fetch all voters to check count
  try {
    const res = await getJSON(`${url}/api/voters`);
    const count = Array.isArray(res.body) ? res.body.length : "?";
    ok(`Voters in Global DB: ${count}`);
    if (count === 0) warn("No voters found — fingerprint verification will reject all votes.");
  } catch (err) {
    fail(`GET /api/voters failed: ${err.message}`);
    return;
  }

  // 4c. Test fingerprint lookup for a known voter
  try {
    const fp = await getVoterFingerprints("UID001");
    if (fp) {
      ok(`getVoterFingerprints("UID001") → F1=${DIM(String(fp.fingerprint_1).slice(0, 25))}, F2=${DIM(String(fp.fingerprint_2).slice(0, 25))}`);
    } else {
      warn("UID001 not found — sample data may not be seeded yet.");
    }
  } catch (err) {
    fail(`Fingerprint lookup failed: ${err.message}`);
  }

  await disconnectGlobalDB();
}

// ── TEST 5: RSA decryption ────────────────────────────────────────────
async function checkRSA() {
  section("CHECK 5 — RSA Encrypt / Decrypt (Round-Trip)");

  const testPayload = "VOTER001||MOCK_F1||MOCK_F2||CandidateA||2026-04-03T12:00:00Z";
  try {
    const encrypted = encryptToHash(testPayload);
    const decrypted = decryptFromHash(encrypted);
    if (decrypted === testPayload) {
      ok("RSA round-trip: original === decrypted ✓");
      ok(`  Original : ${testPayload}`);
      ok(`  Encrypted: ${DIM(encrypted.slice(0, 40))}…`);
    } else {
      fail("RSA round-trip: decrypted value does NOT match original.");
    }
  } catch (err) {
    fail(`RSA test threw: ${err.message}`);
  }
}

// ── TEST 6: Fingerprint matcher ───────────────────────────────────────
async function checkFingerprintMatcher() {
  section("CHECK 6 — Fingerprint Matcher");

  const score1 = matchScore("MOCK_F1_18", "MOCK_F1_18");
  score1 === 100
    ? ok(`Identical mock strings → score = ${score1}% (expected 100%)`)
    : fail(`Identical mock strings → score = ${score1}% (expected 100%)`);

  const score2 = matchScore("MOCK_F1_18", "MOCK_F1_99");
  score2 < 80
    ? ok(`Different mock strings → score = ${score2}% (expected < 80%)`)
    : warn(`Different mock strings → score = ${score2}% — suspiciously similar`);

  const buf1 = Buffer.alloc(512, 0xAB);
  const buf2 = Buffer.alloc(512, 0xAB);
  buf2[100] = 0x00;
  const score3 = matchScore(buf1.toString("base64"), buf2.toString("base64"));
  score3 > 98
    ? ok(`512-byte buffers (1 byte diff) → score = ${score3.toFixed(2)}% (high similarity ✓)`)
    : warn(`512-byte buffers (1 byte diff) → score = ${score3.toFixed(2)}%`);

  const buf3 = Buffer.alloc(512, 0x00);
  const buf4 = Buffer.alloc(512, 0xFF);
  const score4 = matchScore(buf3.toString("base64"), buf4.toString("base64"));
  score4 === 0
    ? ok(`Inverse buffers (0x00 vs 0xFF) → score = ${score4}% (expected 0%)`)
    : warn(`Inverse buffers → score = ${score4}% (expected 0%)`);
}

// ── Runner ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  EVM BLOCKCHAIN — SYSTEM DIAGNOSTICS`);
  console.log(`${"═".repeat(60)}`);

  await checkConfig();
  await checkGanache();
  await checkMiddlewareAPI();
  await checkGlobalDB();
  await checkRSA();
  await checkFingerprintMatcher();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ${G("Passed")} : ${passed}`);
  console.log(`  ${Y("Warnings")}: ${warned}`);
  console.log(`  ${R("Failed")} : ${failed}`);
  console.log();

  if (failed === 0 && warned === 0) {
    console.log(G("  ✓ All checks passed! Run: npm run upload"));
  } else if (failed === 0) {
    console.log(Y("  ⚠ No failures, but review warnings above."));
  } else {
    console.log(R(`  ✗ ${failed} check(s) failed. Fix the issues above before uploading.`));
  }
  console.log();
}

main().catch((err) => {
  console.error(R("\nFatal error in diagnostics:"), err.message);
  process.exit(1);
});
