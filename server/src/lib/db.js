const mysql = require("mysql2/promise");

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "library_seat_reservation",
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  return pool;
}

async function pingDatabase() {
  const [rows] = await getPool().query("SELECT DATABASE() AS db_name, NOW() AS server_time");
  return rows[0];
}

async function query(sql, params = []) {
  return getPool().execute(sql, params);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  pingDatabase,
  query,
  closePool
};
