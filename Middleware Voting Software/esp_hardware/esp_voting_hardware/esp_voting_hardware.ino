/*
 * =====================================================================
 *  ESP32 / ESP8266 — Voting Hardware Client  (WIRED / USB-Serial)
 *  Sends encrypted vote (H1) to PC via USB cable → serial-bridge.js
 * =====================================================================
 *
 * HARDWARE REQUIRED:
 *   - ESP32 or ESP8266 board (USB cable to PC — no WiFi needed)
 *   - MFRC522 RFID reader (SPI)
 *   - 4 push buttons (Candidate A, B, C, D) — wired between pin & GND
 *   - 3 LEDs (Ready=Blue, Success=Green, Error=Red) + 220Ω resistors
 *
 * LIBRARIES — install via Arduino IDE → Tools → Manage Libraries:
 *   ✅ MFRC522    by GithubCommunity
 *
 * NO WiFi. NO HTTP. Communicates purely over USB Serial at 115200 baud.
 *
 * PROTOCOL (one JSON line per vote):
 *   ESP  → PC  :  VOTE:{"uid":"UID001","h1":"<base64>","ts1":"<millis>"}\n
 *   PC   → ESP :  ACK:OK\n          → Vote accepted (green LED)
 *   PC   → ESP :  ACK:TIMEOUT\n     → Session expired (red LED)
 *   PC   → ESP :  ACK:REJECTED:<msg>\n  → Not initiated / already voted
 *   PC   → ESP :  ACK:ERROR\n       → Server or bridge error
 *
 * RSA PARAMS — MUST match backend src/utils/rsa.js:
 *   p=61, q=53, n=3233, e=17
 *
 * E1 FORMAT — matches .env  E1_VOTE_INDEX=3  E1_TS1_INDEX=4:
 *   "uid||F1_rawRFID||F2_deviceID||Vote||TS1_millis"
 * =====================================================================
 */

#include <SPI.h>
#include <MFRC522.h>

// ══════════════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURE THESE BEFORE UPLOADING
// ══════════════════════════════════════════════════════════════════════

// Candidate names — must match your blockchain contract
const char* CANDIDATES[]  = { "CandidateA", "CandidateB", "CandidateC", "CandidateD" };
const int   NUM_CANDIDATES = 4;

// Device fingerprint stored in E1 field F2
const char* DEVICE_ID = "ESP_HW_V1";

// ── Pin Definitions ──────────────────────────────────────────────────
#ifdef ESP32
  #define RFID_SS_PIN   5     // SDA/CS → GPIO5
  #define RFID_RST_PIN  22    // RST    → GPIO22
  // Default SPI: MOSI=23, MISO=19, SCK=18

  #define BTN_A  12           // connect between pin and GND
  #define BTN_B  14
  #define BTN_C  27
  #define BTN_D  26

  #define LED_READY    2      // Blue  — waiting (220Ω to GND)
  #define LED_SUCCESS  4      // Green — accepted
  #define LED_ERROR   16      // Red   — rejected / error

#else
  // ESP8266 (NodeMCU)
  #define RFID_SS_PIN   D4
  #define RFID_RST_PIN  D3
  // Default SPI: MOSI=D7, MISO=D6, SCK=D5

  #define BTN_A  D5
  #define BTN_B  D0
  #define BTN_C  D1
  #define BTN_D  D2

  #define LED_READY    D8
  #define LED_SUCCESS  A0
  #define LED_ERROR    D9
#endif

// ── RSA Parameters — MUST match rsa.js ──────────────────────────────
const uint32_t RSA_N = 3233;   // p=61, q=53
const uint32_t RSA_E = 17;

// ── Globals ──────────────────────────────────────────────────────────
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// ══════════════════════════════════════════════════════════════════════
//  🔐  RSA + Base64  —  mirrors rsa.js encryptToHash() exactly
// ══════════════════════════════════════════════════════════════════════

/** Modular exponentiation — same as rsa.js modPow() */
uint32_t modPow(uint32_t base, uint32_t exp, uint32_t mod) {
  uint64_t result = 1ULL;
  uint64_t b      = (uint64_t)(base % mod);
  while (exp > 0) {
    if (exp & 1) result = (result * b) % (uint64_t)mod;
    exp >>= 1;
    b = (b * b) % (uint64_t)mod;
  }
  return (uint32_t)result;
}

/**
 * RSA char-by-char encrypt → comma-separated numbers.
 * Mirrors: rsaEncrypt(plaintext).join(",")
 */
String rsaEncryptCommaSep(const String& text) {
  String out = "";
  out.reserve(text.length() * 5);
  for (size_t i = 0; i < (size_t)text.length(); i++) {
    uint32_t enc = modPow((uint8_t)text[i], RSA_E, RSA_N);
    if (i > 0) out += ',';
    out += String(enc);
  }
  return out;
}

