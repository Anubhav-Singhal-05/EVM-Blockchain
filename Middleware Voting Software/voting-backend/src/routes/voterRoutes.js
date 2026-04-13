// const express           = require("express");
// const router            = express.Router();
// const pool              = require("../db/pool");
// const { encryptToHash } = require("../utils/rsa");
// const { MongoClient }   = require("mongodb");
// const serialHandler     = require("../utils/serialHandler");

// const TIMEOUT_SECONDS = 60;

// // ── MongoDB connection details ────────────────────────────────
// const MONGO_URI        = "mongodb+srv://anubhav:anubhav123@cluster0.lvukftp.mongodb.net/test";
// const MONGO_DB_NAME    = "test";
// const MONGO_COLLECTION = "voters";

// // ── maps DB row → frontend shape ─────────────────────────────
// function rowToVoter(row) {
//   return {
//     uid:               row.uid,
//     name:              row.name,
//     hash1:             row.hash1        || null,
//     timestamp2:        row.timestamp2   || null,
//     hardwareInitiated: row.hardware_initiated === 1,
//     voteProcessed:     row.vote_processed     === 1,
//     initiatedAt:       row.initiated_at       || null,
//     createdAt:         row.created_at,
//     updatedAt:         row.updated_at,
//   };
// }

// // ── check if session timed out ────────────────────────────────
// function isTimedOut(voter) {
//   if (!voter.initiated_at) return false;
//   const elapsed = (Date.now() - new Date(voter.initiated_at).getTime()) / 1000;
//   return elapsed > TIMEOUT_SECONDS;
// }

// // ── reset voter to clean state ────────────────────────────────
// async function resetVoter(uid) {
//   await pool.execute(
//     `UPDATE voters
//      SET hardware_initiated = 0,
//          vote_processed     = 0,
//          hash1              = NULL,
//          timestamp2         = NULL,
//          initiated_at       = NULL
//      WHERE uid = ?`,
//     [uid]
//   );
//   await pool.execute("DELETE FROM hash_records WHERE uid = ?", [uid]);
// }

// // ── POST /api/voters/seed ─────────────────────────────────────
// router.post("/seed", async (req, res) => {
//   let client;
//   try {
//     console.log("🔗 Connecting to MongoDB...");
//     client = new MongoClient(MONGO_URI);
//     await client.connect();

//     const db         = client.db(MONGO_DB_NAME);
//     const collection = db.collection(MONGO_COLLECTION);

//     const mongoVoters = await collection.find({}).toArray();

//     if (mongoVoters.length === 0)
//       return res.status(404).json({ error: "No voters found in MongoDB" });

//     console.log(`📦 Found ${mongoVoters.length} voters in MongoDB`);

//     let inserted = 0;
//     let skipped  = 0;

//     for (const v of mongoVoters) {
//       const uid  = v.vid;
//       const name = `${v.firstName} ${v.lastName}`.trim();

//       if (!uid || !name) {
//         console.log(`⚠️  Skipping — missing vid or name:`, v);
//         skipped++;
//         continue;
//       }

//       const [result] = await pool.execute(
//         "INSERT IGNORE INTO voters (uid, name) VALUES (?, ?)",
//         [uid, name]
//       );

//       if (result.affectedRows > 0) {
//         inserted++;
//         console.log(`✅ Inserted: ${uid} — ${name}`);
//       } else {
//         skipped++;
//         console.log(`⏭️  Skipped (already exists): ${uid}`);
//       }
//     }

//     res.json({
//       message:  "Voters loaded from MongoDB",
//       total:    mongoVoters.length,
//       inserted,
//       skipped,
//     });

//   } catch (err) {
//     console.error("❌ MongoDB fetch error:", err.message);
//     res.status(500).json({ error: `MongoDB error: ${err.message}` });
//   } finally {
//     if (client) await client.close();
//   }
// });

// // ── GET /api/voters ───────────────────────────────────────────
// router.get("/", async (req, res) => {
//   try {
//     const [rows] = await pool.execute(
//       "SELECT * FROM voters ORDER BY created_at DESC"
//     );
//     res.json(rows.map(rowToVoter));
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── GET /api/voters/search?uid=UID001 ─────────────────────────
// router.get("/search", async (req, res) => {
//   try {
//     const { uid } = req.query;
//     if (!uid) return res.status(400).json({ error: "UID required" });

