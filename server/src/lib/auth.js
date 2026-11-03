const { createHmac, randomBytes, timingSafeEqual } = require("crypto");

// The signing secret must come from the environment. Without it, a random
// secret is generated at startup: tokens then stay valid only until restart,
// but nobody can forge tokens with a secret taken from the source code.
const TOKEN_SECRET = (() => {
  const configured = String(process.env.AUTH_TOKEN_SECRET || "").trim();
  if (configured) {
    return configured;
  }
  console.warn("[auth] AUTH_TOKEN_SECRET is not set, using a random secret for this process");
  return randomBytes(32).toString("hex");
})();
const DEFAULT_TOKEN_TTL_SECONDS = Math.max(
  60,
  Number(process.env.AUTH_TOKEN_TTL_SECONDS || 7 * 24 * 60 * 60)
);

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function signTokenPayload(payloadSegment) {
  return createHmac("sha256", TOKEN_SECRET).update(payloadSegment).digest("base64url");
}

function buildTokenPayload(user, options = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(60, Number(options.ttlSeconds) || DEFAULT_TOKEN_TTL_SECONDS);

  return {
    studentNo: String(user.studentNo || "").trim(),
    realName: String(user.realName || "").trim(),
    role: String(user.role || "reader").trim(),
    scope: String(options.scope || "app").trim(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
}

function issueAuthToken(user, options = {}) {
  const payload = buildTokenPayload(user, options);
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signatureSegment = signTokenPayload(payloadSegment);

  return {
    token: `${payloadSegment}.${signatureSegment}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    payload
  };
}

function verifyAuthToken(token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    const error = new Error("缺少登录令牌");
    error.code = "AUTH_TOKEN_REQUIRED";
    throw error;
  }

  const segments = rawToken.split(".");
  if (segments.length !== 2) {
    const error = new Error("登录令牌格式无效");
    error.code = "AUTH_TOKEN_INVALID";
    throw error;
  }

  const [payloadSegment, signatureSegment] = segments;
  const expectedSignature = signTokenPayload(payloadSegment);
  const actualBuffer = Buffer.from(signatureSegment, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    const error = new Error("登录令牌校验失败");
    error.code = "AUTH_TOKEN_INVALID";
    throw error;
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecode(payloadSegment));
  } catch (parseError) {
    const error = new Error("登录令牌内容无效");
    error.code = "AUTH_TOKEN_INVALID";
    throw error;
  }

  if (!payload || !payload.studentNo || !payload.exp) {
    const error = new Error("登录令牌内容不完整");
    error.code = "AUTH_TOKEN_INVALID";
    throw error;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp) <= nowSeconds) {
    const error = new Error("登录已过期，请重新登录");
    error.code = "AUTH_TOKEN_EXPIRED";
    throw error;
  }

  return payload;
}

module.exports = {
  issueAuthToken,
  verifyAuthToken
};