// Base64 table
static const char B64[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 encode bytes — mirrors Buffer.from(str).toString("base64") */
String base64Encode(const uint8_t* data, size_t len) {
  String out = "";
  out.reserve(((len + 2) / 3) * 4 + 1);
  for (size_t i = 0; i < len; i += 3) {
    uint8_t b0 = data[i];
    uint8_t b1 = (i + 1 < len) ? data[i + 1] : 0;
    uint8_t b2 = (i + 2 < len) ? data[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += (i + 1 < len) ? B64[((b1 & 0x0F) << 2) | (b2 >> 6)] : '=';
    out += (i + 2 < len) ? B64[b2 & 0x3F] : '=';
  }
  return out;
}

/**
 * Full pipeline: plaintext → RSA → comma-join → Base64
 * Mirrors: encryptToHash(plaintext) in rsa.js
 */
String encryptToHash(const String& plaintext) {
  String commaSep = rsaEncryptCommaSep(plaintext);
  return base64Encode((const uint8_t*)commaSep.c_str(), commaSep.length());
}

// ══════════════════════════════════════════════════════════════════════
//  💡  LED helpers
// ══════════════════════════════════════════════════════════════════════

void blinkLED(int pin, int times, int ms = 200) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH); delay(ms);
    digitalWrite(pin, LOW);  delay(ms);
  }
}
void showReady()   { digitalWrite(LED_READY, HIGH); digitalWrite(LED_SUCCESS, LOW);  digitalWrite(LED_ERROR, LOW); }
void showBusy()    { digitalWrite(LED_READY, LOW);  digitalWrite(LED_SUCCESS, LOW);  digitalWrite(LED_ERROR, LOW); }
void showSuccess() { digitalWrite(LED_READY, LOW);  blinkLED(LED_SUCCESS, 4, 250);   digitalWrite(LED_SUCCESS, HIGH); }
void showError()   { digitalWrite(LED_READY, LOW);  blinkLED(LED_ERROR,   6, 150);   digitalWrite(LED_ERROR, LOW); }

// ══════════════════════════════════════════════════════════════════════
//  📇  RFID
// ══════════════════════════════════════════════════════════════════════

/** Wait for RFID card — returns raw HEX UID string e.g. "A1B2C3D4" */
String readRFIDCard() {
  while (true) {
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      String raw = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) raw += "0";
        raw += String(rfid.uid.uidByte[i], HEX);
      }
      raw.toUpperCase();
      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
      return raw;
    }
    delay(50);
  }
}

/**
 * Map raw RFID hex → voter UID stored in MySQL.
 *
 * HOW TO FIND CARD HEX:
 *   Open Serial Monitor (115200 baud), scan each card.
 *   It prints: [RFID] UNKNOWN card hex: XXXXXXXX
 *   Copy that hex and add it below.
 *
 * Voter UIDs here MUST match what is in your voters table
 * (seeded via POST /api/voters/seed or added manually).
 */
String mapCardToVoterUID(const String& rawHex) {
  // ── 📝 ADD YOUR CARDS HERE ─────────────────────────────────────
  if (rawHex == "A1B2C3D4") return "UID001";   // Arjun Sharma
  if (rawHex == "E5F60718") return "UID002";   // Priya Patel
  if (rawHex == "29384756") return "UID003";   // Rahul Verma
  if (rawHex == "AABBCCDD") return "UID004";   // Neha Singh
  if (rawHex == "11223344") return "UID005";   // Amit Kumar
  // ───────────────────────────────────────────────────────────────
  return "";   // unknown card
}

// ══════════════════════════════════════════════════════════════════════
//  🗳️  Vote button
// ══════════════════════════════════════════════════════════════════════

const int VOTE_BUTTONS[4] = { BTN_A, BTN_B, BTN_C, BTN_D };

/** Block until a candidate button is pressed (active LOW). Returns 0–3. */
int waitForVoteButton() {
  while (true) {
    for (int i = 0; i < NUM_CANDIDATES; i++) {
      if (digitalRead(VOTE_BUTTONS[i]) == LOW) {
        delay(50);
        if (digitalRead(VOTE_BUTTONS[i]) == LOW) {
          while (digitalRead(VOTE_BUTTONS[i]) == LOW) delay(10);
          return i;
        }
      }
    }
    delay(10);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  📨  Serial communication
// ══════════════════════════════════════════════════════════════════════

/**
 * Send vote line to PC via USB Serial.
 * Format: VOTE:{"uid":"UID001","h1":"<base64>","ts1":"<ms>"}\n
 */
void sendVoteSerial(const String& uid, const String& h1, unsigned long ts1ms) {
  // Build JSON manually (no library needed — keeps sketch lean)
  String msg = "VOTE:{\"uid\":\"" + uid
             + "\",\"h1\":\""    + h1
             + "\",\"ts1\":\""   + String(ts1ms)
             + "\"}\n";
  Serial.print(msg);
}

/**
 * Wait for ACK line from bridge (up to timeoutMs).
 * Returns the raw ACK string without trailing newline.
 */
String waitForACK(unsigned long timeoutMs = 20000) {
  String ack = "";
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\n') return ack;
      ack += c;
    }
    delay(1);
  }
  return "ACK:TIMEOUT_LOCAL";   // bridge never replied
}

