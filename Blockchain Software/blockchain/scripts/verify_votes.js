/**
 * verify_votes.js
 * ----------------
 * Reads all votes from the deployed VotingContract on Ganache and
 * prints a full tally plus individual vote details.
 *
 * Optionally verify a specific Voter ID's vote by passing it as a CLI arg:
 *   node scripts/verify_votes.js <VID> [expected_vote]
 *
 * ASSUMPTIONS:
 *  1. Ganache is running on http://127.0.0.1:7545.
 *  2. The VotingContract has been deployed via `truffle migrate`.
 */

const Web3 = require("web3");
const path = require("path");

// ── Configuration ──────────────────────────────────────────────────

const GANACHE_URL = "http://127.0.0.1:7545";

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const web3 = new Web3(GANACHE_URL);

  // Load contract ABI & address
  const contractJson = require(path.join(
    __dirname,
    "..",
    "build",
    "contracts",
    "VotingContract.json"
  ));

  const networkId = await web3.eth.net.getId();
  const deployedNetwork = contractJson.networks[networkId];

  if (!deployedNetwork) {
    console.error(
      `[ERROR] VotingContract not deployed on network ${networkId}.` +
      `\n        Run "npx truffle migrate --network development" first.`
    );
    process.exit(1);
  }

  const contract = new web3.eth.Contract(
    contractJson.abi,
    deployedNetwork.address
  );

  console.log(`[Blockchain] Contract address: ${deployedNetwork.address}\n`);

  // ── 1. Overall tally ─────────────────────────────────────────────

  const totalVotes = await contract.methods.getTotalVotes().call();
  const candidates = await contract.methods.getAllCandidates().call();
  const allVIDs    = await contract.methods.getAllVIDs().call();

  console.log("═══════════════════════════════════════");
  console.log("         ELECTION RESULTS TALLY        ");
  console.log("═══════════════════════════════════════");
  console.log(`Total votes cast: ${totalVotes}\n`);

  console.log("Candidate-wise breakdown:");
  console.log("─────────────────────────");

  for (const candidate of candidates) {
    const count = await contract.methods.getCandidateVotes(candidate).call();
    const bar = "█".repeat(Number(count));
    console.log(`  ${candidate.padEnd(20)} : ${count} ${bar}`);
  }

  console.log();

  // ── 2. Individual vote records ────────────────────────────────────

  console.log("═══════════════════════════════════════");
  console.log("     INDIVIDUAL VOTE RECORDS (VID, V)  ");
  console.log("═══════════════════════════════════════\n");

  console.log("  VID".padEnd(25) + "Vote (Candidate)");
  console.log("  " + "─".repeat(40));

  for (const vid of allVIDs) {
    const record = await contract.methods.getVote(vid).call();
    // record returns: (vid, vote, e1, ts1, e2, ts2)
    console.log(`  ${record[0].padEnd(23)} ${record[1]}`);
  }

  console.log();

  // ── 3. Optional: Verify a specific voter ──────────────────────────

  const targetVID  = process.argv[2];
  const expectedV  = process.argv[3];

  if (targetVID) {
    console.log("═══════════════════════════════════════");
    console.log("         VOTE VERIFICATION             ");
    console.log("═══════════════════════════════════════\n");

    try {
      const record = await contract.methods.getVote(targetVID).call();
      console.log(`  Voter ID : ${record[0]}`);
      console.log(`  Vote     : ${record[1]}`);
      console.log(`  E1       : ${record[2].substring(0, 40)}...`);
      console.log(`  TS1      : ${record[3]}`);
      console.log(`  E2       : ${record[4].substring(0, 40)}...`);
      console.log(`  TS2      : ${record[5]}`);

      if (expectedV) {
        const matches = await contract.methods
          .verifyVote(targetVID, expectedV)
          .call();
        console.log(
          `\n  Verification (vote == "${expectedV}"): ${matches ? "✅ MATCH" : "❌ MISMATCH"}`
        );
      }
    } catch (err) {
      console.log(`  [ERROR] ${err.message}`);
    }

    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