//     const [rows] = await pool.execute(
//       "SELECT * FROM voters WHERE uid = ?",
//       [uid.toUpperCase().trim()]
//     );

//     if (rows.length === 0)
//       return res.status(404).json({ error: "Voter not found" });

//     const voter = rows[0];

//     if (voter.hardware_initiated && !voter.vote_processed) {
//       if (!voter.initiated_at || isTimedOut(voter)) {
//         await resetVoter(voter.uid);
//         const [fresh] = await pool.execute(
//           "SELECT * FROM voters WHERE uid = ?",
//           [voter.uid]
//         );
//         return res.json({ ...rowToVoter(fresh[0]), timedOut: true });
//       }
//     }

//     res.json(rowToVoter(voter));
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── POST /api/voters/initiate ─────────────────────────────────
// router.post("/initiate", async (req, res) => {
//   try {
//     const { uid } = req.body;
//     if (!uid) return res.status(400).json({ error: "UID required" });

//     const uidClean = uid.toUpperCase().trim();

//     // check if any OTHER voter is currently active
//     const [activeRows] = await pool.execute(
//       `SELECT * FROM voters
//        WHERE hardware_initiated = 1
//          AND vote_processed = 0
//          AND uid != ?`,
//       [uidClean]
//     );

//     if (activeRows.length > 0) {
//       const active = activeRows[0];
//       if (!active.initiated_at || isTimedOut(active)) {
//         await resetVoter(active.uid);
//         console.log(`⏰ Stale session cleared for ${active.uid}`);
//       } else {
//         const elapsed = Math.floor(
//           (Date.now() - new Date(active.initiated_at).getTime()) / 1000
//         );
//         const remaining = TIMEOUT_SECONDS - elapsed;
//         return res.status(400).json({
//           error: `Another voter (${active.uid} — ${active.name}) is currently voting. Please wait ${remaining}s or let them finish.`,
//         });
//       }
//     }

//     const [rows] = await pool.execute(
//       "SELECT * FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (rows.length === 0)
//       return res.status(404).json({ error: "Voter UID not found" });

//     const voter = rows[0];

//     if (voter.vote_processed)
//       return res.status(400).json({ error: "Vote already processed for this voter" });

//     if (voter.hardware_initiated && !voter.vote_processed) {
//       if (!voter.initiated_at || isTimedOut(voter)) {
//         await resetVoter(uidClean);
//       } else {
//         const elapsed = Math.floor(
//           (Date.now() - new Date(voter.initiated_at).getTime()) / 1000
//         );
//         const remaining = TIMEOUT_SECONDS - elapsed;
//         return res.status(400).json({
//           error: `Session already active for this voter. ${remaining}s remaining.`,
//         });
//       }
//     }

//     // ── initiate fresh session ────────────────────────────────
//     const now = new Date();
//     await pool.execute(
//       "UPDATE voters SET hardware_initiated = 1, initiated_at = ? WHERE uid = ?",
//       [now, uidClean]
//     );

//     // ── tell hardware to start voting session ─────────────────
//     serialHandler.sendStart(voter.uid, voter.name);

//     res.json({
//       message:      `Hardware initiated for ${voter.name} (${voter.uid})`,
//       voter:        { uid: voter.uid, name: voter.name },
//       initiatedAt:  now,
//       timeoutAfter: TIMEOUT_SECONDS,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── POST /api/voters/receive-h1 ───────────────────────────────
// router.post("/receive-h1", async (req, res) => {
//   try {
//     const { uid, h1 } = req.body;
//     if (!uid || !h1)
//       return res.status(400).json({ error: "uid and h1 required" });

//     const uidClean = uid.toUpperCase().trim();

//     const [rows] = await pool.execute(
//       "SELECT * FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (rows.length === 0)
//       return res.status(404).json({ error: "Voter not found" });

//     const voter = rows[0];

//     if (!voter.hardware_initiated)
//       return res.status(400).json({ error: "Hardware not initiated" });

//     if (!voter.initiated_at || isTimedOut(voter)) {
//       await resetVoter(uidClean);
//       return res.status(408).json({
//         error: "Voting session timed out. Please re-initiate this voter.",
//         timedOut: true,
//       });
//     }

//     // ── STEP 1: save H1 + T2 into DB1 strictly first ─────────
//     const t2 = new Date();
//     console.log(`📝 Step 1 — Saving H1 + T2 to DB1 for ${uidClean}...`);

