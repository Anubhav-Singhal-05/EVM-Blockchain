/**
 * serial-bridge.js
 * ─────────────────────────────────────────────────────────────────────
 * Reads vote packets from the ESP over USB Serial, then calls your
 * voting backend's  POST /api/voters/receive-h1  API.
 *
 * SETUP:
 *   1. cd voting-backend
 *   2. npm install serialport      (one-time)
 *   3. Find your ESP COM port:
 *        Windows → Device Manager → Ports (COM & LPT)
 *        e.g.  COM3, COM5, COM8
 *   4. Edit SERIAL_PORT below
 *   5. Make sure the backend server is already running:
 *        node src/server.js
 *   6. Run this bridge in a SEPARATE terminal:
 *        node serial-bridge.js
 *
 * PROTOCOL (matches esp_voting_hardware.ino):
 *   ESP  → Bridge :  VOTE:{"uid":"UID001","h1":"<b64>","ts1":"<ms>"}\n
 *   Bridge → ESP  :  ACK:OK\n
 *   Bridge → ESP  :  ACK:TIMEOUT\n
 *   Bridge → ESP  :  ACK:REJECTED:<reason>\n
 *   Bridge → ESP  :  ACK:ERROR\n
 *   Lines starting with LOG: are printed to console, not processed.
 * ─────────────────────────────────────────────────────────────────────
 */

"use strict";

const { SerialPort }    = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const http              = require("http");

// ══════════════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURE THESE
// ══════════════════════════════════════════════════════════════════════

// Windows: "COM3" / "COM5" etc.  Find in Device Manager → Ports (COM & LPT)
const SERIAL_PORT = "COM3";        // ← CHANGE to your ESP's COM port
const BAUD_RATE   = 115200;

// Your backend (must be running separately: node src/server.js)
const BACKEND_HOST = "localhost";
const BACKEND_PORT = 5000;
const BACKEND_PATH = "/api/voters/receive-h1";

// ══════════════════════════════════════════════════════════════════════
//  HTTP helper — POST JSON to backend
// ══════════════════════════════════════════════════════════════════════

function postToBackend(uid, h1) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ uid, h1 });
    const options = {
      hostname: BACKEND_HOST,
      port:     BACKEND_PORT,
      path:     BACKEND_PATH,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data",  (chunk) => (raw += chunk));
      res.on("end",   () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Backend timeout")); });
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Serial port setup
// ══════════════════════════════════════════════════════════════════════

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  🔌 Voting Serial Bridge — Wired USB Mode");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Serial port : ${SERIAL_PORT} @ ${BAUD_RATE} baud`);
console.log(`  Backend     : http://${BACKEND_HOST}:${BACKEND_PORT}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

const port = new SerialPort({
  path:     SERIAL_PORT,
  baudRate: BAUD_RATE,
});

const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

// ── Helper: write ACK back to ESP ────────────────────────────────────
function sendACK(ackString) {
  const line = ackString + "\n";
  port.write(line, (err) => {
    if (err) console.error("  [Serial] Write error:", err.message);
    else     console.log(`  [→ ESP]  ${ackString}`);
  });
}

// ── Port open / error events ─────────────────────────────────────────
port.on("open", () => {
  console.log(`✅ Serial port ${SERIAL_PORT} opened. Listening for votes...\n`);
});

port.on("error", (err) => {
  console.error("❌ Serial port error:", err.message);
  console.error("   → Is the COM port correct? Is the ESP connected?");
  process.exit(1);
});

// ══════════════════════════════════════════════════════════════════════
//  Main line handler
// ══════════════════════════════════════════════════════════════════════

// Guard: only process one vote at a time
let processing = false;

parser.on("data", async (line) => {
  line = line.trim();
  if (!line) return;

  // ── LOG lines: just print, don't process ──────────────────────────
  if (line.startsWith("LOG:")) {
    console.log(`  [ESP]  ${line.slice(4)}`);
    return;
  }

  // ── VOTE lines ────────────────────────────────────────────────────
  if (line.startsWith("VOTE:")) {
    if (processing) {
      console.warn("  ⚠️  Already processing a vote — ignoring duplicate");
      sendACK("ACK:ERROR");
      return;
    }

    processing = true;
    const timestamp = new Date().toLocaleTimeString("en-IN");
    console.log(`\n${"─".repeat(50)}`);
    console.log(`  📥 [${timestamp}] Vote packet received`);

    let parsed;
    try {
      parsed = JSON.parse(line.slice(5));   // strip "VOTE:" prefix
    } catch (e) {
      console.error("  ❌ JSON parse error:", e.message);
      console.error("  Raw line:", line);
      sendACK("ACK:ERROR");
      processing = false;
      return;
    }

    const { uid, h1, ts1 } = parsed;

    if (!uid || !h1) {
      console.error("  ❌ Missing uid or h1 in packet");
      sendACK("ACK:ERROR");
      processing = false;
      return;
    }

    console.log(`  uid : ${uid}`);
    console.log(`  ts1 : ${ts1} ms (hardware uptime)`);
    console.log(`  h1  : ${h1.substring(0, 50)}...`);
    console.log(`  Forwarding to backend...`);

    // ── POST to backend ──────────────────────────────────────────────
    let result;
    try {
      result = await postToBackend(uid, h1);
    } catch (err) {
      console.error("  ❌ Backend unreachable:", err.message);
      console.error("     → Is  node src/server.js  running?");
      sendACK("ACK:ERROR");
      processing = false;
      return;
    }

    console.log(`  HTTP ${result.status} ← backend`);

    // ── Map HTTP response → ACK ──────────────────────────────────────
    if (result.status === 200) {
      const { db1, db2 } = result.body;
      console.log(`  ✅ ACCEPTED`);
      console.log(`     DB1 → uid=${db1?.uid}  T2=${db1?.timestamp2}`);
      console.log(`     DB2 → hash2=${String(db2?.hash2).substring(0, 40)}...`);
      sendACK("ACK:OK");

    } else if (result.status === 408) {
      const msg = result.body?.error || "Session timed out";
      console.log(`  ⏰ TIMEOUT: ${msg}`);
      sendACK("ACK:TIMEOUT");

    } else if (result.status === 400) {
      const msg = result.body?.error || "Bad request";
      console.log(`  ⚠️  REJECTED: ${msg}`);
      // Sanitize message for serial (no newlines)
      const safe = msg.replace(/[\r\n]/g, " ").substring(0, 80);
      sendACK(`ACK:REJECTED:${safe}`);

    } else {
      console.log(`  ❌ Unexpected HTTP ${result.status}:`, result.body);
      sendACK("ACK:ERROR");
    }

    console.log(`${"─".repeat(50)}\n`);
    processing = false;
    return;
  }

  // ── Any other line: print for debugging ───────────────────────────
  console.log(`  [ESP raw]  ${line}`);
});

// ══════════════════════════════════════════════════════════════════════
//  Utility: list available COM ports (run with --list flag)
// ══════════════════════════════════════════════════════════════════════

if (process.argv.includes("--list")) {
  SerialPort.list().then((ports) => {
    console.log("\n  Available serial ports:");
    if (ports.length === 0) {
      console.log("  (none found — is the ESP plugged in?)");
    } else {
      ports.forEach((p) => {
        console.log(`    ${p.path.padEnd(10)} ${p.manufacturer || ""}`);
      });
    }
    process.exit(0);
  });
}
