const express   = require("express");
const cors      = require("cors");
require("dotenv").config();

const initDB      = require("./db/init");
const authRoutes  = require("./routes/authRoutes");
const voterRoutes = require("./routes/voterRoutes");

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use("/api/auth",   authRoutes);
app.use("/api/voters", voterRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to initialize DB:", err.message);
    process.exit(1);
  });

