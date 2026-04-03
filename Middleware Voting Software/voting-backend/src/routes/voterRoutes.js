const express                    = require("express");
const router                     = express.Router();
const pool                       = require("../db/pool");
const { encryptToHash }          = require("../utils/rsa");
const { uploadToBlockchain }     = require("../utils/blockchainService");

const TIMEOUT_SECONDS = 60;

// ── maps DB row → frontend shape ─────────────────────────────
function rowToVoter(row) {
  return {
    uid:               row.uid,
    name:              row.name,
    hash1:             row.hash1        || null,
    timestamp2:        row.timestamp2   || null,
    hardwareInitiated: row.hardware_initiated === 1,
    voteProcessed:     row.vote_processed     === 1,
    initiatedAt:       row.initiated_at       || null,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

// ── check if a voter's session has timed out ─────────────────
function isTimedOut(voter) {
  if (!voter.initiated_at) return false;
  const elapsed = (Date.now() - new Date(voter.initiated_at).getTime()) / 1000;
  return elapsed > TIMEOUT_SECONDS;
}

// ── reset voter back to completely clean state ────────────────
async function resetVoter(uid) {
  await pool.execute(
    `UPDATE voters
     SET hardware_initiated = 0,
         vote_processed     = 0,
         hash1              = NULL,
         timestamp2         = NULL,
         initiated_at       = NULL
     WHERE uid = ?`,
    [uid]
  );
  await pool.execute("DELETE FROM hash_records WHERE uid = ?", [uid]);
}

// ── POST /api/voters/seed ─────────────────────────────────────
router.post("/seed", async (req, res) => {
  try {
    const seedData = [
      { uid: "UID001", name: "Arjun Sharma" },
      { uid: "UID002", name: "Priya Patel" },
      { uid: "UID003", name: "Rahul Verma" },
      { uid: "UID004", name: "Neha Singh" },
      { uid: "UID005", name: "Amit Kumar" },
    ];
    for (const v of seedData) {
      await pool.execute(
        "INSERT IGNORE INTO voters (uid, name) VALUES (?, ?)",
        [v.uid, v.name]
      );
    }
    res.json({ message: "Seed data loaded", count: seedData.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters ───────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM voters ORDER BY created_at DESC"
    );
    res.json(rows.map(rowToVoter));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/search?uid=UID001 ─────────────────────────
router.get("/search", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "UID required" });

    const [rows] = await pool.execute(
      "SELECT * FROM voters WHERE uid = ?",
      [uid.toUpperCase().trim()]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Voter not found" });

    const voter = rows[0];

    // auto-reset if timed out or stale (no initiated_at) when officer searches
    if (voter.hardware_initiated && !voter.vote_processed) {
      if (!voter.initiated_at || isTimedOut(voter)) {
        await resetVoter(voter.uid);
        const [fresh] = await pool.execute(
          "SELECT * FROM voters WHERE uid = ?",
          [voter.uid]
        );
        return res.json({ ...rowToVoter(fresh[0]), timedOut: true });
      }
    }

    res.json(rowToVoter(voter));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voters/initiate ─────────────────────────────────
router.post("/initiate", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "UID required" });

    const uidClean = uid.toUpperCase().trim();

    // ── check if any OTHER voter is currently active ──────────
    const [activeRows] = await pool.execute(
      `SELECT * FROM voters
       WHERE hardware_initiated = 1
         AND vote_processed = 0
         AND uid != ?`,
      [uidClean]
    );

    if (activeRows.length > 0) {
      const active = activeRows[0];

      if (!active.initiated_at || isTimedOut(active)) {
        // other voter's session is stale or timed out → reset them silently
        await resetVoter(active.uid);
        console.log(`⏰ Stale session cleared for ${active.uid}`);
      } else {
        // other voter is still actively voting → block
        const elapsed = Math.floor(
          (Date.now() - new Date(active.initiated_at).getTime()) / 1000
        );
        const remaining = TIMEOUT_SECONDS - elapsed;
        return res.status(400).json({
          error: `Another voter (${active.uid} — ${active.name}) is currently voting. Please wait ${remaining}s or let them finish.`,
        });
      }
    }

    // ── fetch the voter to initiate ───────────────────────────
    const [rows] = await pool.execute(
      "SELECT * FROM voters WHERE uid = ?",
      [uidClean]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Voter UID not found" });

    const voter = rows[0];

    // already fully voted → block permanently
    if (voter.vote_processed)
      return res.status(400).json({ error: "Vote already processed for this voter" });

    // has hardware_initiated flag set
    if (voter.hardware_initiated && !voter.vote_processed) {
      if (!voter.initiated_at || isTimedOut(voter)) {
        // ── stale data (no initiated_at) OR timed out → reset and allow ──
        await resetVoter(uidClean);
      } else {
        // ── session still valid and within timeout window → block ──
        const elapsed = Math.floor(
          (Date.now() - new Date(voter.initiated_at).getTime()) / 1000
        );
        const remaining = TIMEOUT_SECONDS - elapsed;
        return res.status(400).json({
          error: `Session already active for this voter. ${remaining}s remaining.`,
        });
      }
    }

    // ── all clear — initiate fresh session ───────────────────
    const now = new Date();
    await pool.execute(
      "UPDATE voters SET hardware_initiated = 1, initiated_at = ? WHERE uid = ?",
      [now, uidClean]
    );

    res.json({
      message:      `Hardware initiated for ${voter.name} (${voter.uid})`,
      voter:        { uid: voter.uid, name: voter.name },
      initiatedAt:  now,
      timeoutAfter: TIMEOUT_SECONDS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voters/receive-h1 ───────────────────────────────
router.post("/receive-h1", async (req, res) => {
  try {
    const { uid, h1 } = req.body;
    if (!uid || !h1)
      return res.status(400).json({ error: "uid and h1 required" });

    const uidClean = uid.toUpperCase().trim();
    const [rows] = await pool.execute(
      "SELECT * FROM voters WHERE uid = ?",
      [uidClean]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Voter not found" });

    const voter = rows[0];

    if (!voter.hardware_initiated)
      return res.status(400).json({ error: "Hardware not initiated" });

    // reject if timed out before accepting vote
    if (!voter.initiated_at || isTimedOut(voter)) {
      await resetVoter(uidClean);
      return res.status(408).json({
        error: "Voting session timed out. Please re-initiate this voter.",
        timedOut: true,
      });
    }

    // save H1 + T2 into Database 1
    const t2 = new Date();
    await pool.execute(
      `UPDATE voters
       SET hash1 = ?, timestamp2 = ?, vote_processed = 1, initiated_at = NULL
       WHERE uid = ?`,
      [h1, t2, uidClean]
    );

    // RSA encrypt → save into Database 2
    const hash2 = encryptToHash(`${uidClean}||${h1}||${t2.toISOString()}`);
    await pool.execute(
      `INSERT INTO hash_records (uid, hash2)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE hash2 = VALUES(hash2)`,
      [uidClean, hash2]
    );

    res.json({
      message: `Vote received and encrypted for ${voter.name}`,
      db1: { uid: uidClean, hash1: h1, timestamp2: t2 },
      db2: { uid: uidClean, hash2 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voters/timeout ──────────────────────────────────
router.post("/timeout", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "UID required" });

    const uidClean = uid.toUpperCase().trim();
    const [rows] = await pool.execute(
      "SELECT * FROM voters WHERE uid = ?",
      [uidClean]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Voter not found" });

    const voter = rows[0];

    if (voter.vote_processed)
      return res.json({ message: "Vote already completed, no timeout needed" });

    await resetVoter(uidClean);

    res.json({
      message: `Timeout applied for ${voter.name}. All partial data cleared.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/hash-records ──────────────────────────────
router.get("/hash-records", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM hash_records ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/voters/clear ──────────────────────────────────
router.delete("/clear", async (req, res) => {
  try {
    await pool.execute("DELETE FROM voters");
    await pool.execute("DELETE FROM hash_records");
    res.json({ message: "All data cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/export-for-blockchain ────────────────────────────
// Called REMOTELY by the Blockchain machine (Device 3).
// Returns all completed vote records (uid + hash2) so the blockchain
// script can fetch them over HTTP instead of connecting directly to MySQL.
//
// Protected by a shared API key in the X-API-Key header.
// Set BLOCKCHAIN_API_KEY in .env to a strong random secret.
router.get("/export-for-blockchain", async (req, res) => {
  try {
    // ── API key auth ──────────────────────────────────────────────
    const expectedKey = process.env.BLOCKCHAIN_API_KEY;
    if (expectedKey) {
      const provided = req.headers["x-api-key"];
      if (!provided || provided !== expectedKey) {
        return res.status(401).json({ error: "Unauthorized: invalid or missing X-API-Key header" });
      }
    }

    const [records] = await pool.execute(`
      SELECT hr.uid, hr.hash2, hr.created_at AS createdAt, v.name AS voterName
      FROM hash_records hr
      INNER JOIN voters v ON v.uid = hr.uid
      WHERE v.vote_processed = 1
      ORDER BY hr.created_at ASC
    `);

    res.json({
      count:   records.length,
      records,
    });
  } catch (err) {
    console.error("[Export Error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voters/upload-to-blockchain ─────────────────────────
// NOTE: In the 3-device architecture, the actual blockchain upload
// is performed by the Blockchain machine (Device 3) by calling
// GET /api/voters/export-for-blockchain to fetch records and then
// running upload_votes.js locally.
//
// This route is kept for reference only. The Admin Panel button
// that called this has been updated to explain the correct flow.
router.post("/upload-to-blockchain", async (req, res) => {
  res.status(503).json({
    message:
      "In the 3-device architecture, blockchain uploads are performed " +
      "directly from the Blockchain machine (Device 3). " +
      "Run `node scripts/upload_votes.js` on that machine, or " +
      "call GET /api/voters/export-for-blockchain from the blockchain script.",
  });
});

module.exports = router;
