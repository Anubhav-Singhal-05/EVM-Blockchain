# Bridge: Middleware Voting Software ↔ Blockchain Software

## Problem

After voting is complete, the Middleware Voting Software has all records in MySQL (`hash_records` table: `uid`, `hash2`). The Blockchain Software needs to upload these records to Ganache. Currently there is no connection between the two.

The bridge needs to:
1. Read `hash2` (E2) records from MySQL
2. **Decrypt E2** → recover `uid || E1 || TS2`
3. **Decrypt E1** (H1) → extract `V` (candidate choice) from `uid || F1 || F2 || V || TS1`
4. **Call `castVote(uid, V, E1, TS1, E2, TS2)`** on the deployed VotingContract

## Assumptions

> [!IMPORTANT]
> 1. **E1 format (H1 from ESP32)**: For this demo, we assume H1 is produced by [encryptToHash(uid + "||" + F1 + "||" + F2 + "||" + V + "||" + TS1)](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js#24-27) using the **same RSA toy key pair** (p=61, q=53, n=3233, e=17, d=2753) as the middleware. The bridge will decrypt it using [decryptFromHash](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js#28-33) from [/utils/rsa.js](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js), then parse out fields by splitting on `"||"`.
> 2. **E2 format (H2 from middleware)**: [encryptToHash(uid + "||" + h1 + "||" + ts2.toISOString())](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js#24-27) — same RSA key pair.
> 3. The Blockchain Software's `VotingContract` is already **deployed** on Ganache before the bridge is run.
> 4. **Same database** (`voting_db` on `localhost:3306`) is accessible from both the middleware server computer and the bridge script.
> 5. Ganache is running on **port 7545**.

---

## Files Changed / Created

### Bridge Service (new standalone Node.js script)

#### [MODIFY] [upload_votes.js](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Blockchain%20Software/blockchain/scripts/upload_votes.js)
Rewrite this script to use the **actual middleware DB schema** and **two-layer decryption**:
- Connect to `voting_db`, query `hash_records` JOIN `voters`
- Decrypt `hash2` → parse `uid`, `h1`, `ts2`
- Decrypt `h1` → parse `F1`, `F2`, `V`, `TS1`
- Call `castVote(uid, V, h1_encoded, TS1, hash2, TS2)` on-chain

#### [NEW] [rsa.js](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Blockchain%20Software/blockchain/scripts/rsa.js)
Copy of the shared RSA utility ([/utils/rsa.js](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js)) so the bridge script doesn't depend on the middleware project's file path.

#### [MODIFY] [package.json](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Blockchain%20Software/blockchain/package.json)
Add `dotenv` dependency (to read DB credentials from [.env](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/.env)).

#### [NEW] [.env](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Blockchain%20Software/blockchain/.env)
Environment file with DB credentials (same as middleware's [.env](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/.env)) and Ganache URL.

---

### Middleware Backend — New Bridge Trigger Route

#### [MODIFY] [voterRoutes.js](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/routes/voterRoutes.js)
Add **`POST /api/voters/upload-to-blockchain`** endpoint that:
1. Reads all `hash_records` + corresponding `voters` rows
2. Decrypts each `hash2` → `uid`, `h1`, `ts2`
3. Decrypts `h1` → extracts `V`, `TS1`
4. Calls `castVote` on the blockchain contract via Web3
5. Returns a summary: how many uploaded, how many skipped (already on-chain)

#### [MODIFY] [package.json (backend)](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/package.json)
Add `web3` dependency for blockchain interaction.

---

### Middleware Frontend — Admin Panel Upload Button

#### [MODIFY] [AdminPanel.jsx](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-frontend/src/pages/AdminPanel.jsx)
Add an **"📤 Upload to Blockchain"** button in the Admin Panel that:
- Calls `POST /api/voters/upload-to-blockchain`
- Shows a progress/result toast with how many votes were uploaded

---

## Data Flow

```
MySQL: hash_records
  uid | hash2 (= encryptToHash("uid||h1||ts2"))
       ↓  decryptFromHash(hash2)
  → "UID001||<h1_base64>||2026-03-10T..."
       ↓  parse by first "||" split
  uid = "UID001"
  h1  = <base64 blob>
  ts2 = "2026-03-10T..."
       ↓  decryptFromHash(h1)
  → "UID001||<F1>||<F2>||CandidateA||2026-03-10T..."
       ↓  parse fields
  V   = "CandidateA"
  TS1 = "2026-03-10T..."
       ↓  castVote on-chain
  VotingContract.castVote(uid, V, h1, TS1, hash2, ts2)
```

> [!NOTE]
> The contract stores [(VID, V)](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js#1-13) in plaintext for public verification, and [(E1=h1, TS1, E2=hash2, TS2=ts2)](file:///c:/Desktop/Assignments/Sem%206/IoT/Project/Middleware%20Voting%20Software/voting-backend/src/utils/rsa.js#1-13) as encrypted blobs for auditability.

---

## Verification Plan

### Automated (existing Truffle tests unchanged)
```bash
cd "Blockchain Software/blockchain"
npx truffle test
```

### End-to-End Manual Test
1. Start Ganache on port 7545
2. Start middleware backend (`npm run dev` in `voting-backend`)
3. Deploy blockchain contract: `npx truffle migrate`
4. Process a vote through the officer panel
5. Click **"📤 Upload to Blockchain"** in the Admin Panel
6. Verify result toast shows success
7. Open terminal, run `node scripts/verify_votes.js` in `Blockchain Software/blockchain` to see on-chain tally
