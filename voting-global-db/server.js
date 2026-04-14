const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); 
app.use(express.json());

// 1. Connect to MongoDB using environment variable
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is not set.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to Global MongoDB Database');
    try {
      await seedDatabase();
    } catch (err) {
      console.error('❌ Error seeding database:', err);
    }
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// 2. Define the Voter Schema
const voterSchema = new mongoose.Schema({
  vid: { type: String, required: true, unique: true },
  firstName: String,
  lastName: String,
  age: Number,
  gender: String,
  ward: Number,
  district: String,
  state: String,
  f1: String, 
  f2: String
});

const Voter = mongoose.model('Voter', voterSchema);

// 3. Sample Data
const sampleVoters = [
  // Explicitly requested entries
  { voterId: 'UID001', firstName: 'Keshav', lastName: 'Verma', age: 22, gender: 'Male', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'ENC_F1_KESHAV', fingerprint_2: 'ENC_F2_KESHAV' },
  { voterId: 'VOTER002', firstName: 'Shivam', lastName: 'Gupta', age: 22, gender: 'Male', ward: 'Ward 7', district: 'Najafgarh', state: 'Delhi', fingerprint_1: 'ENC_F1_SHIVAM', fingerprint_2: 'ENC_F2_SHIVAM' },
  { voterId: 'VOTER003', firstName: 'Anubhav', lastName: 'Singhal', age: 21, gender: 'Male', ward: 'Ward 6', district: 'Vaishali', state: 'Uttar Pradesh', fingerprint_1: 'ENC_F1_ANUBHAV', fingerprint_2: 'ENC_F2_ANUBHAV' },
  { voterId: 'VOTER004', firstName: 'Abhimanyu', lastName: 'Mittal', age: 20, gender: 'Male', ward: 'Ward 15', district: 'Noida', state: 'Uttar Pradesh', fingerprint_1: 'ENC_F1_ABHI', fingerprint_2: 'ENC_F2_ABHI' },
  
  // 16 Additional Generated Mock Entries
  { voterId: 'VOTER005', firstName: 'Aarav', lastName: 'Mehta', age: 30, gender: 'Male', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'MOCK_F1_5', fingerprint_2: 'MOCK_F2_5' },
  { voterId: 'VOTER006', firstName: 'Ishani', lastName: 'Goel', age: 25, gender: 'Female', ward: 'Ward 7', district: 'Najafgarh', state: 'Delhi', fingerprint_1: 'MOCK_F1_6', fingerprint_2: 'MOCK_F2_6' },
  { voterId: 'VOTER007', firstName: 'Kabir', lastName: 'Singh', age: 45, gender: 'Male', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'MOCK_F1_7', fingerprint_2: 'MOCK_F2_7' },
  { voterId: 'VOTER008', firstName: 'Diya', lastName: 'Iyer', age: 35, gender: 'Female', ward: 'Ward 6', district: 'Vaishali', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_8', fingerprint_2: 'MOCK_F2_8' },
  { voterId: 'VOTER009', firstName: 'Rohan', lastName: 'Bhasin', age: 28, gender: 'Male', ward: 'Ward 15', district: 'Noida', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_9', fingerprint_2: 'MOCK_F2_9' },
  { voterId: 'VOTER010', firstName: 'Sanya', lastName: 'Malhotra', age: 23, gender: 'Female', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'MOCK_F1_10', fingerprint_2: 'MOCK_F2_10' },
  { voterId: 'VOTER011', firstName: 'Aryan', lastName: 'Khanna', age: 50, gender: 'Male', ward: 'Ward 7', district: 'Najafgarh', state: 'Delhi', fingerprint_1: 'MOCK_F1_11', fingerprint_2: 'MOCK_F2_11' },
  { voterId: 'VOTER012', firstName: 'Ananya', lastName: 'Pandey', age: 19, gender: 'Female', ward: 'Ward 6', district: 'Vaishali', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_12', fingerprint_2: 'MOCK_F2_12' },
  { voterId: 'VOTER013', firstName: 'Kunal', lastName: 'Kapoor', age: 33, gender: 'Male', ward: 'Ward 15', district: 'Noida', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_13', fingerprint_2: 'MOCK_F2_13' },
  { voterId: 'VOTER014', firstName: 'Meera', lastName: 'Joshi', age: 27, gender: 'Female', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'MOCK_F1_14', fingerprint_2: 'MOCK_F2_14' },
  { voterId: 'VOTER015', firstName: 'Yash', lastName: 'Chopra', age: 41, gender: 'Male', ward: 'Ward 7', district: 'Najafgarh', state: 'Delhi', fingerprint_1: 'MOCK_F1_15', fingerprint_2: 'MOCK_F2_15' },
  { voterId: 'VOTER016', firstName: 'Tara', lastName: 'Sutaria', age: 24, gender: 'Female', ward: 'Ward 6', district: 'Vaishali', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_16', fingerprint_2: 'MOCK_F2_16' },
  { voterId: 'VOTER017', firstName: 'Dev', lastName: 'Patel', age: 38, gender: 'Male', ward: 'Ward 15', district: 'Noida', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_17', fingerprint_2: 'MOCK_F2_17' },
  { voterId: 'VOTER018', firstName: 'Kyra', lastName: 'Advani', age: 29, gender: 'Female', ward: 'Ward 2', district: 'East Delhi', state: 'Delhi', fingerprint_1: 'MOCK_F1_18', fingerprint_2: 'MOCK_F2_18' },
  { voterId: 'VOTER019', firstName: 'Siddharth', lastName: 'Roy', age: 32, gender: 'Male', ward: 'Ward 7', district: 'Najafgarh', state: 'Delhi', fingerprint_1: 'MOCK_F1_19', fingerprint_2: 'MOCK_F2_19' },
  { voterId: 'VOTER020', firstName: 'Riya', lastName: 'Sen', age: 26, gender: 'Female', ward: 'Ward 6', district: 'Vaishali', state: 'Uttar Pradesh', fingerprint_1: 'MOCK_F1_20', fingerprint_2: 'MOCK_F2_20' }
];

// Seed Database Function
async function seedDatabase() {
  try {
    const normalizedVoters = sampleVoters.map((v) => ({
      vid: (v.vid || v.voterId || '').toString().trim().toUpperCase(),
      firstName: v.firstName,
      lastName: v.lastName,
      age: v.age,
      gender: v.gender,
      ward: v.ward,
      district: v.district,
      state: v.state,
      f1: v.f1 || v.fingerprint_1 || null,
      f2: v.f2 || v.fingerprint_2 || null,
    }));

    const ops = normalizedVoters.map((voter) => ({
      updateOne: {
        filter: { vid: voter.vid },
        update: { $setOnInsert: voter },
        upsert: true,
      },
    }));

    const result = await Voter.bulkWrite(ops, { ordered: false });
    const inserted = (result.upsertedCount || 0);
    const existing = normalizedVoters.length - inserted;
    console.log(`✅ Seed sync complete. Inserted: ${inserted}, already present: ${existing}.`);
  } catch (err) {
    console.error('❌ Error during seeding:', err);
  }
}
// seedDatabase();

// --- API ENDPOINTS ---

// Fetch ALL voters (For the React Dashboard)
app.get('/api/voters', async (req, res) => {
  try {
    const voters = await Voter.find({});
    res.json(voters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch specific fingerprints (For Blockchain Verification)
app.get('/api/voters/:voterId/fingerprints', async (req, res) => {
  try {
    const uid = req.params.voterId.toString().trim().toUpperCase();
    const voter = await Voter.findOne({
      $or: [{ vid: uid }, { voterId: uid }]
    });
    if (!voter) return res.status(404).json({ error: 'Voter not found' });
    
    res.json({
      voterId: voter.vid || voter.voterId,
      fingerprint_1: voter.f1 || voter.fingerprint_1,
      fingerprint_2: voter.f2 || voter.fingerprint_2
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch a SINGLE voter's full demographic profile by VID (For Frontend enrichment)
// GET /api/voters/:vid
app.get('/api/voters/:vid', async (req, res) => {
  try {
    const uid = req.params.vid.toString().trim().toUpperCase();
    const voter = await Voter.findOne({
      $or: [{ vid: uid }, { voterId: uid }]
    });
    if (!voter) return res.status(404).json({ error: 'Voter not found', vid: uid });

    res.json({
      vid:       voter.vid,
      firstName: voter.firstName,
      lastName:  voter.lastName,
      age:       voter.age,
      gender:    voter.gender,
      ward:      voter.ward,
      district:  voter.district,
      state:     voter.state,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Global DB API running on http://localhost:${PORT}`);
  console.log(`   GET /api/voters           — all voters`);
  console.log(`   GET /api/voters/:vid      — single voter profile`);
  console.log(`   GET /api/voters/:vid/fingerprints — fingerprints`);
});