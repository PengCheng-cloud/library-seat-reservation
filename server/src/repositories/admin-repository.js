const { getPool, query } = require("../lib/db");
const { issueAuthToken } = require("../lib/auth");
const { assertPasswordMatches } = require("./auth-repository");
const {
  RULE_CONFIG_GROUPS,
  getRuleConfigDefinition,
  normalizeConfigInput,
  buildRulesFromConfigRows,
  buildRuleConfigItems,
  queryRuleConfigRows
} = require("../lib/rule-config");

const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const NOTICE_TYPES = new Set(["system", "maintenance", "activity", "rule"]);
const NOTICE_AUDIENCES = new Set(["all", "reader", "admin"]);
const NOTICE_STATUSES = new Set(["draft", "published", "offline"]);
const ZONE_BANDS = new Set(["north", "south_outer", "south_inner", "east", "west", "inner"]);
const ZONE_ANNOTATION_STATUSES = new Set(["pending", "annotated", "verified"]);
const SEAT_STATIC_STATUSES = new Set(["available", "disabled", "maintenance"]);
const SEAT_QUIET_LEVELS = new Set(["安静", "一般"]);
const RESERVATION_STATUSES = new Set([
  "reserved",
  "checked_in",
  "temporary_leave",
  "completed",
  "cancelled",
  "no_show",
  "violation",
  "admin_released"
]);
const ADMIN_RELEASEABLE_RESERVATION_STATUSES = new Set(["reserved", "checked_in", "temporary_leave"]);
const ADMIN_CHECKOUTABLE_RESERVATION_STATUSES = new Set(["checked_in", "temporary_leave"]);
const TAG_SEPARATOR = "、";

function buildError(message, statusCode, code, payload) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || null;
  error.payload = {
    message,
    ...(code ? { code } : {}),
    ...(payload && typeof payload === "object" ? payload : {})
  };
  return error;
}

function requireValue(value, message, code) {
  const text = String(value || "").trim();
  if (!text) {
    throw buildError(message, 400, code);
  }

  return text;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 5);
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeNoticeDateTime(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace("T", " ");
  const date = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    throw buildError("公告时间格式不正确", 400, "NOTICE_DATETIME_INVALID");
  }

  return formatDateTime(date);
}

function buildLikeKeyword(keyword) {
  const text = String(keyword || "").trim();
  return text ? `%${text}%` : "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(text)) {
    return false;
  }

  return fallback;
}

function normalizeOptionalText(value, maxLength = 255) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeIntegerValue(value, options = {}) {
  const text = String(value ?? "").trim();
  const fallback = Object.prototype.hasOwnProperty.call(options, "fallback") ? options.fallback : null;

  if (!text) {
    if (fallback !== null && fallback !== undefined) {
      return fallback;
    }

    throw buildError(options.requiredMessage || "缺少必要的整数参数", 400, options.requiredCode);
  }

  const parsed = Number(text);
  if (!Number.isInteger(parsed)) {
    throw buildError(options.invalidMessage || "整数参数格式不正确", 400, options.invalidCode);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw buildError(options.invalidMessage || "整数参数超出允许范围", 400, options.invalidCode);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw buildError(options.invalidMessage || "整数参数超出允许范围", 400, options.invalidCode);
  }

  return parsed;
}

function buildSeatSeqLabel(seatSeq) {
  return String(seatSeq).padStart(2, "0");
}

function buildSeatQrToken(seatCode) {
  return `SEAT:${seatCode}`;
}

function buildSeatTagKeys(record = {}) {
  const seatCapacity = Number(record.seatCapacity || 0);
  const tagKeys = [
    record.hasPower ? "power_outlet" : "no_power_outlet",
    record.nearWindow ? "window" : "inner_side",
    record.quietLevel === "安静" ? "quiet" : "normal_noise",
    record.nearRestroom ? "near_restroom" : "away_from_restroom",
    record.nearPantry ? "near_pantry" : "away_from_pantry",
    record.nearAC ? "near_ac" : "balanced_temperature",
    record.nearBookshelf ? "near_bookshelf" : "away_from_bookshelf",
    record.nearCorridor ? "near_corridor" : "quiet_position",
    record.sunlight === "有" ? "sunlight_yes" : "sunlight_no"
  ];

  if (seatCapacity > 0) {
    tagKeys.push(`table_${seatCapacity}`);
  }

  return tagKeys;
}

function buildSeatRawTags(record = {}) {
  const rawTags = [];

  if (record.hasPower) {
    rawTags.push("有充电插座");
  }

  rawTags.push(record.nearWindow ? "靠窗座位" : "内侧座位");
  rawTags.push(record.quietLevel === "安静" ? "环境安静" : "普通音量");
  rawTags.push(record.nearRestroom ? "靠近卫生间" : "远离卫生间");
  rawTags.push(record.nearPantry ? "靠近茶水间" : "远离茶水间");
  rawTags.push(record.nearAC ? "靠近空调出风口" : "温度均衡");
  rawTags.push(record.nearBookshelf ? "靠近书架区" : "远离书架区");
  rawTags.push(record.nearCorridor ? "靠近通道" : "位置避静");

  if (record.seatType) {
    rawTags.push(record.seatType);
  }

  rawTags.push(record.sunlight === "有" ? "阳光充足" : "日照较弱");
  return rawTags;
}

function buildSeatDerivedMetadata(record = {}) {
  const rawTags = buildSeatRawTags(record);

  return {
    rawTags,
    rawTagsText: rawTags.join(TAG_SEPARATOR),
    rawTagsJson: JSON.stringify(rawTags),
    tagKeysJson: JSON.stringify(buildSeatTagKeys(record))
  };
}

function calcDiffMinutes(start, end) {
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diff / 60000));
}

function buildReservationActionAvailability(status) {
  return {
    canAdminRelease: ADMIN_RELEASEABLE_RESERVATION_STATUSES.has(status),
    canAdminCheckout: ADMIN_CHECKOUTABLE_RESERVATION_STATUSES.has(status)
  };
}

function calcPercent(numerator, denominator) {
  const safeNumerator = Number(numerator || 0);
  const safeDenominator = Number(denominator || 0);

  if (safeDenominator <= 0) {
    return 0;
  }

  return Number(((safeNumerator / safeDenominator) * 100).toFixed(1));
}

