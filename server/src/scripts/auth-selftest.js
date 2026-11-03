// Offline self-test for password login. It replaces the database module with a
// small in-memory fake, so it runs without MySQL:  npm run test:auth
const assert = require("assert");
const path = require("path");

const users = [];
const fakeDb = {
  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT password_hash")) {
      const user = users.find((u) => u.studentNo === params[0]);
      return [user ? [{ passwordHash: user.passwordHash }] : []];
    }
    if (text.startsWith("SELECT id, student_no")) {
      const user = users.find((u) => u.studentNo === params[0]);
      return [user ? [{ ...user }] : []];
    }
    if (text.startsWith("INSERT INTO app_user")) {
      const [studentNo, realName, creditScore, passwordHash] = params;
      users.push({
        id: users.length + 1, studentNo, realName, role: "reader", status: "active",
        creditScore, isBlacklisted: 0, blacklistUntil: null, passwordHash
      });
      return [{ insertId: users.length }];
    }
    if (text.startsWith("UPDATE app_user SET last_login_at")) {
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unexpected query in self-test: ${text.slice(0, 60)}`);
  }
};
require.cache[path.resolve(__dirname, "../lib/db.js")] = {
  id: "db", filename: "db", loaded: true, exports: fakeDb
};

const { hashPassword, verifyPassword } = require("../lib/password");
const { registerUser, loginUser } = require("../repositories/auth-repository");

async function expectError(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected error ${code}`);
}

async function main() {
  // hashing
  const stored = hashPassword("correct horse battery");
  assert.ok(stored.startsWith("scrypt$"));
  assert.ok(verifyPassword("correct horse battery", stored));
  assert.ok(!verifyPassword("wrong password", stored));
  assert.ok(!verifyPassword("anything", null));
  assert.notEqual(hashPassword("same"), hashPassword("same"), "salts must differ");

  // registration
  const rules = { initialCreditScore: 100 };
  await expectError(registerUser({ studentNo: "2022000001", realName: "Test", password: "short" }, rules), "WEAK_PASSWORD");
  const reg = await registerUser({ studentNo: "2022000001", realName: "Test", password: "long-enough-pw" }, rules);
  assert.ok(reg.token);
  assert.ok(!JSON.stringify(reg).includes("scrypt$"), "the hash must never be returned");
  assert.ok(!users[0].passwordHash.includes("long-enough-pw"), "the password must not be stored in plain text");

  // login
  const ok = await loginUser({ studentNo: "2022000001", realName: "Test", password: "long-enough-pw" });
  assert.ok(ok.token);
  await expectError(loginUser({ studentNo: "2022000001", realName: "Test", password: "wrong-password" }), "INVALID_CREDENTIALS");
  await expectError(loginUser({ studentNo: "2022000001", realName: "Test", password: "" }), "EMPTY_PASSWORD");
  await expectError(loginUser({ studentNo: "2022999999", realName: "Nobody", password: "whatever-pw" }), "INVALID_CREDENTIALS");

  // an account without a password (e.g. a seeded admin) cannot log in
  users.push({ id: 99, studentNo: "2022000099", realName: "Seeded", role: "reader", status: "active",
    creditScore: 100, isBlacklisted: 0, blacklistUntil: null, passwordHash: null });
  await expectError(loginUser({ studentNo: "2022000099", realName: "Seeded", password: "anything-pw" }), "INVALID_CREDENTIALS");

  console.log("Auth self-test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
