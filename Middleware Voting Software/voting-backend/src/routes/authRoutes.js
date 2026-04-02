const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    const [rows] = await pool.execute(
      "SELECT id, username, role FROM users WHERE username = ? AND password = ?",
      [username.trim(), password]
    );

    if (rows.length === 0)
      return res.status(401).json({ error: "Invalid username or password" });

    res.json({ message: "Login successful", user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;