/**
 * Automated tests for VotingContract.
 *
 * Run with:  npx truffle test
 */

const VotingContract = artifacts.require("VotingContract");

contract("VotingContract", (accounts) => {
  const owner    = accounts[0];
  const nonOwner = accounts[1];

  let instance;

  // Sample vote data
  const sampleVote = {
    vid:  "VID001",
    vote: "CandidateA",
    e1:   "abc123encryptedblob",
    ts1:  "2026-03-10T12:00:00Z",
    e2:   "def456doubleencrypted",
    ts2:  "2026-03-10T12:01:00Z",
  };

  beforeEach(async () => {
    instance = await VotingContract.new({ from: owner });
  });

  // ── Deployment ─────────────────────────────────────────────────

  it("should deploy successfully and set the owner", async () => {
    const contractOwner = await instance.owner();
    assert.equal(contractOwner, owner, "Owner should be the deployer");
  });

  it("should start with zero votes", async () => {
    const total = await instance.getTotalVotes();
    assert.equal(total.toNumber(), 0, "Initial vote count should be 0");
  });

  // ── Casting Votes ──────────────────────────────────────────────

  it("should allow the owner to cast a vote", async () => {
    await instance.castVote(
      sampleVote.vid,
      sampleVote.vote,
      sampleVote.e1,
      sampleVote.ts1,
      sampleVote.e2,
      sampleVote.ts2,
      { from: owner }
    );

    const total = await instance.getTotalVotes();
    assert.equal(total.toNumber(), 1, "Total votes should be 1");
  });

  it("should reject duplicate VID (prevent double-voting)", async () => {
    await instance.castVote(
      sampleVote.vid,
      sampleVote.vote,
      sampleVote.e1,
      sampleVote.ts1,
      sampleVote.e2,
      sampleVote.ts2,
      { from: owner }
    );

    try {
      await instance.castVote(
        sampleVote.vid,        // same VID
        "CandidateB",
        "xyz",
        "ts",
        "e2_2",
        "ts2_2",
        { from: owner }
      );
      assert.fail("Should have reverted for duplicate VID");
    } catch (err) {
      assert(
        err.message.includes("Vote already recorded"),
        `Unexpected error: ${err.message}`
      );
    }
  });

  it("should reject votes from non-owner account", async () => {
    try {
      await instance.castVote(
        "VID002",
        "CandidateB",
        "e1",
        "ts1",
        "e2",
        "ts2",
        { from: nonOwner }
      );
      assert.fail("Should have reverted for non-owner");
    } catch (err) {
      assert(
        err.message.includes("Only the election authority"),
        `Unexpected error: ${err.message}`
      );
    }
  });

  // ── Reading / Retrieval ────────────────────────────────────────

  it("should retrieve a vote record by VID", async () => {
    await instance.castVote(
      sampleVote.vid,
      sampleVote.vote,
      sampleVote.e1,
      sampleVote.ts1,
      sampleVote.e2,
      sampleVote.ts2,
      { from: owner }
    );

    const record = await instance.getVote(sampleVote.vid);
    assert.equal(record.vid,  sampleVote.vid);
    assert.equal(record.vote, sampleVote.vote);
    assert.equal(record.e1,   sampleVote.e1);
    assert.equal(record.ts1,  sampleVote.ts1);
    assert.equal(record.e2,   sampleVote.e2);
    assert.equal(record.ts2,  sampleVote.ts2);
  });

  it("should revert when fetching a non-existent VID", async () => {
    try {
      await instance.getVote("NON_EXISTENT");
      assert.fail("Should have reverted");
    } catch (err) {
      assert(
        err.message.includes("No vote found"),
        `Unexpected error: ${err.message}`
      );
    }
  });

  // ── Tallying ───────────────────────────────────────────────────

  it("should correctly tally votes per candidate", async () => {
    // Cast 3 votes: 2 for CandidateA, 1 for CandidateB
    const votes = [
      { vid: "V01", vote: "CandidateA" },
      { vid: "V02", vote: "CandidateB" },
      { vid: "V03", vote: "CandidateA" },
    ];

    for (const v of votes) {
      await instance.castVote(v.vid, v.vote, "e1", "ts1", "e2", "ts2", {
        from: owner,
      });
    }

    const total = await instance.getTotalVotes();
    assert.equal(total.toNumber(), 3);

    const countA = await instance.getCandidateVotes("CandidateA");
    assert.equal(countA.toNumber(), 2);

    const countB = await instance.getCandidateVotes("CandidateB");
    assert.equal(countB.toNumber(), 1);
  });

  it("should return the correct candidate list", async () => {
    await instance.castVote("V01", "Alpha", "e1", "ts1", "e2", "ts2", { from: owner });
    await instance.castVote("V02", "Beta",  "e1", "ts1", "e2", "ts2", { from: owner });
    await instance.castVote("V03", "Alpha", "e1", "ts1", "e2", "ts2", { from: owner });

    const candidates = await instance.getAllCandidates();
    assert.deepEqual(candidates, ["Alpha", "Beta"]);
  });

  it("should return the correct list of all VIDs", async () => {
    await instance.castVote("V01", "X", "e1", "ts1", "e2", "ts2", { from: owner });
    await instance.castVote("V02", "Y", "e1", "ts1", "e2", "ts2", { from: owner });

    const allVIDs = await instance.getAllVIDs();
    assert.deepEqual(allVIDs, ["V01", "V02"]);
  });

  // ── Verification ───────────────────────────────────────────────

  it("should verify a vote correctly (match)", async () => {
    await instance.castVote(
      sampleVote.vid,
      sampleVote.vote,
      sampleVote.e1,
      sampleVote.ts1,
      sampleVote.e2,
      sampleVote.ts2,
      { from: owner }
    );

    const matches = await instance.verifyVote(sampleVote.vid, sampleVote.vote);
    assert.equal(matches, true, "Vote should match");
  });

  it("should verify a vote correctly (mismatch)", async () => {
    await instance.castVote(
      sampleVote.vid,
      sampleVote.vote,
      sampleVote.e1,
      sampleVote.ts1,
      sampleVote.e2,
      sampleVote.ts2,
      { from: owner }
    );

    const matches = await instance.verifyVote(sampleVote.vid, "WrongCandidate");
    assert.equal(matches, false, "Vote should NOT match");
  });
});
