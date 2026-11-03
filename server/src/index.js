const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const { defaultRules, filterOptions, scenePresets, statusLabels } = require("./config/default-rules");
const { buildMockReservations, buildMockNotices, buildMockProfile, getMockUser } = require("./config/demo-data");
const { pingDatabase } = require("./lib/db");
const { getDataset, getZones, getSeats, getStats, getZoneByCode, getSeatById, compareZones } = require("./lib/data-store");
const { verifyAuthToken } = require("./lib/auth");
const { sendJson, sendText, readJsonBody } = require("./lib/http");
const { getActiveRules } = require("./lib/rule-config");
const { normalizeFilters, filterSeats, buildZoneCounts, buildReservationPreview, buildSeatAvailability } = require("./lib/seat-query");
const { buildSeatAssistantResponse, parseMessage } = require("./lib/seat-assistant");
const { getAlgorithmOverview } = require("./lib/algorithm-results");
const { predictSeatRuntime } = require("./lib/svm-runtime-inference");
const { getHomeSummaryFromDb, listPublishedNoticesFromDb, listHotZonesFromDb } = require("./repositories/home-repository");
const { listZonesFromDb, listSeatsFromDb } = require("./repositories/library-repository");
const { listSeatUsageByWindow, listUserReservationConflictByWindow, listSeatUsageByDate } = require("./repositories/seat-status-repository");
const {
  registerUser,
  loginUser,
  findUserByStudentNo: findAuthUserByStudentNo
} = require("./repositories/auth-repository");
const { getProfileByStudentNo } = require("./repositories/profile-repository");
const {
  adminLogin,
  getAdminDashboard,
  getAdminReports,
  listAdminNotices,
  createAdminNotice,
  updateAdminNotice,
  updateAdminNoticeStatus,
  listAdminReservations,
  manualCheckoutAdminReservation,
  releaseAdminReservation,
  listAdminUsers,
  adjustAdminUserCredit,
  listAdminZones,
  createAdminZone,
  updateAdminZone,
  deleteAdminZone,
  updateAdminZoneEnabled,
  listAdminSeats,
  createAdminSeat,
  updateAdminSeat,
  deleteAdminSeat,
  updateAdminSeatStatus,
  listAdminRuleConfigs,
  updateAdminRuleConfigs
} = require("./repositories/admin-repository");
const {
  syncReservationStates,
  getReservationValidationContext,
  validateReservationInput,
  listReservationsByStudentNo,
  createReservation,
  cancelReservationByNo,
  checkinReservationByNo,
  checkoutReservationByNo,
  startLeaveByReservationNo,
  returnLeaveByReservationNo
} = require("./repositories/reservation-repository");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_WEB_ROOT = path.resolve(__dirname, "..", "..", "admin-web");

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function buildAuthError(message, code = "AUTH_REQUIRED", statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.payload = {
    message,
    code
  };
  return error;
}

function getBearerToken(request) {
  const authorizationHeader = String(request.headers.authorization || "").trim();
  const matched = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return matched && matched[1] ? matched[1].trim() : "";
}

async function getOptionalAuthenticatedUser(request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  let payload = null;
  try {
    payload = verifyAuthToken(token);
  } catch (error) {
    if (error.code === "AUTH_TOKEN_EXPIRED") {
      throw buildAuthError("登录已过期，请重新登录", "AUTH_TOKEN_EXPIRED", 401);
    }

    throw buildAuthError("登录凭证无效，请重新登录", "AUTH_TOKEN_INVALID", 401);
  }

  const user = await findAuthUserByStudentNo(payload.studentNo);
  if (!user) {
    throw buildAuthError("当前账号不存在，请重新登录", "AUTH_USER_NOT_FOUND", 401);
  }

  if (user.status !== "active") {
    throw buildAuthError("当前账号状态不可用", "ACCOUNT_STATUS_INVALID", 403);
  }

  return user;
}

async function requireAuthenticatedUser(request) {
  const user = await getOptionalAuthenticatedUser(request);
  if (!user) {
    throw buildAuthError("请先登录后再操作");
  }

  return user;
}

async function requireAdminUser(request) {
  const user = await requireAuthenticatedUser(request);
  if (!ADMIN_ROLES.has(user.role)) {
    throw buildAuthError("当前账号没有后台权限", "ADMIN_ROLE_REQUIRED", 403);
  }

  return user;
}

function withAuthenticatedStudentNo(searchParams, user) {
  const nextSearchParams = new URLSearchParams(searchParams);
  if (user && user.studentNo && !nextSearchParams.get("studentNo")) {
    nextSearchParams.set("studentNo", user.studentNo);
  }

  return nextSearchParams;
}

function requireStudentNo(value) {
  const studentNo = String(value || "").trim();
  if (!studentNo) {
    const error = new Error("请先登录后再操作");
    error.statusCode = 401;
    error.payload = {
      message: "请先登录后再操作",
      code: "AUTH_REQUIRED"
    };
    throw error;
  }

  return studentNo;
}

function resolveStudentNo(value, authenticatedUser) {
  return requireStudentNo(
    authenticatedUser && authenticatedUser.studentNo
      ? authenticatedUser.studentNo
      : value
  );
}

function getStaticContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