//     try {
//       await pool.execute(
//         `UPDATE voters
//          SET hash1          = ?,
//              timestamp2     = ?,
//              vote_processed = 1,
//              initiated_at   = NULL
//          WHERE uid = ?`,
//         [h1, t2, uidClean]
//       );
//     } catch (db1Error) {
//       console.error(`❌ DB1 write failed for ${uidClean}:`, db1Error.message);
//       return res.status(500).json({
//         error:  "Failed to save vote in Database 1. Database 2 was NOT updated.",
//         detail: db1Error.message,
//       });
//     }

//     console.log(`✅ Step 1 done — H1 + T2 saved in DB1`);

//     // ── verify DB1 saved ──────────────────────────────────────
//     const [verify] = await pool.execute(
//       "SELECT hash1, timestamp2, vote_processed FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (!verify[0].hash1 || !verify[0].vote_processed) {
//       console.error(`❌ DB1 verification failed for ${uidClean}`);
//       return res.status(500).json({
//         error: "Database 1 verification failed. Database 2 was NOT updated.",
//       });
//     }

//     console.log(`✅ Step 1 verified — DB1 record confirmed`);

//     // ── STEP 2: RSA encrypt D1 → save into DB2 ───────────────
//     console.log(`🔐 Step 2 — RSA encrypting and saving to DB2 for ${uidClean}...`);

//     const d1    = `${uidClean}||${h1}||${t2.toISOString()}`;
//     const hash2 = encryptToHash(d1);

//     try {
//       await pool.execute(
//         `INSERT INTO hash_records (uid, hash2)
//          VALUES (?, ?)
//          ON DUPLICATE KEY UPDATE hash2 = VALUES(hash2)`,
//         [uidClean, hash2]
//       );
//     } catch (db2Error) {
//       console.error(`❌ DB2 write failed for ${uidClean}:`, db2Error.message);
//       return res.status(500).json({
//         error:  "Vote saved in Database 1 but failed to encrypt into Database 2.",
//         detail: db2Error.message,
//         db1:    { uid: uidClean, hash1: h1, timestamp2: t2 },
//       });
//     }

//     console.log(`✅ Step 2 done — Hash2 saved in DB2`);
//     console.log(`🎉 Both databases updated successfully for ${uidClean}`);

//     res.json({
//       message: `Vote received and encrypted for ${voter.name}`,
//       db1:     { uid: uidClean, hash1: h1, timestamp2: t2 },
//       db2:     { uid: uidClean, hash2 },
//     });

//   } catch (err) {
//     console.error("receive-h1 error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── POST /api/voters/timeout ──────────────────────────────────
// router.post("/timeout", async (req, res) => {
//   try {
//     const { uid } = req.body;
//     if (!uid) return res.status(400).json({ error: "UID required" });

//     const uidClean = uid.toUpperCase().trim();

//     const [rows] = await pool.execute(
//       "SELECT * FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (rows.length === 0)
//       return res.status(404).json({ error: "Voter not found" });

//     const voter = rows[0];

//     if (voter.vote_processed)
//       return res.json({ message: "Vote already completed, no timeout needed" });

//     await resetVoter(uidClean);

//     res.json({
//       message: `Timeout applied for ${voter.name}. All partial data cleared.`,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── GET /api/voters/hash-records ──────────────────────────────
// router.get("/hash-records", async (req, res) => {
//   try {
//     const [rows] = await pool.execute(
//       "SELECT * FROM hash_records ORDER BY created_at DESC"
//     );
//     res.json(rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── DELETE /api/voters/clear ──────────────────────────────────
// router.delete("/clear", async (req, res) => {
//   try {
//     await pool.execute("DELETE FROM voters");
//     await pool.execute("DELETE FROM hash_records");
//     res.json({ message: "All data cleared" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // ── AUTO PROCESS H1 when hardware sends via serial ────────────
// serialHandler.setOnH1Received(async ({ uid, h1 }) => {
//   console.log(`🔄 Auto-processing H1 for ${uid} from hardware...`);
//   try {
//     const uidClean = uid.toUpperCase().trim();

//     const [rows] = await pool.execute(
//       "SELECT * FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (rows.length === 0) {
//       console.error(`❌ Voter ${uidClean} not found`);
//       return;
//     }

