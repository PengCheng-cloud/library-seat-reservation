const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { pingDatabase, closePool } = require("../lib/db");

async function main() {
  try {
    const result = await pingDatabase();
    console.log("Database connection ok.");
    console.log(`Database: ${result.db_name}`);
    console.log(`Server time: ${result.server_time}`);
  } catch (error) {
    console.error("Database connection failed.");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