function parseDateInput(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getInclusiveDaySpan(startDate, endDate) {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const diff = end.getTime() - start.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function buildDateList(startDate, endDate) {
  const result = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const target = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  while (cursor <= target) {
    result.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function buildHourBuckets(openTime, closeTime) {
  const openMinutes = parseTimeToMinutes(openTime);
  const closeMinutes = parseTimeToMinutes(closeTime);

  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
    return [];
  }

  const startHour = Math.floor(openMinutes / 60);
  const endHour = Math.ceil(closeMinutes / 60);
  const buckets = [];

  for (let hour = startHour; hour < endHour; hour += 1) {
    buckets.push({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`
    });
  }

  return buckets;
}

function normalizeReportFilters(filters = {}) {
  const today = new Date();
  const inputEndDate = parseDateInput(filters.endDate);
  const endDate = inputEndDate || new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const inputStartDate = parseDateInput(filters.startDate);
  const startDate = inputStartDate || addDays(endDate, -6);
  const daySpan = getInclusiveDaySpan(startDate, endDate);

  if (inputStartDate === null && String(filters.startDate || "").trim()) {
    throw buildError("报表开始日期格式不正确，应为 YYYY-MM-DD", 400, "REPORT_START_DATE_INVALID");
  }

  if (inputEndDate === null && String(filters.endDate || "").trim()) {
    throw buildError("报表结束日期格式不正确，应为 YYYY-MM-DD", 400, "REPORT_END_DATE_INVALID");
  }

  if (startDate > endDate) {
    throw buildError("报表开始日期不能晚于结束日期", 400, "REPORT_DATE_RANGE_INVALID");
  }

  if (daySpan > 31) {
    throw buildError("统计报表时间范围暂时只支持 31 天内", 400, "REPORT_DATE_RANGE_TOO_LARGE");
  }

  return {
    startDate,
    endDate,
    startDateText: formatDate(startDate),
    endDateText: formatDate(endDate),
    daySpan
  };
}

function mapAdminUserRow(row) {
  return {
    id: row.id,
    studentNo: row.studentNo,
    realName: row.realName,
    role: row.role,
    status: row.status,
    creditScore: Number(row.creditScore || 0),
    isBlacklisted: Boolean(row.isBlacklisted),
    blacklistUntil: formatDateTime(row.blacklistUntil),
    lastLoginAt: formatDateTime(row.lastLoginAt)
  };
}

function mapNoticeRow(row) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    noticeType: row.noticeType,
    audience: row.audience,
    status: row.status,
    publishAt: formatDateTime(row.publishAt),
    expireAt: formatDateTime(row.expireAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    createdBy: row.createdBy || "",
    updatedBy: row.updatedBy || ""
  };
}

function mapReservationRow(row) {
  const actionAvailability = buildReservationActionAvailability(row.status);

  return {
    reservationNo: row.reservationNo,
    studentNo: row.studentNo,
    realName: row.realName,
    seatId: row.seatId,
    zoneCode: row.zoneCode,
    reservationDate: formatDate(row.reservationDate),
    startTime: formatTime(row.startTime),
    endTime: formatTime(row.endTime),
    status: row.status,
    violationType: row.violationType,
    checkedInAt: formatDateTime(row.checkedInAt),
    checkoutAt: formatDateTime(row.checkoutAt),
    createdAt: formatDateTime(row.createdAt),
    ...actionAvailability
  };
}

function mapUserListRow(row) {
  return {
    studentNo: row.studentNo,
    realName: row.realName,
    role: row.role,
    status: row.status,
    creditScore: Number(row.creditScore || 0),
    violationCount: Number(row.violationCount || 0),
    isBlacklisted: Boolean(row.isBlacklisted),
    blacklistUntil: formatDateTime(row.blacklistUntil),
    totalReservations: Number(row.totalReservations || 0),
    completedReservations: Number(row.completedReservations || 0),
    lastLoginAt: formatDateTime(row.lastLoginAt)
  };
}

function mapZoneListRow(row) {
  return {
    id: Number(row.id),
    zoneCode: row.zoneCode,
    displayName: row.displayName,
    floorNo: Number(row.floorNo || 0),
    gridLetter: row.gridLetter,
    gridNumber: Number(row.gridNumber || 0),
    band: row.band,
    seatCount: Number(row.seatCount || 0),
    tableGroupCount: Number(row.tableGroupCount || 0),
    annotationStatus: row.annotationStatus,
    sortOrder: Number(row.sortOrder || 0),
    isEnabled: Boolean(row.isEnabled),
    notes: row.notes || "",
    updatedAt: formatDateTime(row.updatedAt)
  };
}

function mapSeatListRow(row) {
  return {
    id: Number(row.id),
    seatCode: row.seatCode,
    zoneCode: row.zoneCode,
    zoneDisplayName: row.zoneDisplayName,
    floorNo: Number(row.floorNo || 0),
    tableCode: row.tableCode,
    tableGroupCode: row.tableGroupCode,
    seatSeq: Number(row.seatSeq || 0),
    seatSeqLabel: row.seatSeqLabel,
    seatType: row.seatType,
    seatStatus: row.seatStatus,
    seatCapacity: Number(row.seatCapacity || 0),
    hasPower: Boolean(row.hasPower),
    nearWindow: Boolean(row.nearWindow),
    quietLevel: row.quietLevel || "一般",
    specificLocation: row.specificLocation || "",
    sortOrder: Number(row.sortOrder || 0),
    updatedAt: formatDateTime(row.updatedAt)
  };
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
        violation_count AS violationCount,
        is_blacklisted AS isBlacklisted,
        blacklist_until AS blacklistUntil,
        last_login_at AS lastLoginAt
      FROM app_user
      WHERE student_no = ?
      LIMIT 1
    `,
    [studentNo]
  );

  return rows[0] || null;
}

async function assertAdminUser(studentNo) {
  const normalizedStudentNo = requireValue(studentNo, "请输入管理员账号", "ADMIN_ACCOUNT_REQUIRED");
  const user = await findUserByStudentNo(normalizedStudentNo);

  if (!user) {
    throw buildError("未找到管理员账号", 404, "ADMIN_USER_NOT_FOUND");
  }

  if (!ADMIN_ROLES.has(user.role)) {
    throw buildError("当前账号没有后台权限", 403, "ADMIN_ROLE_REQUIRED");
  }

  if (user.status !== "active") {
    throw buildError("当前管理员账号不可用", 403, "ADMIN_ACCOUNT_DISABLED");
  }

  return user;
}

async function insertAdminOperationLog(connection, payload) {
  await connection.execute(
    `
      INSERT INTO admin_operation_log (
        operator_user_id,
        action_module,
        action_type,
        target_type,
        target_id,
        request_ip,
        action_detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.operatorUserId,
      payload.actionModule,
      payload.actionType,
      payload.targetType || null,
      payload.targetId || null,
      payload.requestIp || null,
      payload.actionDetail ? JSON.stringify(payload.actionDetail) : null
    ]
  );
}

async function getReservationByNoForAdminAction(connection, reservationNo) {
  const [rows] = await connection.execute(
    `
      SELECT
        r.id,
        r.reservation_no AS reservationNo,
        r.user_id AS userId,
        r.seat_id AS seatDbId,
        r.zone_id AS zoneDbId,
        r.floor_no AS floorNo,
        r.reservation_date AS reservationDate,
        r.start_time AS startTime,
        r.end_time AS endTime,
        r.status,
        r.violation_type AS violationType,
        r.checkin_open_at AS checkinOpenAt,
        r.checkin_deadline_at AS checkinDeadlineAt,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt,
        r.remarks,
        u.student_no AS studentNo,
        u.real_name AS realName,
        s.seat_code AS seatId,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      INNER JOIN library_seat s ON r.seat_id = s.id
      INNER JOIN library_zone z ON r.zone_id = z.id
      WHERE r.reservation_no = ?
      LIMIT 1
      FOR UPDATE
    `,
    [reservationNo]
  );

  return rows[0] || null;
}

async function getReservationCheckinRecord(connection, reservationId) {
  const [rows] = await connection.execute(
    `
      SELECT
        id,
        checkin_type AS checkinType,
        first_checkin_at AS firstCheckinAt,
        checkout_type AS checkoutType,
        checkout_at AS checkoutAt,
        leave_count AS leaveCount,
        total_leave_minutes AS totalLeaveMinutes,
        last_leave_started_at AS lastLeaveStartedAt,
        last_returned_at AS lastReturnedAt,
        actual_usage_minutes AS actualUsageMinutes,
        final_result AS finalResult
      FROM reservation_checkin_record
      WHERE reservation_id = ?
      LIMIT 1
    `,
    [reservationId]
  );

  return rows[0] || null;
}

async function getOpenLeaveRecord(connection, reservationId) {
  const [rows] = await connection.execute(
    `
      SELECT
        id,
        leave_seq AS leaveSeq,
        leave_started_at AS leaveStartedAt,
        leave_deadline_at AS leaveDeadlineAt,
        returned_at AS returnedAt,
        leave_minutes AS leaveMinutes,
        is_timeout AS isTimeout
      FROM reservation_leave_record
      WHERE reservation_id = ?
        AND returned_at IS NULL
      ORDER BY leave_seq DESC
      LIMIT 1
    `,
    [reservationId]
  );

  return rows[0] || null;
}

async function closeOpenLeaveRecord(connection, openLeave, closedAt) {
  if (!openLeave) {
    return 0;
  }

  const leaveStartedAt = new Date(openLeave.leaveStartedAt);
  const leaveMinutes = Number.isNaN(leaveStartedAt.getTime())
    ? 0
    : calcDiffMinutes(leaveStartedAt, closedAt);

  await connection.execute(
    `
      UPDATE reservation_leave_record
      SET
        returned_at = ?,
        leave_minutes = ?,
        is_timeout = 0
      WHERE id = ?
    `,
    [formatDateTime(closedAt), leaveMinutes, openLeave.id]
  );

  return leaveMinutes;
}

async function upsertReservationCheckinRecord(connection, payload) {
  await connection.execute(
    `
      INSERT INTO reservation_checkin_record (
        reservation_id,
        checkin_type,
        first_checkin_at,
        checkout_type,
        checkout_at,
        leave_count,
        total_leave_minutes,
        last_leave_started_at,
        last_returned_at,
        actual_usage_minutes,
        final_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        checkin_type = COALESCE(VALUES(checkin_type), checkin_type),
        first_checkin_at = COALESCE(first_checkin_at, VALUES(first_checkin_at)),
        checkout_type = COALESCE(VALUES(checkout_type), checkout_type),
        checkout_at = COALESCE(VALUES(checkout_at), checkout_at),
        leave_count = VALUES(leave_count),
        total_leave_minutes = VALUES(total_leave_minutes),
        last_leave_started_at = VALUES(last_leave_started_at),
        last_returned_at = VALUES(last_returned_at),
        actual_usage_minutes = VALUES(actual_usage_minutes),
        final_result = VALUES(final_result),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      payload.reservationId,
      payload.checkinType || null,
      payload.firstCheckinAt || null,
      payload.checkoutType || null,
      payload.checkoutAt || null,
      payload.leaveCount || 0,
      payload.totalLeaveMinutes || 0,
      payload.lastLeaveStartedAt || null,
      payload.lastReturnedAt || null,
      payload.actualUsageMinutes || 0,
      payload.finalResult
    ]
  );
}

async function deleteReservationSlots(connection, reservationId) {
  await connection.execute(
    `
      DELETE FROM seat_reservation_slot
      WHERE reservation_id = ?
    `,
    [reservationId]
  );
}

async function appendReservationRemark(connection, reservationId, remark) {
  const normalizedRemark = String(remark || "").trim();
  if (!normalizedRemark) {
    return;
  }

  await connection.execute(
    `
      UPDATE seat_reservation
      SET remarks = CONCAT_WS('\n', NULLIF(remarks, ''), ?)
      WHERE id = ?
    `,
    [normalizedRemark, reservationId]
  );
}

function buildReservationFirstCheckinAt(checkinRecord, fallbackDate) {
  if (checkinRecord && checkinRecord.firstCheckinAt) {
    return formatDateTime(checkinRecord.firstCheckinAt);
  }

  return formatDateTime(fallbackDate);
}

function buildReservationUsageSummary(checkinRecord, now, extraLeaveMinutes = 0) {
  const firstCheckinAt = checkinRecord && checkinRecord.firstCheckinAt
    ? new Date(checkinRecord.firstCheckinAt)
    : now;
  const baseLeaveMinutes = Number(checkinRecord && checkinRecord.totalLeaveMinutes || 0);
  const totalLeaveMinutes = baseLeaveMinutes + Number(extraLeaveMinutes || 0);
  const actualUsageMinutes = Number.isNaN(firstCheckinAt.getTime())
    ? 0
    : Math.max(0, calcDiffMinutes(firstCheckinAt, now) - totalLeaveMinutes);

  return {
    firstCheckinAt,
    totalLeaveMinutes,
    actualUsageMinutes
  };
}

async function adminLogin(input) {
  const studentNo = requireValue(input.studentNo, "请输入管理员账号", "ADMIN_ACCOUNT_REQUIRED");
  const password = requireValue(input.password, "请输入管理员密码", "ADMIN_PASSWORD_REQUIRED");
  const user = await assertAdminUser(studentNo);

  await assertPasswordMatches(studentNo, password);

  await query(
    `
      UPDATE app_user
      SET last_login_at = NOW()
      WHERE id = ?
    `,
    [user.id]
  );

  const latestUser = await findUserByStudentNo(studentNo);
  const authUser = latestUser || user;
  const tokenResult = issueAuthToken(authUser, {
    scope: "admin"
  });

  return {
    message: "管理员登录成功",
    user: mapAdminUserRow(authUser),
    token: tokenResult.token,
    expiresAt: tokenResult.expiresAt
  };
}

async function getAdminDashboard(studentNo) {
  const admin = await assertAdminUser(studentNo);

  const [summaryRows] = await query(
    `
      SELECT
        (SELECT COUNT(*) FROM library_seat) AS totalSeats,
        (SELECT COUNT(*) FROM app_user WHERE role = 'reader') AS totalReaders,
        (SELECT COUNT(*) FROM seat_reservation WHERE status IN ('reserved', 'checked_in', 'temporary_leave')) AS activeReservations,
        (SELECT COUNT(*) FROM seat_reservation WHERE reservation_date = CURDATE()) AS todayReservations,
        (SELECT COUNT(*) FROM seat_reservation WHERE status IN ('no_show', 'violation')) AS violationReservations,
        (SELECT COUNT(*) FROM app_user WHERE is_blacklisted = 1 AND (blacklist_until IS NULL OR blacklist_until >= NOW())) AS blacklistedUsers,
        (SELECT COUNT(*) FROM system_notice WHERE status = 'published') AS publishedNotices
    `
  );

  const summaryRow = summaryRows[0] || {};
  const totalSeats = Number(summaryRow.totalSeats || 0);
  const todayReservations = Number(summaryRow.todayReservations || 0);

  const [statusRows] = await query(
    `
      SELECT
        status,
        COUNT(*) AS count
      FROM seat_reservation
      GROUP BY status
      ORDER BY count DESC, status ASC
    `
  );

  const [recentReservationRows] = await query(
    `
      SELECT
        r.reservation_no AS reservationNo,
        u.student_no AS studentNo,
        u.real_name AS realName,
        s.seat_code AS seatId,
        z.zone_code AS zoneCode,
        r.reservation_date AS reservationDate,
        r.start_time AS startTime,
        r.end_time AS endTime,
        r.status,
        r.violation_type AS violationType,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt,
        r.created_at AS createdAt
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      INNER JOIN library_seat s ON r.seat_id = s.id
      INNER JOIN library_zone z ON r.zone_id = z.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 8
    `
  );

  const [noticeRows] = await query(
    `
      SELECT
        n.id,
        n.title,
        n.content,
        n.notice_type AS noticeType,
        n.audience,
        n.status,
        n.publish_at AS publishAt,
        n.expire_at AS expireAt,
        n.created_at AS createdAt,
        n.updated_at AS updatedAt,
        creator.real_name AS createdBy,
        updater.real_name AS updatedBy
      FROM system_notice n
      INNER JOIN app_user creator ON n.created_by = creator.id
      LEFT JOIN app_user updater ON n.updated_by = updater.id
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT 6
    `
  );

  const [creditWarningRows] = await query(
    `
      SELECT
        u.student_no AS studentNo,
        u.real_name AS realName,
        u.role,
        u.status,
        u.credit_score AS creditScore,
        u.violation_count AS violationCount,
        u.is_blacklisted AS isBlacklisted,
        u.blacklist_until AS blacklistUntil,
        u.last_login_at AS lastLoginAt,
        COUNT(r.id) AS totalReservations,
        SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completedReservations
      FROM app_user u
      LEFT JOIN seat_reservation r ON r.user_id = u.id
      WHERE u.role = 'reader'
        AND (u.is_blacklisted = 1 OR u.credit_score <= 80)
      GROUP BY u.id
      ORDER BY u.is_blacklisted DESC, u.credit_score ASC, u.id DESC
      LIMIT 8
    `
  );

  return {
    admin: mapAdminUserRow(admin),
    summary: {
      totalSeats,
      totalReaders: Number(summaryRow.totalReaders || 0),
      activeReservations: Number(summaryRow.activeReservations || 0),
      todayReservations,
      violationReservations: Number(summaryRow.violationReservations || 0),
      blacklistedUsers: Number(summaryRow.blacklistedUsers || 0),
      publishedNotices: Number(summaryRow.publishedNotices || 0),
      todaySeatUsageRate: totalSeats > 0 ? Number(((todayReservations / totalSeats) * 100).toFixed(1)) : 0
    },
    statusDistribution: statusRows.map((row) => ({
      status: row.status,
      count: Number(row.count || 0)
    })),
    recentReservations: recentReservationRows.map(mapReservationRow),
    recentNotices: noticeRows.map(mapNoticeRow),
    creditWarnings: creditWarningRows.map(mapUserListRow)
  };
}

async function getAdminReports(studentNo, filters = {}, rules = null) {
  await assertAdminUser(studentNo);

  const range = normalizeReportFilters(filters);
  const resolvedRules =
    rules && typeof rules === "object"
      ? rules
      : buildRulesFromConfigRows(await queryRuleConfigRows());

  const openMinutes = parseTimeToMinutes(resolvedRules.openTime);
  const closeMinutes = parseTimeToMinutes(resolvedRules.closeTime);
  const openMinutesPerDay =
    openMinutes !== null && closeMinutes !== null && closeMinutes > openMinutes
      ? closeMinutes - openMinutes
      : 16 * 60;
  const hourBuckets = buildHourBuckets(resolvedRules.openTime, resolvedRules.closeTime);

  const [seatCapacityRows] = await query(
    `
      SELECT
        COUNT(*) AS totalSeats,
        SUM(CASE WHEN z.is_enabled = 1 AND s.seat_status = 'available' THEN 1 ELSE 0 END) AS operationalSeats
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
    `
  );

  const seatCapacityRow = seatCapacityRows[0] || {};
  const totalSeatCount = Number(seatCapacityRow.totalSeats || 0);
  const operationalSeatCount = Number(seatCapacityRow.operationalSeats || 0) || totalSeatCount;
  const periodCapacityMinutes = operationalSeatCount * openMinutesPerDay * range.daySpan;

  const [summaryRows] = await query(
    `
      SELECT
        COUNT(*) AS totalReservations,
        SUM(duration_minutes) AS totalReservedMinutes,
        AVG(duration_minutes) AS avgDurationMinutes,
        SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInReservations,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedReservations,
        SUM(CASE WHEN status IN ('reserved', 'checked_in', 'temporary_leave') THEN 1 ELSE 0 END) AS activeReservations,
        SUM(CASE WHEN violation_type <> 'none' OR status IN ('no_show', 'violation') THEN 1 ELSE 0 END) AS violationReservations
      FROM seat_reservation
      WHERE reservation_date BETWEEN ? AND ?
    `,
    [range.startDateText, range.endDateText]
  );

  const summaryRow = summaryRows[0] || {};
  const totalReservations = Number(summaryRow.totalReservations || 0);
  const totalReservedMinutes = Number(summaryRow.totalReservedMinutes || 0);
  const checkedInReservations = Number(summaryRow.checkedInReservations || 0);
  const violationReservations = Number(summaryRow.violationReservations || 0);
  const completedReservations = Number(summaryRow.completedReservations || 0);
  const activeReservations = Number(summaryRow.activeReservations || 0);

  const [zoneRows] = await query(
    `
      SELECT
        z.id,
        z.zone_code AS zoneCode,
        z.display_name AS displayName,
        z.is_enabled AS isEnabled,
        z.seat_count AS seatCount,
        z.table_group_count AS tableGroupCount,
        COALESCE(seat_stats.availableSeatCount, 0) AS availableSeatCount,
        COUNT(r.id) AS reservationCount,
        COALESCE(SUM(r.duration_minutes), 0) AS reservedMinutes,
        COUNT(DISTINCT r.seat_id) AS usedSeatCount,
        SUM(CASE WHEN r.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInCount,
        SUM(CASE WHEN r.violation_type <> 'none' OR r.status IN ('no_show', 'violation') THEN 1 ELSE 0 END) AS violationCount
      FROM library_zone z
      LEFT JOIN (
        SELECT
          zone_id,
          SUM(CASE WHEN seat_status = 'available' THEN 1 ELSE 0 END) AS availableSeatCount
        FROM library_seat
        GROUP BY zone_id
      ) seat_stats ON seat_stats.zone_id = z.id
      LEFT JOIN seat_reservation r
        ON r.zone_id = z.id
        AND r.reservation_date BETWEEN ? AND ?
      GROUP BY z.id, z.zone_code, z.display_name, z.is_enabled, z.seat_count, z.table_group_count, seat_stats.availableSeatCount
      ORDER BY reservedMinutes DESC, reservationCount DESC, z.sort_order ASC, z.id ASC
    `,
    [range.startDateText, range.endDateText]
  );

  const [dailyRows] = await query(
    `
      SELECT
        reservation_date AS reservationDate,
        COUNT(*) AS reservationCount,
        COALESCE(SUM(duration_minutes), 0) AS reservedMinutes,
        SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInCount,
        SUM(CASE WHEN violation_type <> 'none' OR status IN ('no_show', 'violation') THEN 1 ELSE 0 END) AS violationCount
      FROM seat_reservation
      WHERE reservation_date BETWEEN ? AND ?
      GROUP BY reservation_date
      ORDER BY reservation_date ASC
    `,
    [range.startDateText, range.endDateText]
  );

  const [hourlyRows] = await query(
    `
      SELECT
        HOUR(start_time) AS hourNo,
        COUNT(*) AS reservationCount,
        COALESCE(SUM(duration_minutes), 0) AS reservedMinutes,
        SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInCount
      FROM seat_reservation
      WHERE reservation_date BETWEEN ? AND ?
      GROUP BY HOUR(start_time)
      ORDER BY hourNo ASC
    `,
    [range.startDateText, range.endDateText]
  );

  const [violationRows] = await query(
    `
      SELECT
        violation_type AS violationType,
        COUNT(*) AS count
      FROM seat_reservation
      WHERE reservation_date BETWEEN ? AND ?
        AND violation_type <> 'none'
      GROUP BY violation_type
      ORDER BY count DESC, violationType ASC
    `,
    [range.startDateText, range.endDateText]
  );

  const [topReaderRows] = await query(
    `
      SELECT
        u.student_no AS studentNo,
        u.real_name AS realName,
        COUNT(r.id) AS reservationCount,
        COALESCE(SUM(r.duration_minutes), 0) AS reservedMinutes,
        SUM(CASE WHEN r.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedInCount,
        SUM(CASE WHEN r.violation_type <> 'none' OR r.status IN ('no_show', 'violation') THEN 1 ELSE 0 END) AS violationCount
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      WHERE r.reservation_date BETWEEN ? AND ?
      GROUP BY u.id, u.student_no, u.real_name
      ORDER BY reservationCount DESC, reservedMinutes DESC, u.id ASC
      LIMIT 8
    `,
    [range.startDateText, range.endDateText]
  );

  const dailyUsageMap = new Map(
    dailyRows.map((row) => [
      formatDate(row.reservationDate),
      {
        reservationCount: Number(row.reservationCount || 0),
        reservedMinutes: Number(row.reservedMinutes || 0),
        checkedInCount: Number(row.checkedInCount || 0),
        violationCount: Number(row.violationCount || 0)
      }
    ])
  );

  const dailyUsage = buildDateList(range.startDate, range.endDate).map((dateKey) => {
    const row = dailyUsageMap.get(dateKey) || {
      reservationCount: 0,
      reservedMinutes: 0,
      checkedInCount: 0,
      violationCount: 0
    };

    return {
      reservationDate: dateKey,
      reservationCount: row.reservationCount,
      reservedMinutes: row.reservedMinutes,
      checkedInCount: row.checkedInCount,
      violationCount: row.violationCount,
      checkinRate: calcPercent(row.checkedInCount, row.reservationCount),
      seatUsageRate: calcPercent(row.reservedMinutes, operationalSeatCount * openMinutesPerDay)
    };
  });

  const hourlyUsageMap = new Map(
    hourlyRows.map((row) => [
      Number(row.hourNo),
      {
        reservationCount: Number(row.reservationCount || 0),
        reservedMinutes: Number(row.reservedMinutes || 0),
        checkedInCount: Number(row.checkedInCount || 0)
      }
    ])
  );

  const hourlyUsage = hourBuckets.map((bucket) => {
    const row = hourlyUsageMap.get(bucket.hour) || {
      reservationCount: 0,
      reservedMinutes: 0,
      checkedInCount: 0
    };

    return {
      hour: bucket.hour,
      label: bucket.label,
      reservationCount: row.reservationCount,
      reservedMinutes: row.reservedMinutes,
      checkedInCount: row.checkedInCount,
      checkinRate: calcPercent(row.checkedInCount, row.reservationCount)
    };
  });

  const zoneUsage = zoneRows.map((row) => {
    const availableSeatCount = Number(row.availableSeatCount || 0) || Number(row.seatCount || 0);
    const reservedMinutes = Number(row.reservedMinutes || 0);
    const reservationCount = Number(row.reservationCount || 0);
    const checkedInCount = Number(row.checkedInCount || 0);
    const violationCount = Number(row.violationCount || 0);

    return {
      zoneCode: row.zoneCode,
      displayName: row.displayName,
      isEnabled: Boolean(row.isEnabled),
      seatCount: Number(row.seatCount || 0),
      tableGroupCount: Number(row.tableGroupCount || 0),
      availableSeatCount,
      usedSeatCount: Number(row.usedSeatCount || 0),
      reservationCount,
      reservedMinutes,
      reservedHours: Number((reservedMinutes / 60).toFixed(1)),
      avgDurationMinutes: reservationCount > 0 ? Number((reservedMinutes / reservationCount).toFixed(1)) : 0,
      checkinRate: calcPercent(checkedInCount, reservationCount),
      violationRate: calcPercent(violationCount, reservationCount),
      seatUsageRate: calcPercent(reservedMinutes, availableSeatCount * openMinutesPerDay * range.daySpan)
    };
  });

  const topReaders = topReaderRows.map((row) => {
    const reservationCount = Number(row.reservationCount || 0);
    const checkedInCount = Number(row.checkedInCount || 0);
    const violationCount = Number(row.violationCount || 0);
    const reservedMinutes = Number(row.reservedMinutes || 0);

    return {
      studentNo: row.studentNo,
      realName: row.realName,
      reservationCount,
      reservedMinutes,
      reservedHours: Number((reservedMinutes / 60).toFixed(1)),
      checkedInCount,
      violationCount,
      checkinRate: calcPercent(checkedInCount, reservationCount),
      violationRate: calcPercent(violationCount, reservationCount)
    };
  });

  return {
    meta: {
      startDate: range.startDateText,
      endDate: range.endDateText,
      daySpan: range.daySpan,
      generatedAt: formatDateTime(new Date()),
      openTime: resolvedRules.openTime,
      closeTime: resolvedRules.closeTime,
      operationalSeatCount,
      totalSeatCount
    },
    overview: {
      totalReservations,
      checkedInReservations,
      completedReservations,
      activeReservations,
      violationReservations,
      totalReservedMinutes,
      totalReservedHours: Number((totalReservedMinutes / 60).toFixed(1)),
      avgDurationMinutes: totalReservations > 0 ? Number((totalReservedMinutes / totalReservations).toFixed(1)) : 0,
      checkinRate: calcPercent(checkedInReservations, totalReservations),
      violationRate: calcPercent(violationReservations, totalReservations),
      seatUsageRate: calcPercent(totalReservedMinutes, periodCapacityMinutes)
    },
    zoneUsage,
    dailyUsage,
    hourlyUsage,
    violationStats: violationRows.map((row) => ({
      violationType: row.violationType,
      count: Number(row.count || 0)
    })),
    topReaders
  };
}

async function listAdminNotices(studentNo, filters = {}) {
  await assertAdminUser(studentNo);

  const conditions = [];
  const params = [];
  const keyword = buildLikeKeyword(filters.keyword);
  const status = String(filters.status || "").trim();
  const audience = String(filters.audience || "").trim();
  const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 20, 100));

  if (status && NOTICE_STATUSES.has(status)) {
    conditions.push("n.status = ?");
    params.push(status);
  }

  if (audience && NOTICE_AUDIENCES.has(audience)) {
    conditions.push("n.audience = ?");
    params.push(audience);
  }

  if (keyword) {
    conditions.push("(n.title LIKE ? OR n.content LIKE ?)");
    params.push(keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await query(
    `
      SELECT
        n.id,
        n.title,
        n.content,
        n.notice_type AS noticeType,
        n.audience,
        n.status,
        n.publish_at AS publishAt,
        n.expire_at AS expireAt,
        n.created_at AS createdAt,
        n.updated_at AS updatedAt,
        creator.real_name AS createdBy,
        updater.real_name AS updatedBy
      FROM system_notice n
      INNER JOIN app_user creator ON n.created_by = creator.id
      LEFT JOIN app_user updater ON n.updated_by = updater.id
      ${whereClause}
      ORDER BY n.updated_at DESC, n.id DESC
      LIMIT ${safeLimit}
    `,
    params
  );

  return {
    items: rows.map(mapNoticeRow)
  };
}

async function getNoticeById(connection, noticeId) {
  const [rows] = await connection.execute(
    `
      SELECT
        n.id,
        n.title,
        n.content,
        n.notice_type AS noticeType,
        n.audience,
        n.status,
        n.publish_at AS publishAt,
        n.expire_at AS expireAt,
        n.created_at AS createdAt,
        n.updated_at AS updatedAt,
        creator.real_name AS createdBy,
        updater.real_name AS updatedBy
      FROM system_notice n
      INNER JOIN app_user creator ON n.created_by = creator.id
      LEFT JOIN app_user updater ON n.updated_by = updater.id
      WHERE n.id = ?
      LIMIT 1
    `,
    [noticeId]
  );

  return rows[0] || null;
}

function normalizeNoticePayload(input) {
  const title = requireValue(input.title, "请输入公告标题", "NOTICE_TITLE_REQUIRED");
  const content = requireValue(input.content, "请输入公告内容", "NOTICE_CONTENT_REQUIRED");
  const noticeType = String(input.noticeType || "system").trim();
  const audience = String(input.audience || "all").trim();
  const status = String(input.status || "draft").trim();

  if (!NOTICE_TYPES.has(noticeType)) {
    throw buildError("公告类型不合法", 400, "NOTICE_TYPE_INVALID");
  }

  if (!NOTICE_AUDIENCES.has(audience)) {
    throw buildError("公告受众不合法", 400, "NOTICE_AUDIENCE_INVALID");
  }

  if (!NOTICE_STATUSES.has(status)) {
    throw buildError("公告状态不合法", 400, "NOTICE_STATUS_INVALID");
  }

  return {
    title,
    content,
    noticeType,
    audience,
    status,
    publishAt: normalizeNoticeDateTime(input.publishAt),
    expireAt: normalizeNoticeDateTime(input.expireAt)
  };
}

async function createAdminNotice(studentNo, input) {
  const admin = await assertAdminUser(studentNo);
  const payload = normalizeNoticePayload(input);
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const effectivePublishAt =
      payload.status === "published" ? payload.publishAt || formatDateTime(new Date()) : payload.publishAt;

    const [insertResult] = await connection.execute(
      `
        INSERT INTO system_notice (
          title,
          content,
          notice_type,
          audience,
          status,
          publish_at,
          expire_at,
          created_by,
          updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.title,
        payload.content,
        payload.noticeType,
        payload.audience,
        payload.status,
        effectivePublishAt,
        payload.expireAt,
        admin.id,
        admin.id
      ]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "notice",
      actionType: "create",
      targetType: "system_notice",
      targetId: String(insertResult.insertId),
      actionDetail: {
        title: payload.title,
        status: payload.status,
        audience: payload.audience
      }
    });

    await connection.commit();

    const notice = await getNoticeById(connection, insertResult.insertId);
    return {
      message: payload.status === "published" ? "公告已发布" : "公告已保存",
      notice: mapNoticeRow(notice)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdminNotice(studentNo, noticeId, input) {
  const admin = await assertAdminUser(studentNo);
  const payload = normalizeNoticePayload(input);
  const normalizedNoticeId = Number(noticeId);

  if (!Number.isInteger(normalizedNoticeId) || normalizedNoticeId <= 0) {
    throw buildError("公告 ID 不合法", 400, "NOTICE_ID_INVALID");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT id, status, publish_at AS publishAt
        FROM system_notice
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedNoticeId]
    );

    const currentNotice = rows[0];
    if (!currentNotice) {
      throw buildError("未找到对应公告", 404, "NOTICE_NOT_FOUND");
    }

    const effectivePublishAt =
      payload.status === "published"
        ? payload.publishAt || formatDateTime(currentNotice.publishAt || new Date())
        : payload.publishAt;

    await connection.execute(
      `
        UPDATE system_notice
        SET
          title = ?,
          content = ?,
          notice_type = ?,
          audience = ?,
          status = ?,
          publish_at = ?,
          expire_at = ?,
          updated_by = ?
        WHERE id = ?
      `,
      [
        payload.title,
        payload.content,
        payload.noticeType,
        payload.audience,
        payload.status,
        effectivePublishAt,
        payload.expireAt,
        admin.id,
        normalizedNoticeId
      ]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "notice",
      actionType: "update",
      targetType: "system_notice",
      targetId: String(normalizedNoticeId),
      actionDetail: {
        title: payload.title,
        status: payload.status,
        audience: payload.audience
      }
    });

    await connection.commit();

    const notice = await getNoticeById(connection, normalizedNoticeId);
    return {
      message: "公告已更新",
      notice: mapNoticeRow(notice)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdminNoticeStatus(studentNo, noticeId, status) {
  const admin = await assertAdminUser(studentNo);
  const normalizedNoticeId = Number(noticeId);
  const nextStatus = String(status || "").trim();

  if (!Number.isInteger(normalizedNoticeId) || normalizedNoticeId <= 0) {
    throw buildError("公告 ID 不合法", 400, "NOTICE_ID_INVALID");
  }

  if (!NOTICE_STATUSES.has(nextStatus)) {
    throw buildError("公告状态不合法", 400, "NOTICE_STATUS_INVALID");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT id, title, status, publish_at AS publishAt
        FROM system_notice
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedNoticeId]
    );

    const notice = rows[0];
    if (!notice) {
      throw buildError("未找到对应公告", 404, "NOTICE_NOT_FOUND");
    }

    await connection.execute(
      `
        UPDATE system_notice
        SET
          status = ?,
          publish_at = CASE
            WHEN ? = 'published' THEN COALESCE(publish_at, NOW())
            ELSE publish_at
          END,
          updated_by = ?
        WHERE id = ?
      `,
      [nextStatus, nextStatus, admin.id, normalizedNoticeId]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "notice",
      actionType: "status_change",
      targetType: "system_notice",
      targetId: String(normalizedNoticeId),
      actionDetail: {
        title: notice.title,
        fromStatus: notice.status,
        toStatus: nextStatus
      }
    });

    await connection.commit();

    const latestNotice = await getNoticeById(connection, normalizedNoticeId);
    return {
      message: "公告状态已更新",
      notice: mapNoticeRow(latestNotice)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listAdminReservations(studentNo, filters = {}) {
  await assertAdminUser(studentNo);

  const conditions = [];
  const params = [];
  const keyword = buildLikeKeyword(filters.keyword);
  const status = String(filters.status || "").trim();
  const reservationDate = String(filters.reservationDate || "").trim();
  const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 50, 100));

  if (status && RESERVATION_STATUSES.has(status)) {
    conditions.push("r.status = ?");
    params.push(status);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(reservationDate)) {
    conditions.push("r.reservation_date = ?");
    params.push(reservationDate);
  }

  if (keyword) {
    conditions.push(
      "(r.reservation_no LIKE ? OR u.student_no LIKE ? OR u.real_name LIKE ? OR s.seat_code LIKE ? OR z.zone_code LIKE ?)"
    );
    params.push(keyword, keyword, keyword, keyword, keyword);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await query(
    `
      SELECT
        r.reservation_no AS reservationNo,
        u.student_no AS studentNo,
        u.real_name AS realName,
        s.seat_code AS seatId,
        z.zone_code AS zoneCode,
        r.reservation_date AS reservationDate,
        r.start_time AS startTime,
        r.end_time AS endTime,
        r.status,
        r.violation_type AS violationType,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt,
        r.created_at AS createdAt
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      INNER JOIN library_seat s ON r.seat_id = s.id
      INNER JOIN library_zone z ON r.zone_id = z.id
      ${whereClause}
      ORDER BY r.reservation_date DESC, r.start_time DESC, r.id DESC
      LIMIT ${safeLimit}
    `,
    params
  );

  const [summaryRows] = await query(
    `
      SELECT
        r.status AS status,
        COUNT(*) AS count
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      INNER JOIN library_seat s ON r.seat_id = s.id
      INNER JOIN library_zone z ON r.zone_id = z.id
      ${whereClause}
      GROUP BY r.status
      ORDER BY count DESC, r.status ASC
    `,
    params
  );

  return {
    items: rows.map(mapReservationRow),
    summary: summaryRows.map((row) => ({
      status: row.status,
      count: Number(row.count || 0)
    }))
  };
}

async function manualCheckoutAdminReservation(studentNo, reservationNo, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const normalizedReservationNo = requireValue(
    reservationNo,
    "璇疯緭鍏ラ绾﹀彿",
    "RESERVATION_NO_REQUIRED"
  );
  const reason = requireValue(
    input.reason,
    "璇疯緭鍏ュ綋鍓嶄唬绛鹃€€鐨勫師鍥?",
    "ADMIN_CHECKOUT_REASON_REQUIRED"
  );
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const reservation = await getReservationByNoForAdminAction(connection, normalizedReservationNo);
    if (!reservation) {
      throw buildError("鏈壘鍒板搴旈绾﹁褰?", 404, "RESERVATION_NOT_FOUND");
    }

    if (!ADMIN_CHECKOUTABLE_RESERVATION_STATUSES.has(reservation.status)) {
      throw buildError("褰撳墠棰勭害鐘舵€佷笉鏀寔绠＄悊鍛樹唬绛鹃€€", 400, "ADMIN_CHECKOUT_NOT_ALLOWED");
    }

    const now = new Date();
    const checkinRecord = await getReservationCheckinRecord(connection, reservation.id);
    const openLeave = reservation.status === "temporary_leave"
      ? await getOpenLeaveRecord(connection, reservation.id)
      : null;
    const extraLeaveMinutes = await closeOpenLeaveRecord(connection, openLeave, now);
    const usageSummary = buildReservationUsageSummary(checkinRecord, now, extraLeaveMinutes);

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'completed',
          checkout_at = ?
        WHERE id = ?
      `,
      [formatDateTime(now), reservation.id]
    );

    await upsertReservationCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: checkinRecord ? null : "admin",
      firstCheckinAt: buildReservationFirstCheckinAt(checkinRecord, now),
      checkoutType: "admin",
      checkoutAt: formatDateTime(now),
      leaveCount: Number(checkinRecord && checkinRecord.leaveCount || 0),
      totalLeaveMinutes: usageSummary.totalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord && checkinRecord.lastLeaveStartedAt
        ? formatDateTime(checkinRecord.lastLeaveStartedAt)
        : null,
      lastReturnedAt: formatDateTime(now),
      actualUsageMinutes: usageSummary.actualUsageMinutes,
      finalResult: "completed"
    });

    await deleteReservationSlots(connection, reservation.id);
    await appendReservationRemark(connection, reservation.id, `[admin_checkout] ${reason}`);

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "reservation",
      actionType: "manual_checkout",
      targetType: "seat_reservation",
      targetId: normalizedReservationNo,
      actionDetail: {
        reservationNo: normalizedReservationNo,
        studentNo: reservation.studentNo,
        seatId: reservation.seatId,
        previousStatus: reservation.status,
        nextStatus: "completed",
        reason
      }
    });

    await connection.commit();

    return {
      message: "绠＄悊鍛樹唬绛鹃€€鎴愬姛",
      reservation: {
        reservationNo: normalizedReservationNo,
        status: "completed",
        checkoutAt: formatDateTime(now)
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function applyAdminReleasePenalty(connection, admin, reservation, rules) {
  const delta = Number(rules && rules.penalties && rules.penalties.severe || 0);
  if (!Number.isFinite(delta) || delta <= 0) {
    return null;
  }

  const activeRules = rules || {
    blacklistCreditThreshold: 60,
    blacklistDays: 7
  };

  const [rows] = await connection.execute(
    `
      SELECT
        id,
        credit_score AS creditScore,
        violation_count AS violationCount
      FROM app_user
      WHERE id = ?
      FOR UPDATE
    `,
    [reservation.userId]
  );

  const targetUser = rows[0];
  if (!targetUser) {
    return null;
  }

  const before = Number(targetUser.creditScore || 0);
  const after = clamp(before - delta, 0, 100);
  const shouldBlacklist = after < activeRules.blacklistCreditThreshold;
  const blacklistUntil = shouldBlacklist ? formatDateTime(addDays(new Date(), activeRules.blacklistDays)) : null;

  await connection.execute(
    `
      UPDATE app_user
      SET
        credit_score = ?,
        violation_count = violation_count + 1,
        is_blacklisted = ?,
        blacklist_until = ?
      WHERE id = ?
    `,
    [after, shouldBlacklist ? 1 : 0, blacklistUntil, reservation.userId]
  );

  await connection.execute(
    `
      INSERT INTO user_credit_log (
        user_id,
        reservation_id,
        operator_user_id,
        change_type,
        change_reason,
        score_delta,
        score_before,
        score_after
      ) VALUES (?, ?, ?, 'penalty', ?, ?, ?, ?)
    `,
    [reservation.userId, reservation.id, admin.id, "管理员释放预约", -delta, before, after]
  );

  return {
    before,
    after,
    delta: -delta,
    blacklisted: shouldBlacklist
  };
}

async function releaseAdminReservation(studentNo, reservationNo, input = {}, rules = null) {
  const admin = await assertAdminUser(studentNo);
  const normalizedReservationNo = requireValue(
    reservationNo,
    "璇疯緭鍏ラ绾﹀彿",
    "RESERVATION_NO_REQUIRED"
  );
  const reason = requireValue(
    input.reason,
    "璇疯緭鍏ラ噴鏀鹃绾︾殑鍘熷洜",
    "ADMIN_RELEASE_REASON_REQUIRED"
  );
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const reservation = await getReservationByNoForAdminAction(connection, normalizedReservationNo);
    if (!reservation) {
      throw buildError("鏈壘鍒板搴旈绾﹁褰?", 404, "RESERVATION_NOT_FOUND");
    }

    if (!ADMIN_RELEASEABLE_RESERVATION_STATUSES.has(reservation.status)) {
      throw buildError("褰撳墠棰勭害鐘舵€佷笉鏀寔绠＄悊鍛樿噰鍙栭噴鏀炬搷浣?", 400, "ADMIN_RELEASE_NOT_ALLOWED");
    }

    const now = new Date();
    const checkinRecord = await getReservationCheckinRecord(connection, reservation.id);
    const openLeave = reservation.status === "temporary_leave"
      ? await getOpenLeaveRecord(connection, reservation.id)
      : null;
    const extraLeaveMinutes = await closeOpenLeaveRecord(connection, openLeave, now);
    const usageSummary = buildReservationUsageSummary(
      checkinRecord,
      now,
      reservation.status === "reserved" ? 0 : extraLeaveMinutes
    );

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'admin_released',
          checkout_at = ?,
          violation_type = 'manual_penalty',
          violation_at = ?
        WHERE id = ?
      `,
      [formatDateTime(now), formatDateTime(now), reservation.id]
    );

    await upsertReservationCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: checkinRecord ? null : (reservation.status === "reserved" ? null : "admin"),
      firstCheckinAt:
        reservation.status === "reserved"
          ? null
          : buildReservationFirstCheckinAt(checkinRecord, now),
      checkoutType: "admin",
      checkoutAt: formatDateTime(now),
      leaveCount: Number(checkinRecord && checkinRecord.leaveCount || 0),
      totalLeaveMinutes: reservation.status === "reserved" ? 0 : usageSummary.totalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord && checkinRecord.lastLeaveStartedAt
        ? formatDateTime(checkinRecord.lastLeaveStartedAt)
        : null,
      lastReturnedAt: reservation.status === "temporary_leave" ? formatDateTime(now) : (
        checkinRecord && checkinRecord.lastReturnedAt
          ? formatDateTime(checkinRecord.lastReturnedAt)
          : null
      ),
      actualUsageMinutes: reservation.status === "reserved" ? 0 : usageSummary.actualUsageMinutes,
      finalResult: "admin_released"
    });

    await deleteReservationSlots(connection, reservation.id);
    await appendReservationRemark(connection, reservation.id, `[admin_release] ${reason}`);
    const penaltyResult = await applyAdminReleasePenalty(connection, admin, reservation, rules);

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "reservation",
      actionType: "admin_release",
      targetType: "seat_reservation",
      targetId: normalizedReservationNo,
      actionDetail: {
        reservationNo: normalizedReservationNo,
        studentNo: reservation.studentNo,
        seatId: reservation.seatId,
        previousStatus: reservation.status,
        nextStatus: "admin_released",
        reason,
        penalty: penaltyResult
      }
    });

    await connection.commit();

    return {
      message: "棰勭害宸茶绠＄悊鍛橀噴鏀?",
      reservation: {
        reservationNo: normalizedReservationNo,
        status: "admin_released",
        checkoutAt: formatDateTime(now)
      },
      penalty: penaltyResult
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listAdminUsers(studentNo, filters = {}) {
  await assertAdminUser(studentNo);

  const conditions = ["1 = 1"];
  const params = [];
  const keyword = buildLikeKeyword(filters.keyword);
  const blacklistOnly = String(filters.blacklistOnly || "").trim();
  const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 50, 100));

  if (keyword) {
    conditions.push("(u.student_no LIKE ? OR u.real_name LIKE ? OR u.role LIKE ?)");
    params.push(keyword, keyword, keyword);
  }

  if (blacklistOnly === "true") {
    conditions.push("u.is_blacklisted = 1");
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const [rows] = await query(
    `
      SELECT
        u.student_no AS studentNo,
        u.real_name AS realName,
        u.role,
        u.status,
        u.credit_score AS creditScore,
        u.violation_count AS violationCount,
        u.is_blacklisted AS isBlacklisted,
        u.blacklist_until AS blacklistUntil,
        u.last_login_at AS lastLoginAt,
        COUNT(r.id) AS totalReservations,
        SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completedReservations
      FROM app_user u
      LEFT JOIN seat_reservation r ON r.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.is_blacklisted DESC, u.credit_score ASC, u.id DESC
      LIMIT ${safeLimit}
    `,
    params
  );

  return {
    items: rows.map(mapUserListRow)
  };
}

async function adjustAdminUserCredit(studentNo, targetStudentNo, input, rules) {
  const admin = await assertAdminUser(studentNo);
  const targetNo = requireValue(targetStudentNo, "请输入目标学号", "TARGET_STUDENT_NO_REQUIRED");
  const reason = requireValue(input.reason, "请输入调整原因", "CREDIT_REASON_REQUIRED");
  const delta = Number(input.delta);
  const activeRules = rules || {
    blacklistCreditThreshold: 60,
    blacklistDays: 7
  };

  if (!Number.isInteger(delta) || delta === 0) {
    throw buildError("调整分值必须是非 0 整数", 400, "CREDIT_DELTA_INVALID");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT
          id,
          student_no AS studentNo,
          real_name AS realName,
          role,
          status,
          credit_score AS creditScore,
          violation_count AS violationCount,
          is_blacklisted AS isBlacklisted,
          blacklist_until AS blacklistUntil,
          last_login_at AS lastLoginAt
        FROM app_user
        WHERE student_no = ?
        LIMIT 1
        FOR UPDATE
      `,
      [targetNo]
    );

    const targetUser = rows[0];
    if (!targetUser) {
      throw buildError("未找到目标用户", 404, "TARGET_USER_NOT_FOUND");
    }

    const before = Number(targetUser.creditScore || 0);
    const after = clamp(before + delta, 0, 100);
    const shouldBlacklist = after < activeRules.blacklistCreditThreshold;
    const blacklistUntil = shouldBlacklist ? formatDateTime(addDays(new Date(), activeRules.blacklistDays)) : null;

    await connection.execute(
      `
        UPDATE app_user
        SET
          credit_score = ?,
          is_blacklisted = ?,
          blacklist_until = ?
        WHERE id = ?
      `,
      [after, shouldBlacklist ? 1 : 0, blacklistUntil, targetUser.id]
    );

    await connection.execute(
      `
        INSERT INTO user_credit_log (
          user_id,
          operator_user_id,
          change_type,
          change_reason,
          score_delta,
          score_before,
          score_after
        ) VALUES (?, ?, 'manual_adjust', ?, ?, ?, ?)
      `,
      [targetUser.id, admin.id, reason, delta, before, after]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "credit",
      actionType: "manual_adjust",
      targetType: "app_user",
      targetId: targetUser.studentNo,
      actionDetail: {
        reason,
        scoreBefore: before,
        scoreAfter: after,
        delta
      }
    });

    await connection.commit();

    const latestUser = await findUserByStudentNo(targetNo);

    return {
      message: "信用分调整成功",
      user: mapAdminUserRow(latestUser || targetUser),
      delta
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getZoneForUpdate(connection, zoneCode) {
  const [rows] = await connection.execute(
    `
      SELECT
        id,
        zone_code AS zoneCode,
        display_name AS displayName,
        floor_no AS floorNo,
        grid_letter AS gridLetter,
        grid_number AS gridNumber,
        zone_band AS band,
        seat_count AS seatCount,
        table_group_count AS tableGroupCount,
        annotation_status AS annotationStatus,
        sort_order AS sortOrder,
        is_enabled AS isEnabled,
        notes,
        updated_at AS updatedAt
      FROM library_zone
      WHERE zone_code = ?
      LIMIT 1
      FOR UPDATE
    `,
    [zoneCode]
  );

  return rows[0] || null;
}

async function getSeatForUpdate(connection, seatCode) {
  const [rows] = await connection.execute(
    `
      SELECT
        s.id,
        s.seat_code AS seatCode,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        s.floor_no AS floorNo,
        s.table_code AS tableCode,
        s.table_group_code AS tableGroupCode,
        s.seat_seq AS seatSeq,
        s.seat_seq_label AS seatSeqLabel,
        s.seat_type AS seatType,
        s.seat_status AS seatStatus,
        s.seat_capacity AS seatCapacity,
        s.has_power AS hasPower,
        s.near_window AS nearWindow,
        s.quiet_level AS quietLevel,
        s.near_restroom AS nearRestroom,
        s.near_pantry AS nearPantry,
        s.near_ac AS nearAC,
        s.near_bookshelf AS nearBookshelf,
        s.near_corridor AS nearCorridor,
        s.sunlight AS sunlight,
        s.specific_location AS specificLocation,
        s.sort_order AS sortOrder,
        s.updated_at AS updatedAt,
        z.id AS zoneId
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      WHERE s.seat_code = ?
      LIMIT 1
      FOR UPDATE
    `,
    [seatCode]
  );

  return rows[0] || null;
}

async function getZoneByCode(connection, zoneCode) {
  const [rows] = await connection.execute(
    `
      SELECT
        id,
        zone_code AS zoneCode,
        display_name AS displayName,
        floor_no AS floorNo,
        grid_letter AS gridLetter,
        grid_number AS gridNumber,
        zone_band AS band,
        seat_count AS seatCount,
        table_group_count AS tableGroupCount,
        annotation_status AS annotationStatus,
        sort_order AS sortOrder,
        is_enabled AS isEnabled,
        notes,
        updated_at AS updatedAt
      FROM library_zone
      WHERE zone_code = ?
      LIMIT 1
    `,
    [zoneCode]
  );

  return rows[0] || null;
}

async function getSeatByCode(connection, seatCode) {
  const [rows] = await connection.execute(
    `
      SELECT
        s.id,
        s.seat_code AS seatCode,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        s.floor_no AS floorNo,
        s.table_code AS tableCode,
        s.table_group_code AS tableGroupCode,
        s.seat_seq AS seatSeq,
        s.seat_seq_label AS seatSeqLabel,
        s.seat_type AS seatType,
        s.seat_status AS seatStatus,
        s.seat_capacity AS seatCapacity,
        s.has_power AS hasPower,
        s.near_window AS nearWindow,
        s.quiet_level AS quietLevel,
        s.near_restroom AS nearRestroom,
        s.near_pantry AS nearPantry,
        s.near_ac AS nearAC,
        s.near_bookshelf AS nearBookshelf,
        s.near_corridor AS nearCorridor,
        s.sunlight AS sunlight,
        s.specific_location AS specificLocation,
        s.sort_order AS sortOrder,
        s.updated_at AS updatedAt
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      WHERE s.seat_code = ?
      LIMIT 1
    `,
    [seatCode]
  );

  return rows[0] || null;
}

function normalizeZonePayload(input = {}, options = {}) {
  const allowOptionalCode = Boolean(options.allowOptionalCode);
  const zoneCode = allowOptionalCode
    ? normalizeOptionalText(input.zoneCode, 16)
    : requireValue(input.zoneCode, "请输入分区编码", "ZONE_CODE_REQUIRED");
  const normalizedZoneCode = zoneCode ? zoneCode.toUpperCase() : "";
  const displayName = requireValue(input.displayName, "请输入分区名称", "ZONE_DISPLAY_NAME_REQUIRED");
  const gridLetter = requireValue(input.gridLetter, "请输入网格字母", "ZONE_GRID_LETTER_REQUIRED").toUpperCase();
  const gridNumber = normalizeIntegerValue(input.gridNumber, {
    requiredMessage: "请输入网格数字",
    requiredCode: "ZONE_GRID_NUMBER_REQUIRED",
    invalidMessage: "网格数字必须是大于 0 的整数",
    invalidCode: "ZONE_GRID_NUMBER_INVALID",
    min: 1,
    max: 999
  });
  const floorNo = normalizeIntegerValue(input.floorNo, {
    requiredMessage: "请输入楼层号",
    requiredCode: "ZONE_FLOOR_REQUIRED",
    invalidMessage: "楼层号必须是 1-99 的整数",
    invalidCode: "ZONE_FLOOR_INVALID",
    min: 1,
    max: 99
  });
  const band = requireValue(input.band, "请选择分区方向带", "ZONE_BAND_REQUIRED");
  const annotationStatus = String(input.annotationStatus || "pending").trim() || "pending";
  const sortOrder = normalizeIntegerValue(input.sortOrder, {
    fallback: 0,
    invalidMessage: "分区排序必须是整数",
    invalidCode: "ZONE_SORT_ORDER_INVALID"
  });
  const isEnabled = normalizeBoolean(input.isEnabled, true);
  const notes = normalizeOptionalText(input.notes);

  if (!allowOptionalCode && !/^[A-Z][A-Z0-9]{0,15}$/.test(normalizedZoneCode)) {
    throw buildError("分区编码建议使用大写字母或数字，例如 Q3、Q12", 400, "ZONE_CODE_INVALID");
  }

  if (!ZONE_BANDS.has(band)) {
    throw buildError("分区方向带不合法", 400, "ZONE_BAND_INVALID");
  }

  if (!ZONE_ANNOTATION_STATUSES.has(annotationStatus)) {
    throw buildError("分区标注状态不合法", 400, "ZONE_ANNOTATION_STATUS_INVALID");
  }

  return {
    zoneCode: normalizedZoneCode,
    displayName,
    floorNo,
    gridLetter,
    gridNumber,
    band,
    annotationStatus,
    sortOrder,
    isEnabled,
    notes
  };
}

function normalizeSeatPayload(input = {}, options = {}) {
  const allowOptionalSeatCode = Boolean(options.allowOptionalSeatCode);
  const allowOptionalZoneCode = Boolean(options.allowOptionalZoneCode);
  const seatCode = allowOptionalSeatCode
    ? normalizeOptionalText(input.seatCode, 32)
    : requireValue(input.seatCode, "请输入座位编号", "SEAT_CODE_REQUIRED");
  const zoneCode = allowOptionalZoneCode
    ? normalizeOptionalText(input.zoneCode, 16)
    : requireValue(input.zoneCode, "请选择所属分区", "SEAT_ZONE_REQUIRED");
  const normalizedSeatCode = seatCode ? seatCode.toUpperCase() : "";
  const normalizedZoneCode = zoneCode ? zoneCode.toUpperCase() : "";
  const tableCode = requireValue(input.tableCode, "请输入桌组编号", "SEAT_TABLE_CODE_REQUIRED").toUpperCase();
  const seatSeq = normalizeIntegerValue(input.seatSeq, {
    requiredMessage: "请输入桌组内座位序号",
    requiredCode: "SEAT_SEQ_REQUIRED",
    invalidMessage: "桌组内座位序号必须是大于 0 的整数",
    invalidCode: "SEAT_SEQ_INVALID",
    min: 1,
    max: 999
  });
  const seatType = requireValue(input.seatType, "请输入座位类型", "SEAT_TYPE_REQUIRED");
  const seatCapacity = normalizeIntegerValue(input.seatCapacity, {
    requiredMessage: "请输入座位容量",
    requiredCode: "SEAT_CAPACITY_REQUIRED",
    invalidMessage: "座位容量必须是 1-20 的整数",
    invalidCode: "SEAT_CAPACITY_INVALID",
    min: 1,
    max: 20
  });
  const seatStatus = String(input.seatStatus || "available").trim() || "available";
  const quietLevel = String(input.quietLevel || "一般").trim() || "一般";
  const sortOrder = normalizeIntegerValue(input.sortOrder, {
    fallback: seatSeq,
    invalidMessage: "座位排序必须是整数",
    invalidCode: "SEAT_SORT_ORDER_INVALID"
  });
  const hasPower = normalizeBoolean(input.hasPower, false);
  const nearWindow = normalizeBoolean(input.nearWindow, false);
  const specificLocation = normalizeOptionalText(input.specificLocation);

  if (!allowOptionalSeatCode && !/^[A-Z0-9-]{2,32}$/.test(normalizedSeatCode)) {
    throw buildError("座位编号格式不正确，建议使用大写字母、数字和中划线", 400, "SEAT_CODE_INVALID");
  }

  if (!allowOptionalZoneCode && !normalizedZoneCode) {
    throw buildError("请选择所属分区", 400, "SEAT_ZONE_REQUIRED");
  }

  if (!SEAT_STATIC_STATUSES.has(seatStatus)) {
    throw buildError("座位静态状态不合法", 400, "SEAT_STATUS_INVALID");
  }

  if (!SEAT_QUIET_LEVELS.has(quietLevel)) {
    throw buildError("安静等级不合法", 400, "SEAT_QUIET_LEVEL_INVALID");
  }

  return {
    seatCode: normalizedSeatCode,
    zoneCode: normalizedZoneCode,
    tableCode,
    seatSeq,
    seatSeqLabel: buildSeatSeqLabel(seatSeq),
    seatType,
    seatCapacity,
    seatStatus,
    hasPower,
    nearWindow,
    quietLevel,
    specificLocation,
    sortOrder
  };
}

async function recalcZoneSeatStats(connection, zoneId) {
  await connection.execute(
    `
      UPDATE library_zone z
      LEFT JOIN (
        SELECT
          zone_id,
          COUNT(*) AS seatCount,
          COUNT(DISTINCT table_group_code) AS tableGroupCount
        FROM library_seat
        WHERE zone_id = ?
        GROUP BY zone_id
      ) seat_stats ON seat_stats.zone_id = z.id
      SET
        z.seat_count = COALESCE(seat_stats.seatCount, 0),
        z.table_group_count = COALESCE(seat_stats.tableGroupCount, 0)
      WHERE z.id = ?
    `,
    [zoneId, zoneId]
  );
}

async function listAdminZones(studentNo) {
  await assertAdminUser(studentNo);

  const [rows] = await query(
    `
      SELECT
        id,
        zone_code AS zoneCode,
        display_name AS displayName,
        floor_no AS floorNo,
        grid_letter AS gridLetter,
        grid_number AS gridNumber,
        zone_band AS band,
        seat_count AS seatCount,
        table_group_count AS tableGroupCount,
        annotation_status AS annotationStatus,
        sort_order AS sortOrder,
        is_enabled AS isEnabled,
        notes,
        updated_at AS updatedAt
      FROM library_zone
      ORDER BY floor_no ASC, sort_order ASC, id ASC
    `
  );

  return {
    items: rows.map(mapZoneListRow)
  };
}

async function updateAdminZoneEnabled(studentNo, zoneCode, input) {
  const admin = await assertAdminUser(studentNo);
  const normalizedZoneCode = requireValue(zoneCode, "请输入分区编码", "ZONE_CODE_REQUIRED");
  const reason = requireValue(input.reason, "请输入分区状态调整原因", "ZONE_REASON_REQUIRED");
  const isEnabled = String(input.isEnabled).trim();

  if (!["true", "false", "1", "0"].includes(isEnabled)) {
    throw buildError("分区启用状态不合法", 400, "ZONE_ENABLED_INVALID");
  }

  const nextEnabled = isEnabled === "true" || isEnabled === "1";
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT
          id,
          zone_code AS zoneCode,
          display_name AS displayName,
          floor_no AS floorNo,
          grid_letter AS gridLetter,
          grid_number AS gridNumber,
          zone_band AS band,
          seat_count AS seatCount,
          table_group_count AS tableGroupCount,
          annotation_status AS annotationStatus,
          sort_order AS sortOrder,
          is_enabled AS isEnabled,
          notes,
          updated_at AS updatedAt
        FROM library_zone
        WHERE zone_code = ?
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedZoneCode]
    );

    const zone = rows[0];
    if (!zone) {
      throw buildError("未找到对应分区", 404, "ZONE_NOT_FOUND");
    }

    await connection.execute(
      `
        UPDATE library_zone
        SET is_enabled = ?
        WHERE id = ?
      `,
      [nextEnabled ? 1 : 0, zone.id]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "zone",
      actionType: nextEnabled ? "enable" : "disable",
      targetType: "library_zone",
      targetId: zone.zoneCode,
      actionDetail: {
        displayName: zone.displayName,
        reason,
        fromEnabled: Boolean(zone.isEnabled),
        toEnabled: nextEnabled
      }
    });

    await connection.commit();

    const [latestRows] = await connection.execute(
      `
        SELECT
          id,
          zone_code AS zoneCode,
          display_name AS displayName,
          floor_no AS floorNo,
          grid_letter AS gridLetter,
          grid_number AS gridNumber,
          zone_band AS band,
          seat_count AS seatCount,
          table_group_count AS tableGroupCount,
          annotation_status AS annotationStatus,
          sort_order AS sortOrder,
          is_enabled AS isEnabled,
          notes,
          updated_at AS updatedAt
        FROM library_zone
        WHERE id = ?
        LIMIT 1
      `,
      [zone.id]
    );

    return {
      message: nextEnabled ? "分区已启用" : "分区已停用",
      zone: mapZoneListRow(latestRows[0] || zone)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createAdminZone(studentNo, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const payload = normalizeZonePayload(input);
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const existingZone = await getZoneByCode(connection, payload.zoneCode);
    if (existingZone) {
      throw buildError("该分区编码已存在，请更换后再试", 409, "ZONE_CODE_DUPLICATED");
    }

    await connection.execute(
      `
        INSERT INTO library_zone (
          zone_code,
          floor_no,
          grid_letter,
          grid_number,
          zone_band,
          display_name,
          seat_count,
          table_group_count,
          annotation_status,
          sort_order,
          is_enabled,
          notes
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
      `,
      [
        payload.zoneCode,
        payload.floorNo,
        payload.gridLetter,
        payload.gridNumber,
        payload.band,
        payload.displayName,
        payload.annotationStatus,
        payload.sortOrder,
        payload.isEnabled ? 1 : 0,
        payload.notes
      ]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "zone",
      actionType: "create",
      targetType: "library_zone",
      targetId: payload.zoneCode,
      actionDetail: payload
    });

    await connection.commit();

    const latestZone = await getZoneByCode(connection, payload.zoneCode);
    return {
      message: "分区已创建",
      zone: mapZoneListRow(latestZone)
    };
  } catch (error) {
    await connection.rollback();

    if (error && error.code === "ER_DUP_ENTRY") {
      throw buildError("该分区编码已存在，请更换后再试", 409, "ZONE_CODE_DUPLICATED");
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdminZone(studentNo, zoneCode, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const normalizedZoneCode = requireValue(zoneCode, "请输入分区编码", "ZONE_CODE_REQUIRED").toUpperCase();
  const payload = normalizeZonePayload({
    ...input,
    zoneCode: normalizedZoneCode
  }, {
    allowOptionalCode: true
  });
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const zone = await getZoneForUpdate(connection, normalizedZoneCode);
    if (!zone) {
      throw buildError("未找到对应分区", 404, "ZONE_NOT_FOUND");
    }

    await connection.execute(
      `
        UPDATE library_zone
        SET
          display_name = ?,
          floor_no = ?,
          grid_letter = ?,
          grid_number = ?,
          zone_band = ?,
          annotation_status = ?,
          sort_order = ?,
          is_enabled = ?,
          notes = ?
        WHERE id = ?
      `,
      [
        payload.displayName,
        payload.floorNo,
        payload.gridLetter,
        payload.gridNumber,
        payload.band,
        payload.annotationStatus,
        payload.sortOrder,
        payload.isEnabled ? 1 : 0,
        payload.notes,
        zone.id
      ]
    );

    if (Number(zone.floorNo || 0) !== payload.floorNo) {
      await connection.execute(
        `
          UPDATE library_seat
          SET floor_no = ?
          WHERE zone_id = ?
        `,
        [payload.floorNo, zone.id]
      );
    }

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "zone",
      actionType: "update",
      targetType: "library_zone",
      targetId: normalizedZoneCode,
      actionDetail: {
        before: mapZoneListRow(zone),
        after: {
          ...payload,
          zoneCode: normalizedZoneCode
        }
      }
    });

    await connection.commit();

    const latestZone = await getZoneByCode(connection, normalizedZoneCode);
    return {
      message: "分区信息已更新",
      zone: mapZoneListRow(latestZone)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteAdminZone(studentNo, zoneCode, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const normalizedZoneCode = requireValue(zoneCode, "请输入分区编码", "ZONE_CODE_REQUIRED").toUpperCase();
  const reason = normalizeOptionalText(input.reason, 255) || "admin_delete_zone";
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const zone = await getZoneForUpdate(connection, normalizedZoneCode);
    if (!zone) {
      throw buildError("未找到对应分区", 404, "ZONE_NOT_FOUND");
    }

    const [seatRows] = await connection.execute(
      `
        SELECT COUNT(*) AS seatCount
        FROM library_seat
        WHERE zone_id = ?
      `,
      [zone.id]
    );

    if (Number(seatRows[0] && seatRows[0].seatCount || 0) > 0) {
      throw buildError("请先删除该分区下的全部座位，再删除分区", 400, "ZONE_HAS_SEATS");
    }

    const [reservationRows] = await connection.execute(
      `
        SELECT COUNT(*) AS reservationCount
        FROM seat_reservation
        WHERE zone_id = ?
      `,
      [zone.id]
    );

    if (Number(reservationRows[0] && reservationRows[0].reservationCount || 0) > 0) {
      throw buildError("该分区已有预约历史，暂不支持直接删除", 400, "ZONE_HAS_RESERVATIONS");
    }

    await connection.execute(
      `
        DELETE FROM library_zone
        WHERE id = ?
      `,
      [zone.id]
    );

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "zone",
      actionType: "delete",
      targetType: "library_zone",
      targetId: normalizedZoneCode,
      actionDetail: {
        reason,
        zone: mapZoneListRow(zone)
      }
    });

    await connection.commit();

    return {
      message: "分区已删除"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listAdminSeats(studentNo, filters = {}) {
  await assertAdminUser(studentNo);

  const conditions = [];
  const params = [];
  const keyword = buildLikeKeyword(filters.keyword);
  const zoneCode = String(filters.zoneCode || "").trim();
  const seatStatus = String(filters.seatStatus || "").trim();
  const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 3000, 5000));

  if (keyword) {
    conditions.push("(s.seat_code LIKE ? OR z.zone_code LIKE ? OR z.display_name LIKE ?)");
    params.push(keyword, keyword, keyword);
  }

  if (zoneCode) {
    conditions.push("z.zone_code = ?");
    params.push(zoneCode);
  }

  if (seatStatus && SEAT_STATIC_STATUSES.has(seatStatus)) {
    conditions.push("s.seat_status = ?");
    params.push(seatStatus);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await query(
    `
      SELECT
        s.id,
        s.seat_code AS seatCode,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        s.floor_no AS floorNo,
        s.table_code AS tableCode,
        s.table_group_code AS tableGroupCode,
        s.seat_seq AS seatSeq,
        s.seat_seq_label AS seatSeqLabel,
        s.seat_type AS seatType,
        s.seat_status AS seatStatus,
        s.seat_capacity AS seatCapacity,
        s.has_power AS hasPower,
        s.near_window AS nearWindow,
        s.quiet_level AS quietLevel,
        s.specific_location AS specificLocation,
        s.sort_order AS sortOrder,
        s.updated_at AS updatedAt
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      ${whereClause}
      ORDER BY z.floor_no ASC, z.sort_order ASC, s.sort_order ASC, s.id ASC
      LIMIT ${safeLimit}
    `,
    params
  );

  const [summaryRows] = await query(
    `
      SELECT
        s.seat_status AS seatStatus,
        COUNT(*) AS count
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      ${whereClause}
      GROUP BY s.seat_status
      ORDER BY count DESC, s.seat_status ASC
    `,
    params
  );

  return {
    items: rows.map(mapSeatListRow),
    summary: summaryRows.map((row) => ({
      seatStatus: row.seatStatus,
      count: Number(row.count || 0)
    }))
  };
}

async function updateAdminSeatStatus(studentNo, seatCode, input) {
  const admin = await assertAdminUser(studentNo);
  const normalizedSeatCode = requireValue(seatCode, "请输入座位编号", "SEAT_CODE_REQUIRED");
  const reason = requireValue(input.reason, "请输入座位状态调整原因", "SEAT_REASON_REQUIRED");
  const nextSeatStatus = String(input.seatStatus || "").trim();

  if (!SEAT_STATIC_STATUSES.has(nextSeatStatus)) {
    throw buildError("座位状态不合法", 400, "SEAT_STATUS_INVALID");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
        SELECT
          s.id,
          s.seat_code AS seatCode,
          z.zone_code AS zoneCode,
          z.display_name AS zoneDisplayName,
          s.floor_no AS floorNo,
          s.table_code AS tableCode,
          s.table_group_code AS tableGroupCode,
          s.seat_seq AS seatSeq,
          s.seat_seq_label AS seatSeqLabel,
          s.seat_type AS seatType,
          s.seat_status AS seatStatus,
          s.seat_capacity AS seatCapacity,
          s.has_power AS hasPower,
          s.near_window AS nearWindow,
          s.quiet_level AS quietLevel,
          s.specific_location AS specificLocation,
          s.sort_order AS sortOrder,
          s.updated_at AS updatedAt
        FROM library_seat s
        INNER JOIN library_zone z ON s.zone_id = z.id
        WHERE s.seat_code = ?
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedSeatCode]
    );

    const seat = rows[0];
    if (!seat) {
      throw buildError("未找到对应座位", 404, "SEAT_NOT_FOUND");
    }

    if (seat.seatStatus !== nextSeatStatus) {
      await connection.execute(
        `
          UPDATE library_seat
          SET seat_status = ?
          WHERE id = ?
        `,
        [nextSeatStatus, seat.id]
      );

      await connection.execute(
        `
          INSERT INTO seat_status_log (
            seat_id,
            operator_user_id,
            from_status,
            to_status,
            change_reason
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [seat.id, admin.id, seat.seatStatus, nextSeatStatus, reason]
      );
    }

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "seat",
      actionType: "status_change",
      targetType: "library_seat",
      targetId: seat.seatCode,
      actionDetail: {
        zoneCode: seat.zoneCode,
        reason,
        fromStatus: seat.seatStatus,
        toStatus: nextSeatStatus
      }
    });

    await connection.commit();

    const [latestRows] = await connection.execute(
      `
        SELECT
          s.id,
          s.seat_code AS seatCode,
          z.zone_code AS zoneCode,
          z.display_name AS zoneDisplayName,
          s.floor_no AS floorNo,
          s.table_code AS tableCode,
          s.table_group_code AS tableGroupCode,
          s.seat_seq AS seatSeq,
          s.seat_seq_label AS seatSeqLabel,
          s.seat_type AS seatType,
          s.seat_status AS seatStatus,
          s.seat_capacity AS seatCapacity,
          s.has_power AS hasPower,
          s.near_window AS nearWindow,
          s.quiet_level AS quietLevel,
          s.specific_location AS specificLocation,
          s.sort_order AS sortOrder,
          s.updated_at AS updatedAt
        FROM library_seat s
        INNER JOIN library_zone z ON s.zone_id = z.id
        WHERE s.id = ?
        LIMIT 1
      `,
      [seat.id]
    );

    return {
      message: "座位状态已更新",
      seat: mapSeatListRow(latestRows[0] || seat)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createAdminSeat(studentNo, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const payload = normalizeSeatPayload(input);
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const zone = await getZoneByCode(connection, payload.zoneCode);
    if (!zone) {
      throw buildError("未找到所属分区，请先创建分区", 404, "SEAT_ZONE_NOT_FOUND");
    }

    const existingSeat = await getSeatByCode(connection, payload.seatCode);
    if (existingSeat) {
      throw buildError("该座位编号已存在，请更换后再试", 409, "SEAT_CODE_DUPLICATED");
    }

    const derivedSource = {
      ...payload,
      nearRestroom: false,
      nearPantry: false,
      nearAC: false,
      nearBookshelf: false,
      nearCorridor: false,
      sunlight: payload.nearWindow ? "有" : "无"
    };
    const derivedMetadata = buildSeatDerivedMetadata(derivedSource);

    await connection.execute(
      `
        INSERT INTO library_seat (
          zone_id,
          seat_code,
          floor_no,
          table_code,
          table_group_code,
          seat_seq,
          seat_seq_label,
          qr_token,
          seat_type,
          seat_capacity,
          seat_status,
          has_power,
          near_window,
          quiet_level,
          near_restroom,
          near_pantry,
          near_ac,
          near_bookshelf,
          near_corridor,
          sunlight,
          raw_tags_text,
          raw_tags_json,
          tag_keys_json,
          specific_location,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)
      `,
      [
        zone.id,
        payload.seatCode,
        zone.floorNo,
        payload.tableCode,
        `${zone.zoneCode}-${payload.tableCode}`,
        payload.seatSeq,
        payload.seatSeqLabel,
        buildSeatQrToken(payload.seatCode),
        payload.seatType,
        payload.seatCapacity,
        payload.seatStatus,
        payload.hasPower ? 1 : 0,
        payload.nearWindow ? 1 : 0,
        payload.quietLevel,
        derivedSource.sunlight,
        derivedMetadata.rawTagsText,
        derivedMetadata.rawTagsJson,
        derivedMetadata.tagKeysJson,
        payload.specificLocation,
        payload.sortOrder
      ]
    );

    await recalcZoneSeatStats(connection, zone.id);

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "seat",
      actionType: "create",
      targetType: "library_seat",
      targetId: payload.seatCode,
      actionDetail: {
        ...payload,
        floorNo: zone.floorNo
      }
    });

    await connection.commit();

    const latestSeat = await getSeatByCode(connection, payload.seatCode);
    return {
      message: "座位已创建",
      seat: mapSeatListRow(latestSeat)
    };
  } catch (error) {
    await connection.rollback();

    if (error && error.code === "ER_DUP_ENTRY") {
      throw buildError("该座位编号或二维码令牌已存在，请更换后再试", 409, "SEAT_CODE_DUPLICATED");
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function updateAdminSeat(studentNo, seatCode, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const normalizedSeatCode = requireValue(seatCode, "请输入座位编号", "SEAT_CODE_REQUIRED").toUpperCase();
  const payload = normalizeSeatPayload({
    ...input,
    seatCode: normalizedSeatCode
  }, {
    allowOptionalSeatCode: true,
    allowOptionalZoneCode: true
  });
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const seat = await getSeatForUpdate(connection, normalizedSeatCode);
    if (!seat) {
      throw buildError("未找到对应座位", 404, "SEAT_NOT_FOUND");
    }

    const nextSeat = {
      ...seat,
      ...payload,
      nearRestroom: Boolean(seat.nearRestroom),
      nearPantry: Boolean(seat.nearPantry),
      nearAC: Boolean(seat.nearAC),
      nearBookshelf: Boolean(seat.nearBookshelf),
      nearCorridor: Boolean(seat.nearCorridor),
      sunlight: seat.sunlight || (payload.nearWindow ? "有" : "无")
    };
    const derivedMetadata = buildSeatDerivedMetadata(nextSeat);

    await connection.execute(
      `
        UPDATE library_seat
        SET
          table_code = ?,
          table_group_code = ?,
          seat_seq = ?,
          seat_seq_label = ?,
          seat_type = ?,
          seat_capacity = ?,
          seat_status = ?,
          has_power = ?,
          near_window = ?,
          quiet_level = ?,
          sunlight = ?,
          raw_tags_text = ?,
          raw_tags_json = ?,
          tag_keys_json = ?,
          specific_location = ?,
          sort_order = ?
        WHERE id = ?
      `,
      [
        payload.tableCode,
        `${seat.zoneCode}-${payload.tableCode}`,
        payload.seatSeq,
        payload.seatSeqLabel,
        payload.seatType,
        payload.seatCapacity,
        payload.seatStatus,
        payload.hasPower ? 1 : 0,
        payload.nearWindow ? 1 : 0,
        payload.quietLevel,
        nextSeat.sunlight,
        derivedMetadata.rawTagsText,
        derivedMetadata.rawTagsJson,
        derivedMetadata.tagKeysJson,
        payload.specificLocation,
        payload.sortOrder,
        seat.id
      ]
    );

    if (seat.seatStatus !== payload.seatStatus) {
      await connection.execute(
        `
          INSERT INTO seat_status_log (
            seat_id,
            operator_user_id,
            from_status,
            to_status,
            change_reason
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [seat.id, admin.id, seat.seatStatus, payload.seatStatus, "seat_editor_update"]
      );
    }

    await recalcZoneSeatStats(connection, seat.zoneId);

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "seat",
      actionType: "update",
      targetType: "library_seat",
      targetId: normalizedSeatCode,
      actionDetail: {
        before: mapSeatListRow(seat),
        after: {
          seatCode: normalizedSeatCode,
          zoneCode: seat.zoneCode,
          ...payload
        }
      }
    });

    await connection.commit();

    const latestSeat = await getSeatByCode(connection, normalizedSeatCode);
    return {
      message: "座位信息已更新",
      seat: mapSeatListRow(latestSeat)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteAdminSeat(studentNo, seatCode, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const normalizedSeatCode = requireValue(seatCode, "请输入座位编号", "SEAT_CODE_REQUIRED").toUpperCase();
  const reason = normalizeOptionalText(input.reason, 255) || "admin_delete_seat";
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const seat = await getSeatForUpdate(connection, normalizedSeatCode);
    if (!seat) {
      throw buildError("未找到对应座位", 404, "SEAT_NOT_FOUND");
    }

    const [reservationRows] = await connection.execute(
      `
        SELECT COUNT(*) AS reservationCount
        FROM seat_reservation
        WHERE seat_id = ?
      `,
      [seat.id]
    );

    if (Number(reservationRows[0] && reservationRows[0].reservationCount || 0) > 0) {
      throw buildError("该座位已有预约历史，暂不支持直接删除", 400, "SEAT_HAS_RESERVATIONS");
    }

    await connection.execute(
      `
        DELETE FROM library_seat
        WHERE id = ?
      `,
      [seat.id]
    );

    await recalcZoneSeatStats(connection, seat.zoneId);

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "seat",
      actionType: "delete",
      targetType: "library_seat",
      targetId: normalizedSeatCode,
      actionDetail: {
        reason,
        seat: mapSeatListRow(seat)
      }
    });

    await connection.commit();

    return {
      message: "座位已删除"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listAdminRuleConfigs(studentNo) {
  await assertAdminUser(studentNo);

  const rows = await queryRuleConfigRows();

  return {
    groups: RULE_CONFIG_GROUPS,
    items: buildRuleConfigItems(rows),
    rules: buildRulesFromConfigRows(rows)
  };
}

async function updateAdminRuleConfigs(studentNo, input = {}) {
  const admin = await assertAdminUser(studentNo);
  const configs = Array.isArray(input.configs) ? input.configs : [];

  if (!configs.length) {
    throw buildError("请至少提交一项系统规则配置", 400, "CONFIG_ITEMS_REQUIRED");
  }

  const normalizedItems = configs.map((item) => {
    const configKey = requireValue(item && item.configKey, "存在缺失的配置键", "CONFIG_KEY_REQUIRED");
    const definition = getRuleConfigDefinition(configKey);

    if (!definition) {
      throw buildError(`未识别的系统配置项：${configKey}`, 400, "CONFIG_KEY_UNSUPPORTED");
    }

    try {
      const normalizedValue = normalizeConfigInput(definition, item.value);
      return {
        definition,
        configKey,
        configGroup: definition.configGroup,
        storedValue: normalizedValue.storedValue
      };
    } catch (error) {
      throw buildError(error.message || "系统配置校验失败", 400, "CONFIG_VALUE_INVALID", {
        configKey
      });
    }
  });

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    for (const item of normalizedItems) {
      await connection.execute(
        `
          INSERT INTO system_config (
            config_key,
            config_group,
            config_value,
            value_type,
            description,
            updated_by
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            config_group = VALUES(config_group),
            config_value = VALUES(config_value),
            value_type = VALUES(value_type),
            description = VALUES(description),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          item.configKey,
          item.configGroup,
          item.storedValue,
          item.definition.valueType,
          item.definition.description,
          admin.id
        ]
      );
    }

    await insertAdminOperationLog(connection, {
      operatorUserId: admin.id,
      actionModule: "system_config",
      actionType: "batch_update",
      targetType: "system_config",
      targetId: "system_config_batch",
      actionDetail: {
        updatedCount: normalizedItems.length,
        configs: normalizedItems.map((item) => ({
          configKey: item.configKey,
          value: item.storedValue
        }))
      }
    });

    await connection.commit();

    const latestRows = await queryRuleConfigRows((sql, params) => connection.execute(sql, params));

    return {
      message: "系统规则已更新",
      groups: RULE_CONFIG_GROUPS,
      items: buildRuleConfigItems(latestRows),
      rules: buildRulesFromConfigRows(latestRows)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
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
};
