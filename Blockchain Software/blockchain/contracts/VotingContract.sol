// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title VotingContract
 * @notice Stores votes from the Electronic Voting Machine (EVM) on-chain.
 *
 * ASSUMPTIONS:
 *  1. Only the contract owner (election authority) can write votes.
 *  2. Each Voter ID (VID) can only vote once (double-voting is rejected).
 *  3. Encrypted blobs (E1, E2) are stored as hex-encoded strings.
 *  4. Plaintext (VID, V) is stored for public verification / tallying.
 *  5. Timestamps (TS1, TS2) are stored as strings for flexibility
 *     (the ESP32 may send ISO-8601 or Unix epoch strings).
 */
contract VotingContract {

    // ----------------------------------------------------------------
    //  State
    // ----------------------------------------------------------------

    address public owner;

    struct VoteRecord {
        string vid;         // Voter ID (plaintext)
        string vote;        // Candidate choice V (plaintext)
        string e1;          // Encrypt(F1, F2, V, TS1) from ESP32
        string ts1;         // Timestamp from ESP32
        string e2;          // Encrypt(E1, TS2) from the database layer
        string ts2;         // Timestamp of second encryption
        bool   exists;      // Guard flag — true once a vote is recorded
    }

    /// @dev VID string → VoteRecord
    mapping(string => VoteRecord) private voteRecords;

    /// @dev Ordered list of all VIDs that have voted
    string[] public vids;

    /// @dev Total number of votes cast
    uint256 public totalVotes;

    /// @dev Candidate name → number of votes
    mapping(string => uint256) public candidateVotes;

    /// @dev Ordered list of unique candidate names
    string[] public candidateList;

    /// @dev Quick lookup to avoid duplicate entries in candidateList
    mapping(string => bool) private candidateExists;

    // ----------------------------------------------------------------
    //  Events
    // ----------------------------------------------------------------

    event VoteCast(string indexed vidHash, string vid, string vote);

    // ----------------------------------------------------------------
    //  Modifiers
    // ----------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the election authority can perform this action");
        _;
    }

    // ----------------------------------------------------------------
    //  Constructor
    // ----------------------------------------------------------------

    constructor() {
        owner = msg.sender;
    }

    // ----------------------------------------------------------------
    //  Write Functions (onlyOwner)
    // ----------------------------------------------------------------

    /**
     * @notice Record a single vote on-chain.
     * @param _vid   Voter ID
     * @param _vote  Candidate choice (plaintext)
     * @param _e1    Encrypted blob from ESP32
     * @param _ts1   Timestamp from ESP32
     * @param _e2    Double-encrypted blob from database
     * @param _ts2   Timestamp of second encryption
     */
    function castVote(
        string memory _vid,
        string memory _vote,
        string memory _e1,
        string memory _ts1,
        string memory _e2,
        string memory _ts2
    ) external onlyOwner {
        // Prevent double-voting
        require(!voteRecords[_vid].exists, "Vote already recorded for this VID");

        // Store the full record
        voteRecords[_vid] = VoteRecord({
            vid:    _vid,
            vote:   _vote,
            e1:     _e1,
            ts1:    _ts1,
            e2:     _e2,
            ts2:    _ts2,
            exists: true
        });

        // Track voter
        vids.push(_vid);
        totalVotes++;

        // Update candidate tally
        candidateVotes[_vote]++;

        if (!candidateExists[_vote]) {
            candidateList.push(_vote);
            candidateExists[_vote] = true;
        }

        emit VoteCast(_vid, _vid, _vote);
    }

    // ----------------------------------------------------------------
    //  Read / Verification Functions (public)
    // ----------------------------------------------------------------

    /**
     * @notice Retrieve the full vote record for a given VID.
     */
    function getVote(string memory _vid)
        external
        view
        returns (
            string memory vid,
            string memory vote,
            string memory e1,
            string memory ts1,
            string memory e2,
            string memory ts2
        )
    {
        require(voteRecords[_vid].exists, "No vote found for this VID");
        VoteRecord storage r = voteRecords[_vid];
        return (r.vid, r.vote, r.e1, r.ts1, r.e2, r.ts2);
    }

    /**
     * @notice Get the total number of votes cast.
     */
    function getTotalVotes() external view returns (uint256) {
        return totalVotes;
    }

    /**
     * @notice Get the vote count for a specific candidate.
     */
    function getCandidateVotes(string memory _candidate)
        external
        view
        returns (uint256)
    {
        return candidateVotes[_candidate];
    }

    /**
     * @notice Get the list of all candidates who received at least one vote.
     */
    function getAllCandidates() external view returns (string[] memory) {
        return candidateList;
    }

    /**
     * @notice Get the list of all Voter IDs that have voted.
     */
    function getAllVIDs() external view returns (string[] memory) {
        return vids;
    }

    /**
     * @notice Verify whether a voter's recorded vote matches the expected value.
     * @param _vid          Voter ID to look up
     * @param _expectedVote The vote value to compare against
     * @return matches      True if the on-chain vote equals _expectedVote
     */
    function verifyVote(string memory _vid, string memory _expectedVote)
        external
        view
        returns (bool matches)
    {
        require(voteRecords[_vid].exists, "No vote found for this VID");
        matches = (keccak256(bytes(voteRecords[_vid].vote))
                   == keccak256(bytes(_expectedVote)));
    }
}
