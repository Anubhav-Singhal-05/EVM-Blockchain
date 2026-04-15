#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <Adafruit_Fingerprint.h>
#include <mbedtls/base64.h> // ESP32 Native Base64 Library

// Initialize LCD
LiquidCrystal_I2C lcd(0x27, 20, 4);

// Physical Hardware Pins
const int JOY_Y_PIN = 34;
const int CONFIRM_BTN_PIN = 33; 

// Hardware Serial 2 for AS608
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// System States
enum State { WAITING_INIT, WAITING_VOTER, SCANNING_F1, VOTING, SCANNING_F2, PROCESSING };
State currentState = WAITING_INIT;

// Global Variables
String candidates[10];
int numCandidates = 0;
String currentVoterID = "";
String currentVoterName = "";
long currentTimestamp = 0;
unsigned long voteStartMillis = 0;
int selectedVoteIndex = -1;

// Fingerprint Storage for the active vote
String f1_data = "";
String f2_data = "";

// Joystick Menu Variables
int cursorIndex = 0;
int windowTop = 0;
bool joystickLocked = false;

// Forward Declarations
void processLaptopCommand(String json);
void captureFingerprint(int bufferID);
String extractBase64Template(int bufferID);
void executeScanF1();
void handleVotingMenu();
void updateWindow();
void drawMenu();
void executeScanF2();
void sendDonePayload();
long long rsaEncryptChar(long long base, long long exp, long long mod);

void setup() {
  Serial.begin(115200); 
  pinMode(CONFIRM_BTN_PIN, INPUT_PULLUP);
  
  delay(2000); 
  
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("BOOTING SYSTEM...");
  
  lcd.setCursor(0, 1);
  lcd.print("CHECKING SCANNER...");
  
  // FORCE ESP32 to route Hardware Serial 2 to physical pins 16 and 17
  mySerial.begin(57600, SERIAL_8N1, 16, 17); 
  delay(50);
  
  if (finger.verifyPassword()) {
    lcd.setCursor(0, 2);
    lcd.print("SCANNER FOUND OK");
  } else {
    lcd.clear();
    lcd.print("SCANNER ERROR!");
    lcd.setCursor(0,1);
    lcd.print("CHECK WIRING G16/G17");
    while (1) { delay(1); } // Hard halt
  }
  delay(1500);
  
  lcd.clear();
  lcd.print("WAITING FOR LAPTOP");
  lcd.setCursor(0, 1);
  lcd.print("SEND INIT COMMAND");
}

void loop() {
  if (Serial.available() > 0) {
    String jsonString = Serial.readStringUntil('\n');
    processLaptopCommand(jsonString);
  }

  switch (currentState) {
    case SCANNING_F1:
      executeScanF1();
      break;
    case VOTING:
      handleVotingMenu();
      break;
    case SCANNING_F2:
      executeScanF2();
      break;
    case PROCESSING:
      sendDonePayload();
      break;
    default:
      break;
  }
}

// void processLaptopCommand(String json) {
//   StaticJsonDocument<512> doc;
//   DeserializationError error = deserializeJson(doc, json);
//   if (error) return;

//   String cmd = doc["cmd"].as<String>();

//   if (cmd == "INIT") {
//     numCandidates = 0;
//     JsonArray arr = doc["candidates"];
//     for (JsonVariant value : arr) {
//       if (numCandidates < 10) {
//         candidates[numCandidates] = value.as<String>();
//         numCandidates++;
//       }
//     }
//     currentState = WAITING_VOTER;
//     lcd.clear();
//     lcd.print("EVM READY.");
//     lcd.setCursor(0, 1);
//     lcd.print("WAITING FOR VOTER");
//     Serial.println("{\"status\":\"READY\"}");
//   } 
//   else if (cmd == "START" && currentState == WAITING_VOTER) {
//     currentVoterID = doc["vid"].as<String>();
//     currentVoterName = doc["vname"].as<String>();
//     currentTimestamp = doc["ts"].as<long>();
    
//     voteStartMillis = millis(); 
//     currentState = SCANNING_F1;
//   }
// }

void processLaptopCommand(String json) {
  // THE FIX: Use V7 JsonDocument instead of V6 StaticJsonDocument
  JsonDocument doc; 
  
  // THE FIX: Strip hidden carriage returns that VS Code's terminal adds
  json.trim(); 
  
  DeserializationError error = deserializeJson(doc, json);

  if (error) {
    // This will now tell us exactly WHY it failed if your JSON is formatted wrong
    Serial.print("{\"error\":\"INVALID_JSON: ");
    Serial.print(error.c_str());
    Serial.println("\"}");
    return;
  }

  String cmd = doc["cmd"].as<String>();

  if (cmd == "INIT") {
    numCandidates = 0;
    JsonArray arr = doc["candidates"];
    for (JsonVariant value : arr) {
      if (numCandidates < 10) {
        candidates[numCandidates] = value.as<String>();
        numCandidates++;
      }
    }
    currentState = WAITING_VOTER;
    lcd.clear();
    lcd.print("EVM READY.");
    lcd.setCursor(0, 1);
    lcd.print("WAITING FOR VOTER");
    Serial.println("{\"status\":\"READY\"}");
  } 
  else if (cmd == "START" && currentState == WAITING_VOTER) {
    currentVoterID = doc["vid"].as<String>();
    currentVoterName = doc["vname"].as<String>();
    currentTimestamp = doc["ts"].as<long>();
    
    voteStartMillis = millis(); 
    currentState = SCANNING_F1;
  }
}

