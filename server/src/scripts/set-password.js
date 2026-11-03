const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const { query, closePool } = require("../lib/db");
const { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } = require("../lib/password");

// Usage: npm run set-password -- <studentNo> <password>
// Seeded admin accounts have no password, so they cannot log in until one is set.
async function main() {
  const [studentNo, password] = process.argv.slice(2);
  if (!studentNo || !password) {
    console.error("Usage: npm run set-password -- <studentNo> <password>");
    process.exitCode = 1;
    return;
  }
  if (!isPasswordStrongEnough(password)) {
    console.error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  try {
    const [result] = await query("UPDATE app_user SET password_hash = ? WHERE student_no = ?", [
      hashPassword(password),
      studentNo
    ]);
    if (result.affectedRows === 0) {
      console.error(`No user with student number ${studentNo}.`);
      process.exitCode = 1;
    } else {
      console.log(`Password updated for ${studentNo}.`);
    }
  } finally {
    await closePool();
  }
}

main();
