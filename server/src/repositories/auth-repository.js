const { query } = require("../lib/db");
const { issueAuthToken } = require("../lib/auth");
const {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough
} = require("../lib/password");

const STUDENT_NO_PATTERN = /^\d{10}$/;

function buildError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || null;
  error.payload = {
    message
  };

  if (code) {
    error.payload.code = code;
  }

  return error;
}

function formatDateTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function mapUserRow(row) {
  return {
    userId: String(row.id),
    studentNo: row.studentNo,
    realName: row.realName,
    role: row.role,
    status: row.status,
    creditScore: Number(row.creditScore || 0),
    isBlacklisted: Boolean(row.isBlacklisted),
    blacklistUntil: formatDateTime(row.blacklistUntil)
  };
}

function normalizeAuthInput(input) {
  return {
    studentNo: String((input && input.studentNo) || "").trim(),
    realName: String((input && input.realName) || "").trim(),
    password: String((input && input.password) || "")
  };
}

function validateAuthInput(input) {
  if (!STUDENT_NO_PATTERN.test(input.studentNo)) {
    throw buildError("学号需为 10 位数字", 400, "INVALID_STUDENT_NO");
  }

  if (!input.realName) {
    throw buildError("请输入姓名", 400, "EMPTY_REAL_NAME");
  }

  if (!input.password) {
    throw buildError("请输入密码", 400, "EMPTY_PASSWORD");
  }
}

async function findPasswordHash(studentNo) {
  const [rows] = await query(
    "SELECT password_hash AS passwordHash FROM app_user WHERE student_no = ? LIMIT 1",
    [studentNo]
  );
  return rows[0] ? rows[0].passwordHash : null;
}

// Checks the password of an account. The same error is used for "wrong password",
// "unknown account" and "no password set", so the response does not reveal which one it was.
async function assertPasswordMatches(studentNo, password) {
  const passwordHash = await findPasswordHash(studentNo);
  if (!verifyPassword(password, passwordHash)) {
    throw buildError("学号或密码错误", 401, "INVALID_CREDENTIALS");
  }
}

async function findUserByStudentNo(studentNo) {
  const [rows] = await query(
    `
      SELECT
        id,
        student_no AS studentNo,
        real_name AS realName,
        role,
        status,
        credit_score AS creditScore,
        is_blacklisted AS isBlacklisted,
        blacklist_until AS blacklistUntil
      FROM app_user
      WHERE student_no = ?
      LIMIT 1
    `,
    [studentNo]
  );

  return rows[0] || null;
}

async function registerUser(input, rules) {
  const normalized = normalizeAuthInput(input);
  validateAuthInput(normalized);

  if (!isPasswordStrongEnough(normalized.password)) {
    throw buildError(`密码至少需要 ${MIN_PASSWORD_LENGTH} 位`, 400, "WEAK_PASSWORD");
  }

  const existingUser = await findUserByStudentNo(normalized.studentNo);
  if (existingUser) {
    throw buildError("该学号已注册，请直接登录", 409, "STUDENT_NO_ALREADY_REGISTERED");
  }

  await query(
    `
      INSERT INTO app_user (
        student_no,
        real_name,
        role,
        status,
        credit_score,
        violation_count,
        is_blacklisted,
        blacklist_until,
        remark,
        password_hash
      ) VALUES (?, ?, 'reader', 'active', ?, 0, 0, NULL, '小程序自助注册用户', ?)
    `,
    [
      normalized.studentNo,
      normalized.realName,
      rules.initialCreditScore,
      hashPassword(normalized.password)
    ]
  );

  const createdUser = await findUserByStudentNo(normalized.studentNo);
  const tokenResult = issueAuthToken(createdUser, {
    scope: "app"
  });

  return {
    message: "注册成功，已自动写入登录态",
    user: mapUserRow(createdUser),
    token: tokenResult.token,
    expiresAt: tokenResult.expiresAt,
    isNewUser: true
  };
}

async function loginUser(input) {
  const normalized = normalizeAuthInput(input);
  validateAuthInput(normalized);

  const user = await findUserByStudentNo(normalized.studentNo);
  if (!user || user.realName !== normalized.realName) {
    throw buildError("学号或密码错误", 401, "INVALID_CREDENTIALS");
  }

  await assertPasswordMatches(normalized.studentNo, normalized.password);

  if (user.status !== "active") {
    throw buildError("当前账号状态不可登录", 403, "ACCOUNT_STATUS_INVALID");
  }

  await query(
    `
      UPDATE app_user
      SET last_login_at = NOW()
      WHERE id = ?
    `,
    [user.id]
  );

  const tokenResult = issueAuthToken(user, {
    scope: "app"
  });

  return {
    message: "登录成功",
    user: mapUserRow(user),
    token: tokenResult.token,
    expiresAt: tokenResult.expiresAt
  };
}

module.exports = {
  assertPasswordMatches,
  findUserByStudentNo,
  registerUser,
  loginUser
};
