const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Fake blockchain ledger
let mockLedger = [
  { vid: "VOTER001", e1: "a1b2c3d4e5f67890", ts2: new Date(Date.now() - 3600000).toISOString(), vote: "Party A" },
  { vid: "VOTER002", e1: "f6e5d4c3b2a10987", ts2: new Date(Date.now() - 1800000).toISOString(), vote: "Party B" }
];

// Frontend fetches from here
app.get('/api/votes', (req, res) => {
  res.json({ votes: mockLedger });
});

// Simulate casting a vote
app.post('/api/vote', (req, res) => {
  const { voterId, party } = req.body;
  const newVote = {
    vid: voterId, e1: Math.random().toString(16).substring(2, 18), ts2: new Date().toISOString(), vote: party
  };
  mockLedger.push(newVote);
  console.log(`[MOCK BLOCKCHAIN] 🗳️ Vote secured for ${voterId}`);
  res.json({ success: true, transaction: newVote.e1 });
});

app.listen(4000, () => console.log(`🔗 Mock Blockchain listening on http://localhost:4000`));