//     const voter = rows[0];

//     if (!voter.hardware_initiated) {
//       console.error(`❌ Hardware not initiated for ${uidClean}`);
//       return;
//     }

//     if (!voter.initiated_at || isTimedOut(voter)) {
//       await resetVoter(uidClean);
//       console.error(`❌ Session timed out for ${uidClean}`);
//       return;
//     }

//     // STEP 1 — save to DB1
//     const t2 = new Date();
//     console.log(`📝 Step 1 — Saving H1 + T2 to DB1 for ${uidClean}...`);

//     await pool.execute(
//       `UPDATE voters
//        SET hash1          = ?,
//            timestamp2     = ?,
//            vote_processed = 1,
//            initiated_at   = NULL
//        WHERE uid = ?`,
//       [h1, t2, uidClean]
//     );

//     console.log(`✅ Step 1 done — DB1 updated`);

//     // verify DB1
//     const [verify] = await pool.execute(
//       "SELECT hash1, vote_processed FROM voters WHERE uid = ?",
//       [uidClean]
//     );

//     if (!verify[0].hash1 || !verify[0].vote_processed) {
//       console.error(`❌ DB1 verification failed for ${uidClean}`);
//       return;
//     }

//     console.log(`✅ Step 1 verified — DB1 confirmed`);

//     // STEP 2 — RSA encrypt → DB2
//     console.log(`🔐 Step 2 — RSA encrypting and saving to DB2 for ${uidClean}...`);

//     const d1    = `${uidClean}||${h1}||${t2.toISOString()}`;
//     const hash2 = encryptToHash(d1);

//     await pool.execute(
//       `INSERT INTO hash_records (uid, hash2)
//        VALUES (?, ?)
//        ON DUPLICATE KEY UPDATE hash2 = VALUES(hash2)`,
//       [uidClean, hash2]
//     );

//     console.log(`✅ Step 2 done — DB2 updated`);
//     console.log(`🎉 Vote fully processed for ${voter.name} (${uidClean})`);

//   } catch (err) {
//     console.error(`❌ Auto H1 processing error for ${uid}:`, err.message);
//   }
// });

// module.exports = router;
const express           = require("express");
const router            = express.Router();
const pool              = require("../db/pool");
const { encryptToHash } = require("../utils/rsa");
const { MongoClient }   = require("mongodb");
const serialHandler     = require("../utils/serialHandler");

const TIMEOUT_SECONDS = 60;

// ── MongoDB connection details ────────────────────────────────
const MONGO_URI        = "mongodb+srv://anubhav:anubhav123@cluster0.lvukftp.mongodb.net/test";
const MONGO_DB_NAME    = "test";
const MONGO_COLLECTION = "voters";

