const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Fake blockchain ledger
let mockLedger = [
  
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