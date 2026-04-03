const mongoose = require("mongoose");

mongoose.connect("mongodb+srv://anubhav:anubhav123@cluster0.lvukftp.mongodb.net/test")
  .then(() => {
    console.log("✅ Connected as test user");
    return mongoose.connection.db.collection("voters").find().toArray();
  })
  .then(data => {
    console.log("📄 Data:", data);
    process.exit();
  })
  .catch(err => {
    console.error("❌ Error:", err);
  });