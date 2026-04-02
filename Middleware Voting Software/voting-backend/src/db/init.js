const pool = require("./pool");

async function initDB() {
  const conn = await pool.getConnection();
  try {

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        username   VARCHAR(100) NOT NULL UNIQUE,
        password   VARCHAR(255) NOT NULL,
        role       ENUM('admin', 'officer') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS voters (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        uid                VARCHAR(50)  NOT NULL UNIQUE,
        name               VARCHAR(255) NOT NULL,
        hash1              TEXT         DEFAULT NULL,
        timestamp2         DATETIME     DEFAULT NULL,
        hardware_initiated TINYINT(1)   NOT NULL DEFAULT 0,
        vote_processed     TINYINT(1)   NOT NULL DEFAULT 0,
        initiated_at       DATETIME     DEFAULT NULL,
        created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // If table already existed without initiated_at, add the column silently
    await conn.execute(`
      ALTER TABLE voters ADD COLUMN IF NOT EXISTS initiated_at DATETIME DEFAULT NULL
    `).catch(() => {});

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS hash_records (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        uid        VARCHAR(50) NOT NULL UNIQUE,
        hash2      TEXT        NOT NULL,
        created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      INSERT IGNORE INTO users (username, password, role) VALUES
        ('admin',   'admin123',   'admin'),
        ('officer', 'officer123', 'officer')
    `);

    console.log("✅ MySQL tables ready");
  } finally {
    conn.release();
  }
}

module.exports = initDB;