async function serveAdminWeb(pathname, response) {
  const relativePath =
    pathname === "/admin" || pathname === "/admin/"
      ? "index.html"
      : pathname.replace(/^\/admin\/?/, "");

  if (!relativePath) {
    return false;
  }

  const targetPath = path.resolve(ADMIN_WEB_ROOT, relativePath);
  if (!targetPath.startsWith(ADMIN_WEB_ROOT)) {
    sendJson(response, 403, {
      message: "静态资源访问被拒绝"
    });
    return true;
  }

  try {
    const fileBuffer = await fs.readFile(targetPath);
    response.writeHead(200, {
      "Content-Type": getStaticContentType(targetPath),
      "Access-Control-Allow-Origin": "*"
    });
    response.end(fileBuffer);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function serveUploadedFile(pathname, response) {
  const relativePath = pathname.replace(/^\/uploads\/?/, "");

  if (!relativePath) {
    return false;
  }

  const targetPath = path.resolve(UPLOAD_ROOT, relativePath);
  if (!targetPath.startsWith(UPLOAD_ROOT)) {
    sendJson(response, 403, {
      message: "静态资源访问被拒绝"
    });
    return true;
  }

  try {
    const fileBuffer = await fs.readFile(targetPath);
    response.writeHead(200, {
      "Content-Type": getStaticContentType(targetPath),
      "Access-Control-Allow-Origin": "*"
    });
    response.end(fileBuffer);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function sanitizeUploadSegment(value, fallback) {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || fallback;
}

function getImageExtensionFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

function normalizePublicBaseUrlValue(value) {
  return String(value || "").trim().replace(/\/admin(?:\/.*)?$/i, "").replace(/\/+$/, "");
}

function normalizeAdminPublicUrlValue(value, publicBaseUrl = "") {
  const normalizedValue = String(value || "").trim().replace(/\/+$/, "");
  if (!normalizedValue) {
    return publicBaseUrl ? `${publicBaseUrl}/admin/` : "";
  }

  if (/\/admin(?:\/.*)?$/i.test(normalizedValue)) {
    return `${normalizedValue.replace(/\/admin(?:\/.*)?$/i, "/admin")}/`;
  }

  const normalizedBaseUrl = normalizePublicBaseUrlValue(normalizedValue);
  return normalizedBaseUrl ? `${normalizedBaseUrl}/admin/` : "";
}

function isLoopbackHost(host) {
  const hostname = String(host || "").trim().replace(/:\d+$/, "");
  return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\])$/i.test(hostname);
}

function isLoopbackBaseUrl(value) {
  try {
    return isLoopbackHost(new URL(String(value || "")).host);
  } catch (error) {
    return isLoopbackHost(value);
  }
}

function normalizeUploadBaseUrl(request) {
  const configuredBaseUrl = normalizePublicBaseUrlValue(process.env.PUBLIC_BASE_URL);
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const host = String(
    request.headers["x-forwarded-host"] ||
    request.headers.host ||
    ""
  ).trim();

  if (!host) {
    return `http://127.0.0.1:${PORT}`;
  }

  const protocol = String(request.headers["x-forwarded-proto"] || "").trim() ||
    (isLoopbackHost(host) ? "http" : "https");

  return normalizePublicBaseUrlValue(`${protocol}://${host}`);
}

function resolveAdminPublicUrl(request, publicBaseUrl = normalizeUploadBaseUrl(request)) {
  const configuredAdminUrl = normalizeAdminPublicUrlValue(process.env.ADMIN_PUBLIC_URL, publicBaseUrl);
  return configuredAdminUrl || (publicBaseUrl ? `${publicBaseUrl}/admin/` : "");
}

function buildPublicAccessInfo(request) {
  const publicBaseUrl = normalizeUploadBaseUrl(request);
  return {
    mode: isLoopbackBaseUrl(publicBaseUrl) ? "local" : "domain",
    publicBaseUrl,
    apiBaseUrl: publicBaseUrl,
    adminUrl: resolveAdminPublicUrl(request, publicBaseUrl)
  };
}

function parseBase64ImagePayload(payload = {}) {
  const rawBase64 = String(payload.base64Data || "").trim();
  if (!rawBase64) {
    const error = new Error("请先选择签到照片");
    error.statusCode = 400;
    error.payload = {
      message: "请先选择签到照片",
      code: "CHECKIN_IMAGE_REQUIRED"
    };
    throw error;
  }

  let mimeType = String(payload.mimeType || "").trim().toLowerCase();
  let base64Data = rawBase64;
  const dataUrlMatch = rawBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (dataUrlMatch) {
    mimeType = mimeType || String(dataUrlMatch[1] || "").toLowerCase();
    base64Data = dataUrlMatch[2] || "";
  }

  mimeType = mimeType || "image/jpeg";
  const extension = getImageExtensionFromMimeType(mimeType);

  if (!extension) {
    const error = new Error("仅支持 JPG、PNG 或 WebP 图片");
    error.statusCode = 400;
    error.payload = {
      message: "仅支持 JPG、PNG 或 WebP 图片",
      code: "CHECKIN_IMAGE_TYPE_UNSUPPORTED"
    };
    throw error;
  }

  let buffer = Buffer.alloc(0);

  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch (error) {
    buffer = Buffer.alloc(0);
  }

  if (!buffer.length) {
    const error = new Error("签到照片解析失败，请重新选择图片");
    error.statusCode = 400;
    error.payload = {
      message: "签到照片解析失败，请重新选择图片",
      code: "CHECKIN_IMAGE_INVALID"
    };
    throw error;
  }

  if (buffer.length > MAX_CHECKIN_IMAGE_BYTES) {
    const error = new Error("签到照片不能超过 5MB");
    error.statusCode = 400;
    error.payload = {
      message: "签到照片不能超过 5MB",
      code: "CHECKIN_IMAGE_TOO_LARGE"
    };
    throw error;
  }

  return {
    buffer,
    mimeType,
    extension
  };
}

async function saveCheckinImageUpload(payload, request) {
  const { buffer, mimeType, extension } = parseBase64ImagePayload(payload);
  const now = new Date();
  const dateFolder = now.toISOString().slice(0, 10).replace(/-/g, "");
  const reservationSegment = sanitizeUploadSegment(payload.reservationNo, "reservation");
  const seatSegment = sanitizeUploadSegment(payload.seatId, "seat");
  const sourceSegment = sanitizeUploadSegment(payload.source, "upload");
  const fileName = `${reservationSegment}-${seatSegment}-${sourceSegment}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  const relativePath = path.posix.join("checkin", dateFolder, fileName);
  const targetDir = path.join(UPLOAD_ROOT, "checkin", dateFolder);
  const targetPath = path.join(targetDir, fileName);

  await fs.mkdir(targetDir, {
    recursive: true
  });
  await fs.writeFile(targetPath, buffer);

  const baseUrl = normalizeUploadBaseUrl(request);
  const publicPath = `/uploads/${relativePath}`;

  return {
    key: relativePath,
    url: baseUrl ? `${baseUrl}${publicPath}` : publicPath,
    source: sourceSegment,
    mimeType,
    size: buffer.length,
    uploadedAt: now.toISOString()
  };
}

function buildHomeResponse(rules = defaultRules) {
  const stats = getStats();
  const zones = getZones();
  const notices = buildMockNotices();

  const hotZones = zones
    .map((zone) => ({
      zoneCode: zone.zoneCode,
      displayName: zone.displayName,
      band: zone.band,
      gridLetter: zone.gridLetter,
      gridNumber: zone.gridNumber,
      seatCount: zone.seatCount,
      tableGroupCount: zone.tableGroupCount,
      quietSeatCount: zone.seats.filter((seat) => seat.quietLevel === "安静").length
    }))
    .sort((left, right) => right.seatCount - left.seatCount || compareZones(left, right))
    .slice(0, 6);

  return {
    systemName: "图书馆预约占座系统",
    stage: "一期默认开发版",
    summary: {
      seatCount: stats.seatCount,
      zoneCount: stats.zoneCount,
      tableGroupCount: stats.tableGroupCount,
      quietSeatCount: stats.quietDistribution["安静"] || 0,
      poweredSeatCount: stats.hasPowerDistribution.true || 0
    },
    rules: {
      openTime: rules.openTime,
      closeTime: rules.closeTime,
      advanceDays: rules.advanceDays,
      minReservationMinutes: rules.minReservationMinutes,
      maxReservationMinutes: rules.maxReservationMinutes
    },
    filters: filterOptions,
    presets: scenePresets,
    notices,
    hotZones
  };
}

async function buildHomeResponseFromDb(rules = defaultRules) {
  const summary = await getHomeSummaryFromDb();
  const notices = await listPublishedNoticesFromDb(5);
  const hotZones = await listHotZonesFromDb(6);

  return {
    systemName: "图书馆预约占座系统",
    stage: "一期默认开发版",
    summary: {
      seatCount: Number(summary.seatCount || 0),
      zoneCount: Number(summary.zoneCount || 0),
      tableGroupCount: Number(summary.tableGroupCount || 0),
      quietSeatCount: Number(summary.quietSeatCount || 0),
      poweredSeatCount: Number(summary.poweredSeatCount || 0)
    },
    rules: {
      openTime: rules.openTime,
      closeTime: rules.closeTime,
      advanceDays: rules.advanceDays,
      minReservationMinutes: rules.minReservationMinutes,
      maxReservationMinutes: rules.maxReservationMinutes
    },
    filters: filterOptions,
    presets: scenePresets,
    notices,
    hotZones
  };
}

async function buildReservationListResponse(studentNo, rules = defaultRules) {
  const reservations = await listReservationsByStudentNo(studentNo, rules);
  return {
    studentNo,
    current: reservations.current,
    history: reservations.history
  };
}

async function buildReservationPreviewResponse(body, rules = defaultRules) {
  const context = await getReservationValidationContext(body, rules);
  const validation = validateReservationInput(body, context, rules);

  return {
    valid: validation.valid,
    seat: validation.seat
      ? {
          seatId: validation.seat.seatId,
          zoneCode: validation.seat.zoneCode,
          zoneDisplayName: validation.seat.zoneDisplayName,
          seatType: validation.seat.seatType
        }
      : null,
    user: validation.user
      ? {
          studentNo: validation.user.studentNo,
          realName: validation.user.realName,
          creditScore: validation.user.creditScore
        }
      : null,
    request: validation.request,
    checks: validation.checks,
    conflicts: validation.conflicts,
    message: validation.message
  };
}

async function buildProfileResponse(studentNo, rules = defaultRules) {
  await syncReservationStates(rules);
  const profile = await getProfileByStudentNo(studentNo);

  if (!profile) {
    const error = new Error(`未找到学号 ${studentNo} 对应的用户信息`);
    error.statusCode = 404;
    throw error;
  }

  return {
    ...profile,
    ruleHints: {
      initialCreditScore: rules.initialCreditScore,
      blacklistCreditThreshold: rules.blacklistCreditThreshold,
      blacklistDays: rules.blacklistDays
    }
  };
}

function getSeatMatchedFilterCount(seat, filters) {
  const tagKeys = seat.tagKeys || [];
  return filters.filter((filterKey) => tagKeys.includes(filterKey)).length;
}

function decodeQueryText(value) {
  let decodedText = String(value || "").trim();
  if (!decodedText) {
    return "";
  }

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextText = decodeURIComponent(decodedText);
      if (nextText === decodedText) {
        break;
      }
      decodedText = nextText;
    } catch (error) {
      break;
    }
  }

  return decodedText;
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(decodeQueryText(value).toLowerCase());
}

function shouldUseRealtimeSeatRuntime(searchParams) {
  return (
    isTruthyFlag(searchParams.get("assistantMode")) ||
    isTruthyFlag(searchParams.get("softPreferenceMode"))
  );
}

function buildSeatQueryRuntimeCandidates(seats, searchParams, fallbackZoneCode = "") {
  const zoneCode = decodeQueryText(fallbackZoneCode || searchParams.get("zoneCode"));
  const search = decodeQueryText(searchParams.get("search")).toLowerCase();

  return (seats || []).filter((seat) => {
    if (zoneCode && seat.zoneCode !== zoneCode) {
      return false;
    }

    if (search && !String(seat.searchText || "").includes(search)) {
      return false;
    }

    return true;
  });
}

async function buildRealtimeRuntimeForSeatQuery(seats, searchParams, options = {}) {
  if (!shouldUseRealtimeSeatRuntime(searchParams)) {
    return null;
  }

  const candidateSeats = buildSeatQueryRuntimeCandidates(seats, searchParams, options.zoneCode);
  return predictSeatRuntime(candidateSeats, {
    message: decodeQueryText(searchParams.get("assistantMessage")),
    filters: normalizeFilters(searchParams.get("filters")),
    sceneKey: decodeQueryText(searchParams.get("sceneKey")),
    startTime: decodeQueryText(searchParams.get("startTime")),
    endTime: decodeQueryText(searchParams.get("endTime")),
    timeoutMs: Number(process.env.SVM_INFERENCE_TIMEOUT_MS || 30000)
  });
}

function buildAssistantInferenceSeats(seats, options = {}) {
  const zoneCode = options.zoneCode || "";
  return (seats || []).filter((seat) => {
    if (zoneCode && seat.zoneCode !== zoneCode) {
      return false;
    }
    return buildSeatAvailability(seat, options.seatUsageMap, options.userReservationConflict).canReserve;
  });
}

async function buildSeatAssistantResult(body, rules = defaultRules) {
  const message = String(body.message || "").trim();
  if (!message) {
    const error = new Error("请输入你当前的选座需求");
    error.statusCode = 400;
    error.payload = {
      message: "请输入你当前的选座需求",
      code: "ASSISTANT_MESSAGE_REQUIRED"
    };
    throw error;
  }

  const seats = await listSeatsFromDb();
  const parsed = parseMessage(message);
  const searchParams = new URLSearchParams();

  if (body.studentNo) {
    searchParams.set("studentNo", body.studentNo);
  }
  if (body.reservationDate) {
    searchParams.set("reservationDate", body.reservationDate);
  }
  if (parsed.timeWindow && parsed.timeWindow.startTime && parsed.timeWindow.endTime) {
    searchParams.set("startTime", parsed.timeWindow.startTime);
    searchParams.set("endTime", parsed.timeWindow.endTime);
  } else {
    searchParams.set("startTime", body.startTime || "09:00");
    searchParams.set("endTime", body.endTime || "11:00");
  }

  const { seatUsageMap, userReservationConflict } = await buildSeatUsageMap(searchParams, rules);
  const filterKeys = parsed.filters.map((item) => item.key);
  const inferenceSeats = buildAssistantInferenceSeats(seats, {
    filters: filterKeys,
    zoneCode: body.zoneCode || "",
    seatUsageMap,
    userReservationConflict
  });
  let realtimeRuntime = null;
  try {
    realtimeRuntime = await predictSeatRuntime(inferenceSeats, {
      message,
      filters: filterKeys,
      sceneKey: parsed.scene ? parsed.scene.key : "",
      startTime: searchParams.get("startTime"),
      endTime: searchParams.get("endTime"),
      timeoutMs: Number(process.env.SVM_INFERENCE_TIMEOUT_MS || 30000)
    });
  } catch (error) {
    error.statusCode = 500;
    error.payload = {
      message: "SVM 实时预测失败，请检查 Python 环境和模型文件",
      code: "SVM_REALTIME_INFERENCE_FAILED",
      detail: error.message
    };
    throw error;
  }

  const result = filterSeats(inferenceSeats, {
    filters: filterKeys,
    zoneCode: body.zoneCode || "",
    reservationDate: body.reservationDate,
    startTime: searchParams.get("startTime"),
    endTime: searchParams.get("endTime"),
    seatUsageMap,
    userReservationConflict,
    runtime: realtimeRuntime,
    softPreferenceMode: true,
    limit: 100
  });

  return buildSeatAssistantResponse(message, result, {
    reservationDate: body.reservationDate || "",
    startTime: searchParams.get("startTime"),
    endTime: searchParams.get("endTime")
  });
}

async function buildSeatUsageMap(searchParams, rules = defaultRules) {
  await syncReservationStates(rules);
  const studentNo = decodeQueryText(searchParams.get("studentNo"));
  const reservationDate = decodeQueryText(searchParams.get("reservationDate"));
  const startTime = decodeQueryText(searchParams.get("startTime"));
  const endTime = decodeQueryText(searchParams.get("endTime"));

  return {
    seatUsageMap: await listSeatUsageByWindow({
      reservationDate,
      startTime,
      endTime
    }),
    userReservationConflict: await listUserReservationConflictByWindow({
      studentNo,
      reservationDate,
      startTime,
      endTime
    })
  };
}

async function buildZonesResponse(searchParams, rules = defaultRules) {
  const zones = await listZonesFromDb();
  const seats = await listSeatsFromDb();
  const filters = searchParams.get("filters");
  const search = searchParams.get("search");
  const { seatUsageMap, userReservationConflict } = await buildSeatUsageMap(searchParams, rules);
  const counts = buildZoneCounts(zones, seats, {
    filters,
    search,
    seatUsageMap,
    userReservationConflict,
    softPreferenceMode: shouldUseRealtimeSeatRuntime(searchParams)
  });

  return zones.map((zone) => ({
    zoneCode: zone.zoneCode,
    displayName: zone.displayName,
    band: zone.band,
    floor: zoneTemplateFloor(),
    gridLetter: zone.gridLetter,
    gridNumber: zone.gridNumber,
    seatCount: zone.seatCount,
    tableGroupCount: zone.tableGroupCount,
    matchedSeatCount: counts.get(zone.zoneCode) || 0,
    annotationStatus: zone.annotationStatus
  }));
}

async function buildSeatScheduleResponse(seatId, searchParams, rules = defaultRules) {
  const normalizedSeatId = String(seatId || "").trim();
  const reservationDate = String(searchParams.get("reservationDate") || "").trim();
  const seats = await listSeatsFromDb();
  const seat = seats.find((item) => item.seatId === normalizedSeatId) || null;

  if (!seat) {
    const error = new Error(`未找到座位 ${normalizedSeatId}`);
    error.statusCode = 404;
    throw error;
  }

  const occupied = await listSeatUsageByDate({
    seatId: normalizedSeatId,
    reservationDate
  });

  return {
    seat: {
      seatId: seat.seatId,
      zoneCode: seat.zoneCode,
      zoneDisplayName: seat.zoneDisplayName,
      tableGroupCode: seat.tableGroupCode,
      seatType: seat.seatType
    },
    reservationDate,
    openTime: rules.openTime,
    closeTime: rules.closeTime,
    slotMinutes: rules.slotMinutes,
    occupied,
    occupiedCount: occupied.length
  };
}

function zoneTemplateFloor() {
  return getDataset().zoneTemplate.floor;
}

async function requestHandler(request, response) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;

  try {
    if (request.method === "GET" && pathname === "/") {
      sendText(response, 200, "Library seat reservation server is running.");
      return;
    }

    if (request.method === "GET" && pathname === "/admin") {
      response.writeHead(302, {
        Location: "/admin/"
      });
      response.end();
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/admin/")) {
      const served = await serveAdminWeb(pathname, response);
      if (served) {
        return;
      }
    }

    if (request.method === "GET" && pathname === "/api/health") {
      const access = buildPublicAccessInfo(request);
      let database = {
        ok: false,
        error: null,
        dbName: process.env.DB_NAME || null
      };

      try {
        const result = await pingDatabase();
        database = {
          ok: true,
          error: null,
          dbName: result.db_name,
          serverTime: result.server_time
        };
      } catch (error) {
        database = {
          ok: false,
          error: error.message,
          dbName: process.env.DB_NAME || null
        };
      }

      sendJson(response, 200, {
        ok: true,
        serverTime: new Date().toISOString(),
        message: "服务运行正常",
        database,
        access
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/register") {
      const body = await readJsonBody(request);
      const activeRules = await getActiveRules();
      sendJson(response, 201, await registerUser(body, activeRules));
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await loginUser(body));
      return;
    }

    if (request.method === "POST" && pathname === "/api/uploads/checkin-image-disabled") {
      sendJson(response, 410, {
        message: "拍照签到已停用，请使用定位签到。",
        code: "CHECKIN_IMAGE_DISABLED"
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/uploads/checkin-image-legacy-disabled") {
      const body = await readJsonBody(request, {
        maxBytes: MAX_CHECKIN_IMAGE_BODY_BYTES
      });
      const studentNo = requireStudentNo(body.studentNo);
      const reservationNo = String(body.reservationNo || "").trim();

      if (!reservationNo) {
        sendJson(response, 400, {
          message: "reservationNo 不能为空",
          code: "RESERVATION_NO_REQUIRED"
        });
        return;
      }

      const { user, reservation } = await getReservationByNoForUser(studentNo, reservationNo);
      if (!user || !reservation) {
        sendJson(response, 404, {
          message: "未找到对应预约记录",
          code: "RESERVATION_NOT_FOUND"
        });
        return;
      }

      if (body.seatId && String(body.seatId).trim() !== reservation.seatId) {
        sendJson(response, 400, {
          message: "上传图片与当前预约座位不匹配",
          code: "CHECKIN_IMAGE_SEAT_MISMATCH",
          expectedSeatId: reservation.seatId,
          currentSeatId: String(body.seatId).trim()
        });
        return;
      }

      const uploadResult = await saveCheckinImageUpload({
        reservationNo,
        seatId: reservation.seatId,
        source: body.source || "upload",
        mimeType: body.mimeType,
        base64Data: body.base64Data
      }, request);

      sendJson(response, 201, {
        reservationNo,
        seatId: reservation.seatId,
        ...uploadResult,
        message: "签到照片上传成功"
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/login") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await adminLogin(body));
      return;
    }

    if (request.method === "GET" && pathname === "/api/home") {
      const activeRules = await getActiveRules();
      sendJson(response, 200, await buildHomeResponseFromDb(activeRules));
      return;
    }

    if (request.method === "GET" && pathname === "/api/notices") {
      sendJson(response, 200, {
        items: await listPublishedNoticesFromDb(requestUrl.searchParams.get("limit") || 30)
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/rules") {
      const activeRules = await getActiveRules();
      sendJson(response, 200, {
        rules: activeRules,
        ...activeRules,
        filters: filterOptions,
        presets: scenePresets,
        statusLabels
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/algorithm/overview") {
      sendJson(response, 200, await getAlgorithmOverview());
      return;
    }

    if (request.method === "POST" && pathname === "/api/assistant/seat") {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      sendJson(response, 200, await buildSeatAssistantResult({
        ...body,
        studentNo: authenticatedUser ? authenticatedUser.studentNo : body.studentNo
      }, activeRules));
      return;
    }

    if (request.method === "GET" && pathname === "/api/zones") {
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      const searchParams = withAuthenticatedStudentNo(requestUrl.searchParams, authenticatedUser);
      const items = await buildZonesResponse(searchParams, activeRules);
      sendJson(response, 200, {
        floor: items[0] ? items[0].floor : zoneTemplateFloor(),
        items
      });
      return;
    }

    const zoneSeatsMatch = pathname.match(/^\/api\/zones\/([^/]+)\/seats$/);
    if (request.method === "GET" && zoneSeatsMatch) {
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const searchParams = withAuthenticatedStudentNo(requestUrl.searchParams, authenticatedUser);
      const zoneCode = decodeURIComponent(zoneSeatsMatch[1]);
      const zones = await listZonesFromDb();
      const zone = zones.find((item) => item.zoneCode === zoneCode) || null;

      if (!zone) {
        sendJson(response, 404, {
          message: `未找到分区 ${zoneCode}`
        });
        return;
      }

      const seats = await listSeatsFromDb();
      const activeRules = await getActiveRules();
      const { seatUsageMap, userReservationConflict } = await buildSeatUsageMap(searchParams, activeRules);
      const runtime = await buildRealtimeRuntimeForSeatQuery(seats, searchParams, { zoneCode });
      const result = filterSeats(seats, {
        filters: searchParams.get("filters"),
        search: searchParams.get("search"),
        zoneCode,
        reservationDate: searchParams.get("reservationDate"),
        startTime: searchParams.get("startTime"),
        endTime: searchParams.get("endTime"),
        seatUsageMap,
        userReservationConflict,
        runtime,
        softPreferenceMode: shouldUseRealtimeSeatRuntime(searchParams),
        limit: searchParams.get("limit") || "30"
      });

      sendJson(response, 200, {
        zone: {
          zoneCode: zone.zoneCode,
          displayName: zone.displayName,
          seatCount: zone.seatCount,
          tableGroupCount: zone.tableGroupCount
        },
        ...result
      });
      return;
    }

    const seatScheduleMatch = pathname.match(/^\/api\/seats\/([^/]+)\/schedule$/);
    if (request.method === "GET" && seatScheduleMatch) {
      const activeRules = await getActiveRules();
      sendJson(
        response,
        200,
        await buildSeatScheduleResponse(decodeURIComponent(seatScheduleMatch[1]), requestUrl.searchParams, activeRules)
      );
      return;
    }

    if (request.method === "GET" && pathname === "/api/seats") {
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const searchParams = withAuthenticatedStudentNo(requestUrl.searchParams, authenticatedUser);
      const seats = await listSeatsFromDb();
      const activeRules = await getActiveRules();
      const { seatUsageMap, userReservationConflict } = await buildSeatUsageMap(searchParams, activeRules);
      const runtime = await buildRealtimeRuntimeForSeatQuery(seats, searchParams);
      const result = filterSeats(seats, {
        filters: searchParams.get("filters"),
        search: searchParams.get("search"),
        zoneCode: searchParams.get("zoneCode"),
        reservationDate: searchParams.get("reservationDate"),
        startTime: searchParams.get("startTime"),
        endTime: searchParams.get("endTime"),
        seatUsageMap,
        userReservationConflict,
        runtime,
        softPreferenceMode: shouldUseRealtimeSeatRuntime(searchParams),
        limit: searchParams.get("limit") || "20"
      });

      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "GET" &&
      (pathname === "/api/reservations/mock" || pathname === "/api/reservations/me")
    ) {
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(requestUrl.searchParams.get("studentNo"), authenticatedUser);
      sendJson(response, 200, await buildReservationListResponse(studentNo, activeRules));
      return;
    }

    if (request.method === "GET" && pathname === "/api/profile/me") {
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(requestUrl.searchParams.get("studentNo"), authenticatedUser);
      sendJson(response, 200, await buildProfileResponse(studentNo, activeRules));
      return;
    }

    if (request.method === "GET" && pathname === "/api/profile/mock") {
      sendJson(response, 200, buildMockProfile());
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/dashboard") {
      const authenticatedAdmin = await requireAdminUser(request);
      const activeRules = await getActiveRules();
      await syncReservationStates(activeRules);
      sendJson(response, 200, await getAdminDashboard(authenticatedAdmin.studentNo));
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/reports") {
      const authenticatedAdmin = await requireAdminUser(request);
      const activeRules = await getActiveRules();
      await syncReservationStates(activeRules);
      sendJson(response, 200, await getAdminReports(authenticatedAdmin.studentNo, {
        startDate: requestUrl.searchParams.get("startDate"),
        endDate: requestUrl.searchParams.get("endDate")
      }, activeRules));
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/notices") {
      const authenticatedAdmin = await requireAdminUser(request);
      sendJson(response, 200, await listAdminNotices(authenticatedAdmin.studentNo, {
        keyword: requestUrl.searchParams.get("keyword"),
        status: requestUrl.searchParams.get("status"),
        audience: requestUrl.searchParams.get("audience"),
        limit: requestUrl.searchParams.get("limit")
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/notices") {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(response, 201, await createAdminNotice(authenticatedAdmin.studentNo, body));
      return;
    }

    const adminNoticeMatch = pathname.match(/^\/api\/admin\/notices\/(\d+)$/);
    if (request.method === "POST" && adminNoticeMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminNotice(authenticatedAdmin.studentNo, adminNoticeMatch[1], body)
      );
      return;
    }

    const adminNoticeStatusMatch = pathname.match(/^\/api\/admin\/notices\/(\d+)\/status$/);
    if (request.method === "POST" && adminNoticeStatusMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminNoticeStatus(
          authenticatedAdmin.studentNo,
          adminNoticeStatusMatch[1],
          body.status
        )
      );
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/reservations") {
      const authenticatedAdmin = await requireAdminUser(request);
      const activeRules = await getActiveRules();
      await syncReservationStates(activeRules);
      sendJson(response, 200, await listAdminReservations(authenticatedAdmin.studentNo, {
        keyword: requestUrl.searchParams.get("keyword"),
        status: requestUrl.searchParams.get("status"),
        reservationDate: requestUrl.searchParams.get("reservationDate"),
        limit: requestUrl.searchParams.get("limit")
      }));
      return;
    }

    const adminReservationCheckoutMatch = pathname.match(/^\/api\/admin\/reservations\/([^/]+)\/manual-checkout$/);
    if (request.method === "POST" && adminReservationCheckoutMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      const activeRules = await getActiveRules();
      await syncReservationStates(activeRules);
      sendJson(
        response,
        200,
        await manualCheckoutAdminReservation(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminReservationCheckoutMatch[1]),
          body
        )
      );
      return;
    }

    const adminReservationReleaseMatch = pathname.match(/^\/api\/admin\/reservations\/([^/]+)\/release$/);
    if (request.method === "POST" && adminReservationReleaseMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      const activeRules = await getActiveRules();
      await syncReservationStates(activeRules);
      sendJson(
        response,
        200,
        await releaseAdminReservation(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminReservationReleaseMatch[1]),
          body,
          activeRules
        )
      );
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/configs") {
      const authenticatedAdmin = await requireAdminUser(request);
      sendJson(response, 200, await listAdminRuleConfigs(authenticatedAdmin.studentNo));
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/configs") {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, await updateAdminRuleConfigs(authenticatedAdmin.studentNo, body));
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/users") {
      const authenticatedAdmin = await requireAdminUser(request);
      sendJson(response, 200, await listAdminUsers(authenticatedAdmin.studentNo, {
        keyword: requestUrl.searchParams.get("keyword"),
        blacklistOnly: requestUrl.searchParams.get("blacklistOnly"),
        limit: requestUrl.searchParams.get("limit")
      }));
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/zones") {
      const authenticatedAdmin = await requireAdminUser(request);
      sendJson(response, 200, await listAdminZones(authenticatedAdmin.studentNo));
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/zones") {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(response, 201, await createAdminZone(authenticatedAdmin.studentNo, body));
      return;
    }

    const adminZoneMatch = pathname.match(/^\/api\/admin\/zones\/([^/]+)$/);
    if (request.method === "POST" && adminZoneMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminZone(authenticatedAdmin.studentNo, decodeURIComponent(adminZoneMatch[1]), body)
      );
      return;
    }

    const adminZoneDeleteMatch = pathname.match(/^\/api\/admin\/zones\/([^/]+)\/delete$/);
    if (request.method === "POST" && adminZoneDeleteMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await deleteAdminZone(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminZoneDeleteMatch[1]),
          body
        )
      );
      return;
    }

    const adminZoneStatusMatch = pathname.match(/^\/api\/admin\/zones\/([^/]+)\/status$/);
    if (request.method === "POST" && adminZoneStatusMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminZoneEnabled(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminZoneStatusMatch[1]),
          body
        )
      );
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/seats") {
      const authenticatedAdmin = await requireAdminUser(request);
      sendJson(response, 200, await listAdminSeats(authenticatedAdmin.studentNo, {
        keyword: requestUrl.searchParams.get("keyword"),
        zoneCode: requestUrl.searchParams.get("zoneCode"),
        seatStatus: requestUrl.searchParams.get("seatStatus"),
        limit: requestUrl.searchParams.get("limit")
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/seats") {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(response, 201, await createAdminSeat(authenticatedAdmin.studentNo, body));
      return;
    }

    const adminSeatMatch = pathname.match(/^\/api\/admin\/seats\/([^/]+)$/);
    if (request.method === "POST" && adminSeatMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminSeat(authenticatedAdmin.studentNo, decodeURIComponent(adminSeatMatch[1]), body)
      );
      return;
    }

    const adminSeatDeleteMatch = pathname.match(/^\/api\/admin\/seats\/([^/]+)\/delete$/);
    if (request.method === "POST" && adminSeatDeleteMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await deleteAdminSeat(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminSeatDeleteMatch[1]),
          body
        )
      );
      return;
    }

    const adminSeatStatusMatch = pathname.match(/^\/api\/admin\/seats\/([^/]+)\/status$/);
    if (request.method === "POST" && adminSeatStatusMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await updateAdminSeatStatus(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminSeatStatusMatch[1]),
          body
        )
      );
      return;
    }

    const adminUserCreditMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/credit-adjust$/);
    if (request.method === "POST" && adminUserCreditMatch) {
      const authenticatedAdmin = await requireAdminUser(request);
      const body = await readJsonBody(request);
      const activeRules = await getActiveRules();
      sendJson(
        response,
        200,
        await adjustAdminUserCredit(
          authenticatedAdmin.studentNo,
          decodeURIComponent(adminUserCreditMatch[1]),
          body,
          activeRules
        )
      );
      return;
    }

    if (request.method === "POST" && pathname === "/api/reservations/preview") {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      sendJson(response, 200, await buildReservationPreviewResponse({
        ...body,
        studentNo
      }, activeRules));
      return;
    }

    if (request.method === "POST" && pathname === "/api/reservations") {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await createReservation({
        ...body,
        studentNo
      }, activeRules);
      sendJson(response, 201, result);
      return;
    }

    const cancelMatch = pathname.match(/^\/api\/reservations\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const reservationNo = decodeURIComponent(cancelMatch[1]);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await cancelReservationByNo(
        {
          reservationNo,
          studentNo,
          cancelReason: body.cancelReason || "user_cancelled"
        },
        activeRules
      );
      sendJson(response, 200, result);
      return;
    }

    const checkinMatch = pathname.match(/^\/api\/reservations\/([^/]+)\/checkin$/);
    if (request.method === "POST" && checkinMatch) {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const reservationNo = decodeURIComponent(checkinMatch[1]);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await checkinReservationByNo({
        reservationNo,
        studentNo,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        coordinateType: body.coordinateType
      }, activeRules);
      sendJson(response, 200, result);
      return;
    }

    const checkoutMatch = pathname.match(/^\/api\/reservations\/([^/]+)\/checkout$/);
    if (request.method === "POST" && checkoutMatch) {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const reservationNo = decodeURIComponent(checkoutMatch[1]);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await checkoutReservationByNo({
        reservationNo,
        studentNo
      }, activeRules);
      sendJson(response, 200, result);
      return;
    }

    const leaveStartMatch = pathname.match(/^\/api\/reservations\/([^/]+)\/leave-start$/);
    if (request.method === "POST" && leaveStartMatch) {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const reservationNo = decodeURIComponent(leaveStartMatch[1]);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await startLeaveByReservationNo({
        reservationNo,
        studentNo
      }, activeRules);
      sendJson(response, 200, result);
      return;
    }

    const returnMatch = pathname.match(/^\/api\/reservations\/([^/]+)\/return$/);
    if (request.method === "POST" && returnMatch) {
      const body = await readJsonBody(request);
      const authenticatedUser = await getOptionalAuthenticatedUser(request);
      const reservationNo = decodeURIComponent(returnMatch[1]);
      const activeRules = await getActiveRules();
      const studentNo = resolveStudentNo(body.studentNo, authenticatedUser);
      const result = await returnLeaveByReservationNo({
        reservationNo,
        studentNo
      }, activeRules);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, {
      message: `未匹配到接口 ${request.method} ${pathname}`
    });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;

    if (error.payload && typeof error.payload === "object") {
      sendJson(response, statusCode, {
        ...error.payload,
        message: error.payload.message || error.message
      });
      return;
    }

    if (statusCode >= 500) {
      sendJson(response, statusCode, {
        message: "服务内部错误",
        error: error.message
      });
      return;
    }

    sendJson(response, statusCode, {
      message: error.message
    });
  }
}

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  const localBaseUrl = `http://127.0.0.1:${PORT}`;
  const publicBaseUrl = normalizeUploadBaseUrl({
    headers: {
      host: `127.0.0.1:${PORT}`,
      "x-forwarded-host": process.env.PUBLIC_BASE_URL ? "" : undefined,
      "x-forwarded-proto": "http"
    }
  });
  const access = {
    publicBaseUrl: normalizePublicBaseUrlValue(process.env.PUBLIC_BASE_URL) || publicBaseUrl,
    adminUrl: normalizeAdminPublicUrlValue(
      process.env.ADMIN_PUBLIC_URL,
      normalizePublicBaseUrlValue(process.env.PUBLIC_BASE_URL) || publicBaseUrl
    ) || `${publicBaseUrl}/admin/`
  };

  console.log(`Library seat reservation server listening on ${localBaseUrl}`);
  console.log(`Admin web entry: ${access.adminUrl}`);
});
