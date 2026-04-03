/**
 * global_db.js
 * ------------
 * Connects to the Global MongoDB voter database (MongoDB Atlas)
 * and provides lookup functions for voter fingerprint data.
 *
 * The Global DB contains voter records with fields:
 *   voterId        (String) — matches the uid from the Middleware DB
 *   fingerprint_1  (String) — Base64-encoded AS608 template (primary finger)
 *   fingerprint_2  (String) — Base64-encoded AS608 template (secondary finger)
 */

require("dotenv").config();
const mongoose = require("mongoose");

let connectionPromise = null;

/**
 * Lazily connect to MongoDB Atlas. Safe to call multiple times.
 */
async function connectGlobalDB() {
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set in .env. " +
      "Set it to your MongoDB Atlas connection string."
    );
  }

  connectionPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });

  await connectionPromise;
  console.log("[GlobalDB] Connected to MongoDB Atlas.");
  return connectionPromise;
}

/**
 * Close the MongoDB connection.
 */
async function disconnectGlobalDB() {
  await mongoose.disconnect();
  connectionPromise = null;
}

/**
 * Fetch a voter's registered fingerprint templates from the Global DB.
 *
 * @param {string} voterId - The voter ID (matches uid in Middleware DB)
 * @returns {{ fingerprint_1: string, fingerprint_2: string } | null}
 *          Returns null if the voter is not found.
 */
async function getVoterFingerprints(voterId) {
  const db = mongoose.connection.db;

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
