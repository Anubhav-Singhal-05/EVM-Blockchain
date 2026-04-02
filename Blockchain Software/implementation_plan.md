# Blockchain Component for Electronic Voting Machine (EVM)

Build the Solidity smart contract and supporting Node.js scripts to store, count, and verify votes on a local Ganache blockchain.

## Assumptions

> [!IMPORTANT]
> The following assumptions are made throughout this plan. Please review carefully.

1. **Ganache** is already installed (or will be installed via `npm`) and runs on `http://127.0.0.1:7545` (default).
2. **Truffle** will be used as the development framework (compile, migrate, test).
3. The **SQL database** already stores two tables:
   - `votes` — columns: `VID (VARCHAR)`, `E1 (TEXT/BLOB)`, `TS1 (BIGINT/VARCHAR)`
   - `encrypted_votes` — columns: `VID (VARCHAR)`, `E2 (TEXT/BLOB)`, `TS2 (BIGINT/VARCHAR)`
4. For the **upload script**, we assume the SQL database is **MySQL** accessible via `mysql2` npm package. If you use a different DB (PostgreSQL, SQLite, etc.) we'll adjust.
5. The **plaintext vote `V`** (candidate choice) is available in the SQL DB alongside the encrypted data, so that it can be stored on-chain for public verification. *(If `V` is only inside `E1`, the upload script will need the ESP32 decryption key to extract it — we'll provide a placeholder for that.)*
6. All monetary/gas costs are irrelevant since we're on a local Ganache network.

---

## Proposed Changes

### Project Structure

All blockchain code will live under a new `blockchain/` folder inside your project:

```
c:\Desktop\Assignments\Sem 6\IoT\Project\blockchain\
├── contracts/
│   └── VotingContract.sol        # [NEW] Solidity smart contract
├── migrations/
│   ├── 1_initial_migration.js    # [NEW] Truffle default migration
│   └── 2_deploy_voting.js        # [NEW] Deploy VotingContract
├── scripts/
│   ├── upload_votes.js           # [NEW] Read SQL DB → write to blockchain
│   └── verify_votes.js           # [NEW] Read & verify votes from blockchain
├── test/
│   └── voting.test.js            # [NEW] Automated Truffle tests
├── truffle-config.js             # [NEW] Truffle configuration (Ganache)
└── package.json                  # [NEW] Node dependencies
```

---

### Smart Contract — `VotingContract.sol`

#### Design

| Storage | Description |
|---------|-------------|
| `mapping(string => VoteRecord)` | Maps each `VID` to its record |
| `string[] vids` | Array of all VIDs (for iteration) |
| `uint256 totalVotes` | Total vote count |
| `mapping(string => uint256) candidateVotes` | Per-candidate vote tally |
| `string[] candidates` | List of unique candidates |

**`VoteRecord` struct:**
```solidity
struct VoteRecord {
    string vid;       // Voter ID (plaintext)
    string vote;      // Candidate choice V (plaintext, for verification)
    string e1;        // Encrypted blob from ESP32
    string ts1;       // Timestamp from ESP32
    string e2;        // Double-encrypted blob from DB
    string ts2;       // Timestamp of second encryption
    bool exists;      // Guard against double-voting
}
```

**Key functions:**

| Function | Access | Purpose |
|----------|--------|---------|
| `castVote(vid, vote, e1, ts1, e2, ts2)` | `onlyOwner` | Store a vote record on-chain |
| `getVote(vid)` | `public view` | Retrieve a single vote record by VID |
| `getTotalVotes()` | `public view` | Return total vote count |
| `getCandidateVotes(candidate)` | `public view` | Return vote count for a candidate |
| `getAllCandidates()` | `public view` | Return list of all candidates |
| `getAllVIDs()` | `public view` | Return list of all voter IDs |
| `verifyVote(vid, expectedVote)` | `public view` | Verify a voter's choice matches |

> [!NOTE]
> `onlyOwner` ensures only the deployer (election authority) can write votes. Anyone can read/verify.

---

### Truffle Configuration — `truffle-config.js`

- Network: `development` pointing to `127.0.0.1:7545` (Ganache default).
- Solidity compiler: `0.8.19`.

---

### Upload Script — `scripts/upload_votes.js`

1. Connect to MySQL using `mysql2/promise`.
2. Query both tables, joining on `VID`.
3. Connect to the deployed `VotingContract` via `@truffle/contract` + `web3`.
4. For each row, call `castVote(vid, vote, e1, ts1, e2, ts2)`.
5. Log results to console.

> [!IMPORTANT]
> **Assumption 5 above**: The script needs `V` (plaintext vote) available in the SQL DB. If `V` is only stored inside the encrypted blob `E1`, you'll need to decrypt it first and we'll add a decryption step. Please confirm.

---

### Verify Script — `scripts/verify_votes.js`

- Reads all votes from the blockchain.
- Prints total tally and per-candidate breakdown.
- Optionally verifies a specific VID's vote.

---

## Verification Plan

### Automated Tests

Run Truffle tests against Ganache:

```bash
cd "c:\Desktop\Assignments\Sem 6\IoT\Project\blockchain"
npx truffle test
```

The test file `test/voting.test.js` will cover:
1. ✅ Deploy contract successfully
2. ✅ Cast a vote and retrieve it
3. ✅ Reject duplicate VID (double-voting prevention)
4. ✅ Only owner can cast votes
5. ✅ Vote count increments correctly
6. ✅ Per-candidate tally is accurate
7. ✅ `verifyVote` returns correct boolean
8. ✅ `getAllVIDs` and `getAllCandidates` return expected arrays

### Manual Verification

1. **Start Ganache** — open Ganache GUI or run `npx ganache` in a terminal.
2. **Deploy** — run `npx truffle migrate --network development` inside the `blockchain/` folder.
3. **Run tests** — run `npx truffle test` and confirm all pass.
4. **Upload from DB** — (once your SQL DB has data) run `node scripts/upload_votes.js` and check console output.
5. **Verify on-chain** — run `node scripts/verify_votes.js` and confirm tallies match expectations.