// Custom RSA Modular Exponentiation
long long rsaEncryptChar(long long base, long long exp, long long mod) {
  long long res = 1;
  base = base % mod;
  while (exp > 0) {
    if (exp % 2 == 1) res = (res * base) % mod;
    exp = exp >> 1;
    base = (base * base) % mod;
  }
  return res;
}

void captureFingerprint(int bufferID) {
  int p = -1;
  lcd.setCursor(0, 3);
  lcd.print("Waiting for finger..");
  
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
  }

  p = finger.image2Tz(bufferID);
  if (p == FINGERPRINT_OK) {
    lcd.setCursor(0, 3);
    lcd.print("Template Converted. ");
    delay(500);
  } else {
    lcd.setCursor(0, 3);
    lcd.print("Conversion Failed.  ");
    delay(2000); 
  }
}

String extractBase64Template() {
  lcd.setCursor(0, 3);
  lcd.print("Extracting Data...  ");
  
  // Instruct the scanner to upload Buffer 1 (The only buffer Adafruit supports)
  finger.getModel();
  
  uint8_t templateBuffer[1024]; 
  int templateLen = 0;
  uint32_t starttime = millis();
  
  // Read UART packets
  while ((millis() - starttime) < 1000) {
    if (mySerial.available()) {
      templateBuffer[templateLen++] = mySerial.read();
      starttime = millis(); 
    }
  }

  if (templateLen < 100) return "ERROR_READ";

  // Safely encode to Base64
  unsigned char base64Buffer[2048] = {0}; 
  size_t outputLen = 0; 
  int encodeStatus = mbedtls_base64_encode(base64Buffer, sizeof(base64Buffer), &outputLen, templateBuffer, templateLen);

  if (encodeStatus != 0) return "ERROR_ENCODE";

  String b64String = "";
  b64String.reserve(1200); 
  for (size_t i = 0; i < outputLen; i++) {
    if (base64Buffer[i] != '\0' && base64Buffer[i] != '\n' && base64Buffer[i] != '\r') { 
      b64String += (char)base64Buffer[i];
    }
  }
  return b64String;
}

void executeScanF1() {
  delay(2000);
  lcd.clear();
  lcd.print("Welcome:");
  lcd.setCursor(0, 1);
  lcd.print(currentVoterName);
  lcd.setCursor(0, 2);
  lcd.print("Please Scan Finger 1");
  
  captureFingerprint(1); 
  f1_data = extractBase64Template(); // Updated function call
  
  if(f1_data.startsWith("ERROR")) {
    lcd.clear(); lcd.print("SCAN 1 FAILED."); delay(2000);
    currentState = WAITING_VOTER; 
    return;
  }
  
  cursorIndex = 0;
  windowTop = 0;
  drawMenu();
  currentState = VOTING;
}

void handleVotingMenu() {
  int joyY = analogRead(JOY_Y_PIN);
  
  if (joyY < 500 && !joystickLocked) {
    if (cursorIndex > 0) cursorIndex--;
    updateWindow();
    drawMenu();
    joystickLocked = true;
  } else if (joyY > 3500 && !joystickLocked) {
    if (cursorIndex < numCandidates - 1) cursorIndex++;
    updateWindow();
    drawMenu();
    joystickLocked = true;
  } else if (joyY >= 500 && joyY <= 3500) {
    joystickLocked = false; 
  }

  if (digitalRead(CONFIRM_BTN_PIN) == LOW) {
    delay(50); 
    if (digitalRead(CONFIRM_BTN_PIN) == LOW) {
      selectedVoteIndex = cursorIndex;
      currentState = SCANNING_F2;
      
      while(digitalRead(CONFIRM_BTN_PIN) == LOW) {
        delay(10); 
      }
    }
  }
}

void updateWindow() {
  if (cursorIndex < windowTop) {
    windowTop = cursorIndex;
  } else if (cursorIndex >= windowTop + 3) {
    windowTop = cursorIndex - 2;
  }
}

void drawMenu() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SELECT CANDIDATE:");
  
  for (int i = 0; i < 3; i++) {
    int dataIndex = windowTop + i;
    if (dataIndex < numCandidates) {
      lcd.setCursor(0, i + 1);
      if (dataIndex == cursorIndex) {
        lcd.print(">"); 
      } else {
        lcd.print(" ");
      }
      lcd.print(" ");
      lcd.print(candidates[dataIndex]);
    }
  }
}

