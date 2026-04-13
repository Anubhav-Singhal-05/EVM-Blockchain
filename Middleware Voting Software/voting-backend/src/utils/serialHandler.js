const { SerialPort }    = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

// ── CHANGE THIS to your actual COM port ──────────────────────
// Check in Device Manager → Ports (COM & LPT)
const COM_PORT  = "COM7";
const BAUD_RATE = 115200;

let port   = null;
let parser = null;

// callback set by voterRoutes when H1 arrives from hardware
let onH1Received = null;

// ── candidates list sent to hardware on INIT ──────────────────
const CANDIDATES = ["BJP", "INC", "AAP", "TMC", "NOTA"];

// ── open serial connection ────────────────────────────────────
function connect() {
  try {
    port = new SerialPort({
      path:     COM_PORT,
      baudRate: BAUD_RATE,
      autoOpen: true,
    });

    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.on("open", () => {
      console.log(`✅ Serial port ${COM_PORT} connected at ${BAUD_RATE} baud`);
      // send INIT to hardware as soon as port opens
      sendInit();
    });

    port.on("error", (err) => {
      console.error(`❌ Serial port error: ${err.message}`);
    });

    port.on("close", () => {
      console.log(`⚠️  Serial port ${COM_PORT} closed`);
    });

    // ── listen for incoming data from hardware ────────────────
    parser.on("data", (line) => {
      const raw = line.trim();
      if (!raw) return;

      console.log(`📥 Hardware says: ${raw}`);

      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        console.warn(`⚠️  Could not parse hardware message: ${raw}`);
        return;
      }

      // ── hardware sends DONE when voting is complete ───────
      if (msg.cmd === "DONE" && msg.vid && msg.h1) {
        console.log(`🗳️  DONE received from hardware — VID: ${msg.vid}`);
        console.log(`     vname  : ${msg.vname}`);
        console.log(`     h1     : ${msg.h1}`);
        console.log(`     status : ${msg.status}`);

        // only process if hardware reports SUCCESS
        if (msg.status !== "SUCCESS") {
          console.warn(`⚠️  Hardware reported non-SUCCESS status: ${msg.status} — skipping`);
          return;
        }

        if (onH1Received) {
          onH1Received({ uid: msg.vid, h1: msg.h1 });
        } else {
          console.warn("⚠️  No H1 handler registered");
        }
      }
    });

  } catch (err) {
    console.error(`❌ Could not open serial port ${COM_PORT}: ${err.message}`);
    console.error("   → Check COM port number in src/utils/serialHandler.js");
  }
}

// ── send INIT to hardware ─────────────────────────────────────
function sendInit() {
  const msg = JSON.stringify({ cmd: "INIT", candidates: CANDIDATES });
  sendToHardware(msg);
  console.log(`📤 Sent INIT to hardware: ${msg}`);
}

// ── send START to hardware when officer initiates a voter ─────
function sendStart(vid, vname) {
  const msg = JSON.stringify({
    cmd:   "START",
    vid:   vid,
    vname: vname,
    ts:    Math.floor(Date.now() / 1000),
  });
  sendToHardware(msg);
  console.log(`📤 Sent START to hardware: ${msg}`);
}

// ── raw write to serial port ──────────────────────────────────
function sendToHardware(message) {
  if (!port || !port.isOpen) {
    console.warn("⚠️  Serial port not open — cannot send message");
    return;
  }
  port.write(message + "\n", (err) => {
    if (err) console.error(`❌ Write error: ${err.message}`);
  });
}

// ── register callback for when H1 arrives ────────────────────
function setOnH1Received(callback) {
  onH1Received = callback;
}

// ── check if port is connected ────────────────────────────────
function isConnected() {
  return port && port.isOpen;
}

module.exports = {
  connect,
  sendInit,
  sendStart,
  sendToHardware,
  setOnH1Received,
  isConnected,
};