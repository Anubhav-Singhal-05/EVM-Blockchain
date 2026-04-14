# 🗳️ EVM Blockchain — Full System Startup Guide

This document explains how to bring up all services so the **Voting Frontend** can display live blockchain data.

---

## Architecture Overview

```
[Voting Frontend]  →  [Blockchain API :4000]  →  [Ganache :7545]
     React/Vite         api_server.js              (local chain)

[Voting Frontend]  →  [Global DB API :3000]   →  [MongoDB Atlas]
     React/Vite         voting-global-db             (remote)
```

---

## Step-by-Step Startup Order

### Terminal 1 — Ganache (Blockchain)
> Must be running **before** the API server starts.

1. Open Ganache
2. Make sure it runs on `http://127.0.0.1:7545`
3. If the contract is not deployed yet:
   ```powershell
   cd "Blockchain Software\blockchain"
   npx truffle migrate --network development
   ```

---

### Terminal 2 — Global DB (MongoDB Bridge)
```powershell
cd voting-global-db
node server.js
```
Runs on: `http://localhost:3000`

---

### Terminal 3 — Blockchain API Server
```powershell
cd "Blockchain Software\blockchain"
npm run api
# or: node scripts/api_server.js
```
Runs on: `http://localhost:4000`

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| GET | `/api/votes` | All on-chain votes |
| GET | `/api/votes/:vid` | Single voter's vote |
| GET | `/api/stats` | Aggregate tally |

---

### Terminal 4 — Voting Frontend
```powershell
cd "Voting Frontend"
npm run dev
```
Opens at: `http://localhost:5173`

Login with: `admin` / `admin123`

---

## Data Flow

1. **Frontend login** → fetches `GET /api/voters` from Global DB (all registered voters)
2. **Frontend** → fetches `GET /api/votes` from Blockchain API (all on-chain ballots)
3. Frontend **merges** both datasets: for each voter in Global DB, looks up if their VID appears in blockchain votes
4. If found → shows `Voted` status, candidate voted for, and timestamp
5. Demographics (age, gender, district, ward) come from Global DB

---

## Uploading Votes to Blockchain

After the voting session, run on the blockchain machine:
```powershell
cd "Blockchain Software\blockchain"
npm run upload
```
Then restart `npm run api` (or it will auto-refresh on next request).

---

## Verifying On-Chain Data

```powershell
npm run verify
```