void executeScanF2() {
  lcd.clear();
  lcd.print("Vote Selected:");
  lcd.setCursor(0, 1);
  lcd.print(candidates[selectedVoteIndex]);
  lcd.setCursor(0, 2);
  lcd.print("Scan Finger again");
  
  captureFingerprint(1); // THE FIX: Overwrite Buffer 1
  f2_data = extractBase64Template(); // Updated function call
  
  if(f2_data.startsWith("ERROR")) {
    lcd.clear(); lcd.print("SCAN 2 FAILED."); delay(2000);
    currentState = WAITING_VOTER; 
    return;
  }
  
  currentState = PROCESSING;
}

void sendDonePayload() {
  lcd.clear();
  lcd.print("ENCRYPTING DATA...");
  lcd.setCursor(0, 1);
  lcd.print("PLEASE WAIT (10s)"); // Cryptography takes time
  
  unsigned long elapsedSeconds = (millis() - voteStartMillis) / 1000;
  long updated_ts = currentTimestamp + elapsedSeconds;

  String paddedVote = candidates[selectedVoteIndex];
  while(paddedVote.length() < 15) {
    paddedVote += " ";
  }

  // 1. Construct the massive raw string
  String rawBlock = paddedVote + "|" + f1_data + "|" + f2_data + "|" + String(updated_ts);

  // 2. Safely reserve 10KB of memory to prevent a heap crash
  String h1_encrypted = "";
  h1_encrypted.reserve(10000); 

  // 3. Encrypt into 4-character Hex blocks
  long long rsa_n = 3233;
  long long rsa_e = 17;
  
  for (int i = 0; i < rawBlock.length(); i++) {
    long long m = (long long)rawBlock.charAt(i); 
    long long c = rsaEncryptChar(m, rsa_e, rsa_n); 
    
    char hexBlock[5];
    sprintf(hexBlock, "%04X", (unsigned int)c); 
    h1_encrypted += String(hexBlock);
  }

  // 4. Dynamic memory allocation for a huge JSON payload
  DynamicJsonDocument doc(16384); 
  doc["cmd"] = "DONE";
  doc["vid"] = currentVoterID;
  doc["vname"] = currentVoterName;
  doc["h1"] = h1_encrypted;
  doc["status"] = "SUCCESS";
  
  serializeJson(doc, Serial);
  Serial.println(); 
  
  lcd.clear();
  lcd.print("VOTE RECORDED.");
  lcd.setCursor(0, 1);
  lcd.print("PLEASE STEP AWAY.");
  delay(3000);
  
  // Clear the global variables to prevent data leakage between voters
  f1_data = "";
  f2_data = "";
  
  lcd.clear();
  lcd.print("EVM READY.");
  lcd.setCursor(0, 1);
  lcd.print("WAITING FOR VOTER");
  
  currentState = WAITING_VOTER; 
}

// check for payload function

// void sendDonePayload() {
//   lcd.clear();
//   lcd.print("GENERATING PAYLOAD..");
  
//   // 1. Calculate updated timestamp
//   unsigned long elapsedSeconds = (millis() - voteStartMillis) / 1000;
//   long updated_ts = currentTimestamp + elapsedSeconds;

//   // 2. Pad the vote to completely hide length (Pad to 15 chars)
//   String paddedVote = candidates[selectedVoteIndex];
//   while(paddedVote.length() < 15) {
//     paddedVote += " ";
//   }

//   // 3. Construct the exact raw string that WOULD be encrypted
//   String rawBlock = paddedVote + "|" + f1_data + "|" + f2_data + "|" + String(updated_ts);

//   // 4. Dynamic memory allocation for the JSON payload
//   // 4096 is enough here because we aren't blowing up the size with hex expansion
//   DynamicJsonDocument doc(8192); 
//   doc["cmd"] = "DONE";
//   doc["vid"] = currentVoterID;
//   doc["vname"] = currentVoterName;
  
//   // THE FIX: Send the raw, unencrypted string directly to the laptop
//   doc["debug_raw_block"] = rawBlock; 
  
//   doc["status"] = "SUCCESS";
  
//   serializeJson(doc, Serial);
//   Serial.println(); 
  
//   lcd.clear();
//   lcd.print("VOTE RECORDED.");
//   lcd.setCursor(0, 1);
//   lcd.print("PLEASE STEP AWAY.");
//   delay(3000);
  
//   // Clear the global variables to prevent data leakage between voters
//   f1_data = "";
//   f2_data = "";
  
//   lcd.clear();
//   lcd.print("EVM READY.");
//   lcd.setCursor(0, 1);
//   lcd.print("WAITING FOR VOTER");
  
//   currentState = WAITING_VOTER; 
// }