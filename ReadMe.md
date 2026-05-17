# Decentralized Biometric Voting System

An end-to-end verifiable e-voting system engineered to eliminate the "black box" vulnerabilities of traditional electronic voting machines (EVMs). By decentralizing the ledger and implementing hardware-level biometric encryption, this architecture removes implicit trust in central authorities, neutralizes network sniffing, and makes proxy voting mathematically impossible.

---

## ⚙️ Core Architecture & "Double-Encryption" Flow

The system utilizes an asynchronous, multi-tiered architecture that relies on Hardware-Level Onion Routing to guarantee physical security and cryptographic anonymity.

*   **Edge (IoT Hardware Interface):** An air-gapped ESP32 microcontroller and AS608 optical fingerprint scanner capture the voter's biometric signature and ballot choice. This payload is concatenated with a timestamp and encrypted locally into a monolithic 4-digit hexadecimal block cipher called `h1`.
*   **Local Middleware (Polling Station Bridge):** Operating as an immediate receiver, the middleware appends Polling Station metadata (Voter ID, Name, Timestamp 2) without decrypting the ballot. This entire data structure is encrypted a second time to generate payload `h2`. In the event of network failure, this middleware acts as an offline cryptographic vault, buffering encrypted votes until connectivity is restored.
*   **Global Backend Server:** Acting as the sole holder of private decryption keys, this server strips the `h2` layer to verify polling station metadata, then decrypts the `h1` payload to extract and match raw biometric templates against the pre-enrolled Global Voter Database.
*   **Blockchain Ledger:** Upon a successful biometric match, the Global Server formats the validated vote into a transaction. The Ethereum/Hyperledger smart contract receives the payload, verifies the hashed Voter ID to reject duplicate attempts, and writes the vote to the immutable tally.

---

## 🛠 Tech Stack

| Component | Technologies Used |
| :--- | :--- |
| **Hardware** | ESP32 Microcontroller, AS608 Optical Fingerprint Scanner, 20x4 LCD, Push Buttons |
| **Frontend** | React + Vite (Voting Middle Software / Officer & Admin Panels) |
| **Backend** | Node.js, Express, MongoDB (Global Voter Database), MySQL (Middleware Database) |
| **Blockchain** | Ethereum (Ganache for local simulation), Web3, Solidity Smart Contracts |

---

## 🚀 System Startup Guide

### Prerequisites

Ensure you have the following installed before proceeding:
*   Node.js (v16+ recommended)
*   Ganache (Running on Port 7545)
*   MongoDB & MySQL (Local or remote instances configured in your `.env` files)

### Boot Sequence

To initialize the environment and enable live blockchain telemetry on the frontend, launch the following services sequentially in separate terminal instances:

#### 1. Ganache (Blockchain)
Must be operational before the API server boots. Ensure Ganache is running on `http://127.0.0.1:7545`. Then, deploy the smart contracts:
```bash
cd "Blockchain Software\blockchain"
npx truffle migrate --network development

```

#### 2. Global DB (MongoDB Bridge)

Establishes the connection to the remote identity database.

```bash
cd voting-global-db
node server.js

```

* **Runs on:** `http://localhost:3000`

#### 3. Blockchain API Server

Exposes the on-chain data to external web services.

```bash
cd "Blockchain Software\blockchain"
npm run api

```

* **Runs on:** `http://localhost:4000`

#### 4. Voting Frontend

Initializes the user interfaces for Registration Officers and Administrators.

```bash
cd "Voting Frontend"
npm run dev

```

* **Access at:** `http://localhost:5173`
* **Default Credentials:** `admin` / `admin123`

---

## 📊 Post-Election Operations: Uploading & Verifying

Following the conclusion of the voting block, the offline-buffered records within the Middleware MySQL database (`hash_records`) must be bridged and written to the blockchain state machine.

### Bridging to Blockchain

* Execute via the Admin Panel by selecting **"📤 Upload to Blockchain"**. This triggers the API to unpack `h2` and `h1`, appending the votes directly to the smart contract via Web3.
* Alternatively, force the manual script execution:
```bash
cd "Blockchain Software\blockchain"
npm run upload


```



```

### Auditing On-Chain Data
Run the verification script to output the immutable tally. Any manual database tampering injected at the middleware level will
result in an immediate cryptographic mismatch against the Generic Block Hash, exposing the breach.
```bash
npm run verify

```

---

## 👥 Contributors

Developed at **Netaji Subhas University of Technology** by:

* **Abhimanyu Mittal**
* **Anubhav Singhal**
* **Shivam**
* **Keshav Verma**
* **Dr. Gaurav Singal** (Advisor)

```


```