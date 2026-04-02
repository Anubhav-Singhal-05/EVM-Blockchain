// ── HARDCODED HARDWARE SIMULATOR ─────────────────────────────
// Run this to simulate hardware sending a vote to the backend
// Usage: node test-hardware.js
// Make sure backend is running on port 5000 first!

const http = require("http");

// ── CHANGE THESE AS NEEDED ────────────────────────────────────
const VOTER_UID = "UID001";          // voter to simulate
const FAKE_H1   = "HARDWAREHASH_ABC123XYZ_VOTE_ENCRYPTED"; // fake H1 from hardware
// ─────────────────────────────────────────────────────────────

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: "localhost",
      port:     5000,
      path:     path,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function runTest() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🔧 HARDWARE SIMULATOR — Voting Middle Software");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Voter UID : ${VOTER_UID}`);
  console.log(`  Fake H1   : ${FAKE_H1}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── STEP 1: Send H1 to backend ───────────────────────────
  console.log("📡 Step 1 — Sending H1 to /api/voters/receive-h1 ...");
  let res;
  try {
    res = await post("/api/voters/receive-h1", {
      uid: VOTER_UID,
      h1:  FAKE_H1,
    });
  } catch (err) {
    console.error("❌ Could not connect to backend. Is it running on port 5000?");
    console.error("   Error:", err.message);
    process.exit(1);
  }

  console.log(`   Status : ${res.status}`);

  if (res.status === 200) {
    console.log("\n✅ SUCCESS — Vote received and encrypted!\n");

    const { db1, db2, message } = res.body;

    console.log("📦 Message  :", message);
    console.log("\n── Database 1 (voters table) ──────────────");
    console.log("   UID        :", db1.uid);
    console.log("   H1 stored  :", db1.hash1);
    console.log("   T2 (time)  :", new Date(db1.timestamp2).toLocaleString());

    console.log("\n── Database 2 (hash_records table) ────────");
    console.log("   UID        :", db2.uid);
    console.log("   Hash2      :", db2.hash2);
    console.log("\n   (Hash2 = RSA encrypted Base64 of uid + H1 + T2)");

  } else if (res.status === 408) {
    console.log("\n⏰ TIMEOUT — Session expired before hardware responded.");
    console.log("   → Go to Officer Panel and Re-Initiate the voter first.\n");

  } else if (res.status === 400) {
    console.log("\n⚠️  ERROR:", res.body.error);
    console.log("\n   → Make sure you clicked ⚡ Initiate in the Officer Panel first!");
    console.log("   → Then run this script again within 60 seconds.\n");

  } else {
    console.log("\n❌ Unexpected response:", res.body);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

runTest();