// ── map vote_sessions row → frontend shape ────────────────────
function rowToSession(row) {
  return {
    id:                row.id,
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

// ── check if a session has timed out ─────────────────────────
function isTimedOut(session) {
  if (!session.initiated_at) return false;
  const elapsed = (Date.now() - new Date(session.initiated_at).getTime()) / 1000;
  return elapsed > TIMEOUT_SECONDS;
}

// ── reset a specific session row ──────────────────────────────
async function resetSession(sessionId) {
  await pool.execute(
    `UPDATE vote_sessions
     SET hardware_initiated = 0,
         vote_processed     = 0,
         hash1              = NULL,
         timestamp2         = NULL,
         initiated_at       = NULL
     WHERE id = ?`,
    [sessionId]
  );
  await pool.execute(
    "DELETE FROM hash_records WHERE session_id = ?",
    [sessionId]
  );
}

// ── POST /api/voters/seed ─────────────────────────────────────
// fetches from MongoDB → inserts into DB0 (voters_master)
router.post("/seed", async (req, res) => {
  let client;
  try {
    console.log("🔗 Connecting to MongoDB...");
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db         = client.db(MONGO_DB_NAME);
    const collection = db.collection(MONGO_COLLECTION);
    const mongoVoters = await collection.find({}).toArray();

    if (mongoVoters.length === 0)
      return res.status(404).json({ error: "No voters found in MongoDB" });

    console.log(`📦 Found ${mongoVoters.length} voters in MongoDB`);

    let inserted = 0;
    let skipped  = 0;

    for (const v of mongoVoters) {
      const uid  = v.vid;
      const name = `${v.firstName} ${v.lastName}`.trim();

      if (!uid || !name) {
        skipped++;
        continue;
      }

      const [result] = await pool.execute(
        "INSERT IGNORE INTO voters_master (uid, name) VALUES (?, ?)",
        [uid, name]
      );

      if (result.affectedRows > 0) {
        inserted++;
        console.log(`✅ Inserted into DB0: ${uid} — ${name}`);
      } else {
        skipped++;
      }
    }

    res.json({
      message:  "Voters loaded into DB0 from MongoDB",
      total:    mongoVoters.length,
      inserted,
      skipped,
    });

  } catch (err) {
    console.error("❌ MongoDB fetch error:", err.message);
    res.status(500).json({ error: `MongoDB error: ${err.message}` });
  } finally {
    if (client) await client.close();
  }
});

// ── GET /api/voters ───────────────────────────────────────────
// returns DB0 master list
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM voters_master ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/sessions ──────────────────────────────────
// returns all DB1 vote sessions
router.get("/sessions", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM vote_sessions ORDER BY created_at DESC"
    );
    res.json(rows.map(rowToSession));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/search?uid=UID001 ─────────────────────────
router.get("/search", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "UID required" });
    
    const uidClean = uid.toUpperCase().trim();
    
    // check DB0 for voter
    const [masterRows] = await pool.execute(
      "SELECT * FROM voters_master WHERE uid = ?",
      [uidClean]
    );
    
    if (masterRows.length === 0)
      return res.status(404).json({ error: "Voter not found in DB0" });
      
    const master = masterRows[0];
    
    // ── check for ACTIVE session (not yet voted) ──────────────
    const [activeSessions] = await pool.execute(
      `SELECT * FROM vote_sessions 
       WHERE uid = ? AND hardware_initiated = 1 AND vote_processed = 0 
       ORDER BY created_at DESC LIMIT 1`,
      [uidClean]
    );
    
    if (activeSessions.length > 0) {
      const active = activeSessions[0];
      if (!active.initiated_at || isTimedOut(active)) {
        await resetSession(active.id);
        return res.json({
          uid:               master.uid,
          name:              master.name,
          hardwareInitiated: false,
          voteProcessed:     false,
          initiatedAt:       null,
          timedOut:          true,
        });
      }
      return res.json({
        uid:               master.uid,
        name:              master.name,
        hardwareInitiated: true,
        voteProcessed:     false,
        initiatedAt:       active.initiated_at,
        sessionId:         active.id,
        timedOut:          false,
      });
    }
    
    // ── check for RECENTLY COMPLETED session ──────────────────
    // this is what the frontend polling uses to detect vote done
    const [completedSessions] = await pool.execute(
      `SELECT * FROM vote_sessions 
       WHERE uid = ? AND vote_processed = 1 
       ORDER BY updated_at DESC LIMIT 1`,
      [uidClean]
    );
    
    if (completedSessions.length > 0) {
      const done = completedSessions[0];
      return res.json({
        uid:               master.uid,
        name:              master.name,
        hardwareInitiated: false,
        voteProcessed:     true,      // ← frontend sees this and stops timer
        initiatedAt:       null,
        timestamp2:        done.timestamp2,
        timedOut:          false,
      });
    }
    
    // no session at all — fresh voter
    res.json({
      uid:               master.uid,
      name:              master.name,
      hardwareInitiated: false,
      voteProcessed:     false,
      initiatedAt:       null,
      timedOut:          false,
    });
    
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

    // check if any OTHER voter is currently active in DB1
    const [otherActive] = await pool.execute(
      `SELECT * FROM vote_sessions
       WHERE hardware_initiated = 1
         AND vote_processed = 0
         AND uid != ?`,
      [uidClean]
    );

    if (otherActive.length > 0) {
      const active = otherActive[0];
      if (!active.initiated_at || isTimedOut(active)) {
        await resetSession(active.id);
        console.log(`⏰ Stale session cleared for ${active.uid}`);
      } else {
        const elapsed = Math.floor(
          (Date.now() - new Date(active.initiated_at).getTime()) / 1000
        );
        const remaining = TIMEOUT_SECONDS - elapsed;
        return res.status(400).json({
          error: `Another voter (${active.uid} — ${active.name}) is currently voting. Wait ${remaining}s.`,
        });
      }
    }

    // check if THIS voter already has an active session
    const [ownActive] = await pool.execute(
      `SELECT * FROM vote_sessions
       WHERE uid = ? AND hardware_initiated = 1 AND vote_processed = 0`,
      [uidClean]
    );

    if (ownActive.length > 0) {
      const active = ownActive[0];
      if (!active.initiated_at || isTimedOut(active)) {
        await resetSession(active.id);
      } else {
        const elapsed = Math.floor(
          (Date.now() - new Date(active.initiated_at).getTime()) / 1000
        );
        const remaining = TIMEOUT_SECONDS - elapsed;
        return res.status(400).json({
          error: `Session already active for this voter. ${remaining}s remaining.`,
        });
      }
    }

    // check DB0 — voter must exist in master list
    const [masterRows] = await pool.execute(
      "SELECT * FROM voters_master WHERE uid = ?",
      [uidClean]
    );

    if (masterRows.length === 0)
      return res.status(404).json({ error: "Voter not found in DB0" });

    const master = masterRows[0];

    // create NEW row in DB1 for this vote session
    const now = new Date();
    const [result] = await pool.execute(
      `INSERT INTO vote_sessions (uid, name, hardware_initiated, initiated_at)
       VALUES (?, ?, 1, ?)`,
      [uidClean, master.name, now]
    );

    const sessionId = result.insertId;
    console.log(`✅ New session created in DB1 — ID: ${sessionId} for ${uidClean}`);

    // tell hardware to start
    serialHandler.sendStart(master.uid, master.name);

    res.json({
      message:      `Hardware initiated for ${master.name} (${master.uid})`,
      voter:        { uid: master.uid, name: master.name },
      sessionId,
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

    // find active session in DB1
    const [sessions] = await pool.execute(
      `SELECT * FROM vote_sessions
       WHERE uid = ? AND hardware_initiated = 1 AND vote_processed = 0`,
      [uidClean]
    );

    if (sessions.length === 0)
      return res.status(400).json({ error: "No active session found for this voter" });

    const session = sessions[0];

    if (!session.initiated_at || isTimedOut(session)) {
      await resetSession(session.id);
      return res.status(408).json({
        error: "Voting session timed out. Please re-initiate.",
        timedOut: true,
      });
    }

    // ── STEP 1: save H1 + T2 into DB1 strictly first ─────────
    const t2 = new Date();
    console.log(`📝 Step 1 — Saving H1 + T2 to DB1 session ${session.id}...`);

    try {
      await pool.execute(
        `UPDATE vote_sessions
         SET hash1          = ?,
             timestamp2     = ?,
             vote_processed = 1,
             initiated_at   = NULL
         WHERE id = ?`,
        [h1, t2, session.id]
      );
    } catch (db1Error) {
      console.error(`❌ DB1 write failed:`, db1Error.message);
      return res.status(500).json({
        error:  "Failed to save in DB1. DB2 was NOT updated.",
        detail: db1Error.message,
      });
    }

    console.log(`✅ Step 1 done — DB1 updated`);

    // verify DB1
    const [verify] = await pool.execute(
      "SELECT hash1, vote_processed FROM vote_sessions WHERE id = ?",
      [session.id]
    );

    if (!verify[0].hash1 || !verify[0].vote_processed) {
      console.error(`❌ DB1 verification failed`);
      return res.status(500).json({
        error: "DB1 verification failed. DB2 was NOT updated.",
      });
    }

    console.log(`✅ Step 1 verified — DB1 confirmed`);

    // ── STEP 2: RSA encrypt → new row in DB2 ─────────────────
    console.log(`🔐 Step 2 — RSA encrypting and saving to DB2...`);

    const d1    = `${uidClean}||${h1}||${t2.toISOString()}`;
    const hash2 = encryptToHash(d1);

    try {
      await pool.execute(
        `INSERT INTO hash_records (uid, session_id, hash2)
         VALUES (?, ?, ?)`,
        [uidClean, session.id, hash2]
      );
    } catch (db2Error) {
      console.error(`❌ DB2 write failed:`, db2Error.message);
      return res.status(500).json({
        error:  "Vote saved in DB1 but failed to encrypt into DB2.",
        detail: db2Error.message,
      });
    }

    console.log(`✅ Step 2 done — DB2 updated`);
    console.log(`🎉 Both DB1 and DB2 updated for ${uidClean} session ${session.id}`);

    res.json({
      message: `Vote received and encrypted for ${session.name}`,
      db1:     { uid: uidClean, hash1: h1, timestamp2: t2, sessionId: session.id },
      db2:     { uid: uidClean, hash2, sessionId: session.id },
    });

  } catch (err) {
    console.error("receive-h1 error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/voters/timeout ──────────────────────────────────
router.post("/timeout", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "UID required" });

    const uidClean = uid.toUpperCase().trim();

    const [sessions] = await pool.execute(
      `SELECT * FROM vote_sessions
       WHERE uid = ? AND hardware_initiated = 1 AND vote_processed = 0`,
      [uidClean]
    );

    if (sessions.length === 0)
      return res.json({ message: "No active session to timeout" });

    await resetSession(sessions[0].id);

    res.json({
      message: `Timeout applied for ${uidClean}. Session cleared.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/voters/hash-records ──────────────────────────────
// returns all DB2 records
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
    await pool.execute("DELETE FROM voters_master");
    await pool.execute("DELETE FROM vote_sessions");
    await pool.execute("DELETE FROM hash_records");
    res.json({ message: "All data cleared from DB0, DB1 and DB2" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AUTO PROCESS H1 when hardware sends DONE via serial ───────
serialHandler.setOnH1Received(async ({ uid, h1 }) => {
  console.log(`🔄 Auto-processing H1 for ${uid} from hardware...`);
  try {
    const uidClean = uid.toUpperCase().trim();

    const [sessions] = await pool.execute(
      `SELECT * FROM vote_sessions
       WHERE uid = ? AND hardware_initiated = 1 AND vote_processed = 0`,
      [uidClean]
    );

    if (sessions.length === 0) {
      console.error(`❌ No active session for ${uidClean}`);
      return;
    }

    const session = sessions[0];

    if (!session.initiated_at || isTimedOut(session)) {
      await resetSession(session.id);
      console.error(`❌ Session timed out for ${uidClean}`);
      return;
    }

    // STEP 1 — save to DB1
    const t2 = new Date();
    console.log(`📝 Step 1 — Saving H1 + T2 to DB1 session ${session.id}...`);

    await pool.execute(
      `UPDATE vote_sessions
       SET hash1          = ?,
           timestamp2     = ?,
           vote_processed = 1,
           initiated_at   = NULL
       WHERE id = ?`,
      [h1, t2, session.id]
    );

    console.log(`✅ Step 1 done — DB1 updated`);

    // verify
    const [verify] = await pool.execute(
      "SELECT hash1, vote_processed FROM vote_sessions WHERE id = ?",
      [session.id]
    );

    if (!verify[0].hash1 || !verify[0].vote_processed) {
      console.error(`❌ DB1 verification failed`);
      return;
    }

    console.log(`✅ Step 1 verified`);

    // STEP 2 — RSA encrypt → DB2
    console.log(`🔐 Step 2 — RSA encrypting and saving to DB2...`);

    const d1    = `${uidClean}||${h1}||${t2.toISOString()}`;
    const hash2 = encryptToHash(d1);

    await pool.execute(
      `INSERT INTO hash_records (uid, session_id, hash2)
       VALUES (?, ?, ?)`,
      [uidClean, session.id, hash2]
    );

    console.log(`✅ Step 2 done — DB2 updated`);
    console.log(`🎉 Vote fully processed for ${session.name} (${uidClean}) session ${session.id}`);

  } catch (err) {
    console.error(`❌ Auto H1 processing error for ${uid}:`, err.message);
  }
});
// ── GET /api/voters/export-for-blockchain ────────────────────────────
// Called REMOTELY by the Blockchain machine over WiFi.
// Returns all completed vote records (uid + hash2) so the blockchain
// script can fetch them over HTTP instead of connecting directly to MySQL.
// Protected by a shared API key in the X-API-Key header.
router.get("/export-for-blockchain", async (req, res) => {
  try {
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
    console.error("Export error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/voters/export-for-blockchain ────────────────────────────
// Called REMOTELY by the Blockchain machine over WiFi.
// Returns all completed vote records (uid + hash2) so the blockchain
// script can fetch them over HTTP instead of connecting directly to MySQL.
// Protected by a shared API key in the X-API-Key header.
router.get("/export-for-blockchain", async (req, res) => {
  try {
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
    console.error("Export error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;