// ══════════════════════════════════════════════════════════════════════
//  🚀  SETUP
// ══════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  // LEDs
  pinMode(LED_READY,   OUTPUT);
  pinMode(LED_SUCCESS, OUTPUT);
  pinMode(LED_ERROR,   OUTPUT);
  showBusy();

  // Vote buttons
  for (int i = 0; i < NUM_CANDIDATES; i++)
    pinMode(VOTE_BUTTONS[i], INPUT_PULLUP);

  // RFID
  SPI.begin();
  rfid.PCD_Init();

  // Log startup — bridge will ignore non-VOTE: lines
  Serial.println("LOG:ESP Voting Hardware v1.0 — Wired Serial Mode — ready");
  Serial.println("LOG:RFID initialized. Waiting for voter card.");

  showReady();
}

// ══════════════════════════════════════════════════════════════════════
//  🔄  MAIN LOOP
// ══════════════════════════════════════════════════════════════════════

void loop() {

  // ── STEP 1: Wait for RFID card ──────────────────────────────────
  showReady();
  Serial.println("LOG:Waiting for RFID card...");
  String rawHex = readRFIDCard();
  Serial.println("LOG:[RFID] Scanned hex: " + rawHex);

  // ── STEP 2: Map hex → voter UID ─────────────────────────────────
  String voterUID = mapCardToVoterUID(rawHex);
  if (voterUID == "") {
    Serial.println("LOG:[RFID] UNKNOWN card hex: " + rawHex);
    Serial.println("LOG:Add this hex to mapCardToVoterUID() and re-upload");
    showError();
    delay(3000);
    return;
  }
  Serial.println("LOG:Voter identified: " + voterUID);

  // ── STEP 3: Wait for candidate button ───────────────────────────
  showBusy();
  Serial.println("LOG:Waiting for vote button (A/B/C/D)...");
  int candidateIdx = waitForVoteButton();
  String vote      = String(CANDIDATES[candidateIdx]);
  Serial.println("LOG:Vote selected: " + vote);

  // ── STEP 4: Hardware timestamp (ms since boot) ──────────────────
  unsigned long ts1ms = millis();

  // ── STEP 5: Build E1 plaintext ──────────────────────────────────
  // Format (matches .env): "uid||F1||F2||V||TS1"
  //   [0] uid  [1] rawHex  [2] DEVICE_ID  [3] vote  [4] ts1
  String e1Plain = voterUID + "||"
                 + rawHex   + "||"
                 + String(DEVICE_ID) + "||"
                 + vote      + "||"
                 + String(ts1ms);
  Serial.println("LOG:[E1] " + e1Plain);

  // ── STEP 6: RSA encrypt → H1 ────────────────────────────────────
  Serial.println("LOG:Encrypting H1...");
  String h1 = encryptToHash(e1Plain);
  Serial.println("LOG:[H1] length=" + String(h1.length()) + " chars");

  // ── STEP 7: Send to bridge and wait for ACK ─────────────────────
  Serial.println("LOG:Sending VOTE to bridge...");
  sendVoteSerial(voterUID, h1, ts1ms);

  // Wait for ACK from the PC bridge (up to 20 seconds)
  String ack = waitForACK(20000);
  Serial.println("LOG:ACK received: " + ack);

  // ── STEP 8: React to ACK ────────────────────────────────────────
  if (ack == "ACK:OK") {
    Serial.println("LOG:✅ VOTE ACCEPTED — saved to DB1 and DB2");
    showSuccess();
    delay(5000);

  } else if (ack.startsWith("ACK:TIMEOUT")) {
    Serial.println("LOG:⏰ SESSION TIMED OUT — officer must re-initiate");
    showError();
    delay(4000);

  } else if (ack.startsWith("ACK:REJECTED")) {
    Serial.println("LOG:⚠️  REJECTED — " + ack);
    showError();
    delay(4000);

  } else {
    // ACK:ERROR or ACK:TIMEOUT_LOCAL (bridge not responding)
    Serial.println("LOG:❌ ERROR — " + ack);
    Serial.println("LOG:Is serial-bridge.js running on the PC?");
    showError();
    delay(4000);
  }
}
