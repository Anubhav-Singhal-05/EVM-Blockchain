/**
 * globalDb.js  (Middleware copy)
 * --------------------------------
 * Connects to the Global MongoDB voter database and provides
 * fingerprint lookup. Identical to blockchain/scripts/global_db.js.
 */

const mongoose = require("mongoose");

let connectionPromise = null;

async function connectGlobalDB() {
  if (connectionPromise) return connectionPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set in .env");
  connectionPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  await connectionPromise;
  return connectionPromise;
}

async function disconnectGlobalDB() {
  await mongoose.disconnect();
  connectionPromise = null;
}

async function getVoterFingerprints(voterId) {
  const db    = mongoose.connection.db;
  const voter = await db.collection("voters").findOne(
    { voterId },
    { projection: { fingerprint_1: 1, fingerprint_2: 1, firstName: 1, lastName: 1 } }
  );
  if (!voter) return null;
  return {
    name:          `${voter.firstName || ""} ${voter.lastName || ""}`.trim(),
    fingerprint_1: voter.fingerprint_1 || null,
    fingerprint_2: voter.fingerprint_2 || null,
  };
}

module.exports = { connectGlobalDB, disconnectGlobalDB, getVoterFingerprints };
