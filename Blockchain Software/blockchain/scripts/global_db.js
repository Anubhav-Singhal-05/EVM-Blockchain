/**
 * global_db.js
 * ------------
 * Looks up voter fingerprints from the voting-global-db service
 * which runs on the SAME machine as the blockchain (Device 1).
 *
 * Instead of connecting to MongoDB directly, this module calls the
 * voting-global-db REST API at http://localhost:3000 (configurable
 * via GLOBAL_DB_API_URL in .env).
 *
 * The voting-global-db exposes:
 *   GET /api/voters/:voterId/fingerprints
 *     → { voterId, fingerprint_1, fingerprint_2 }
 */

require("dotenv").config();
const http  = require("http");
const https = require("https");

const GLOBAL_DB_API_URL = (process.env.GLOBAL_DB_API_URL || "http://localhost:3000").replace(/\/$/, "");

// ── HTTP helper ───────────────────────────────────────────────────────

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Global DB API HTTP ${res.statusCode}: ${data.slice(0, 150)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Global DB API: invalid JSON — ${data.slice(0, 100)}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Global DB API request timed out after 10s"));
    });
  });
}

// ── Public API (same interface as before) ─────────────────────────────

/**
 * No-op — kept for backward compatibility with upload_votes.js.
 * The HTTP API doesn't require a persistent connection.
 */
async function connectGlobalDB() {
  // Verify the service is reachable
  try {
    await getJSON(`${GLOBAL_DB_API_URL}/api/voters`);
    console.log(`[GlobalDB] voting-global-db API reachable at ${GLOBAL_DB_API_URL}`);
  } catch (err) {
    throw new Error(
      `Cannot reach voting-global-db at ${GLOBAL_DB_API_URL} — ${err.message}\n` +
      `Make sure voting-global-db is running: cd voting-global-db && node server.js`
    );
  }
}

/**
 * No-op — nothing to disconnect when using HTTP.
 */
async function disconnectGlobalDB() {
  // nothing to do
}

/**
 * Fetch a voter's registered fingerprint templates via the voting-global-db API.
 *
 * @param {string} voterId - The voter ID (e.g. "VOTER001")
 * @returns {{ name: string, fingerprint_1: string, fingerprint_2: string } | null}
 *          Returns null if the voter is not found.
 */
async function getVoterFingerprints(voterId) {
  const url  = `${GLOBAL_DB_API_URL}/api/voters/${encodeURIComponent(voterId)}/fingerprints`;
  const data = await getJSON(url);

  if (!data) return null;

  return {
    name:          data.voterId || voterId,
    fingerprint_1: data.fingerprint_1 || null,
    fingerprint_2: data.fingerprint_2 || null,
  };
}

module.exports = { connectGlobalDB, disconnectGlobalDB, getVoterFingerprints };
