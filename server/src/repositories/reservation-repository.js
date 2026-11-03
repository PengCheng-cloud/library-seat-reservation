const { getPool, query } = require("../lib/db");

const CURRENT_STATUSES = ["reserved", "checked_in", "temporary_leave"];
const HISTORY_STATUSES = ["completed", "cancelled", "no_show", "violation", "admin_released"];
const DAILY_LIMIT_STATUSES = ["reserved", "checked_in", "temporary_leave", "completed", "no_show", "violation", "admin_released"];

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

function requireStudentNo(value) {
  const studentNo = String(value || "").trim();
  if (!studentNo) {
    throw buildError("请先登录后再操作", 401, "AUTH_REQUIRED");
  }

  return studentNo;
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

  const text = String(value);
  return text.slice(0, 5);
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDateTimeValue(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatDateTime(date);
}

function timeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function buildDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}:00`);
}

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function diffDays(left, right) {
  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((left.getTime() - right.getTime()) / millisPerDay);
}

function mapReservationRow(row) {
  return {
    reservationNo: row.reservationNo,
    seatId: row.seatId,
    zoneCode: row.zoneCode,
    zoneDisplayName: row.zoneDisplayName,
    reservationDate: formatDate(row.reservationDate),
    startTime: formatTime(row.startTime),
    endTime: formatTime(row.endTime),
    status: row.status,
    source: row.source,
    checkinOpenAt: formatDateTimeValue(row.checkinOpenAt),
    checkinDeadlineAt: formatDateTimeValue(row.checkinDeadlineAt),
    checkedInAt: formatDateTimeValue(row.checkedInAt),
    checkoutAt: formatDateTimeValue(row.checkoutAt),
    leaveDeadlineAt: formatDateTimeValue(row.leaveDeadlineAt)
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

async function findSeatBySeatCode(seatCode) {
  const [rows] = await query(
    `
      SELECT
        s.id,
        s.seat_code AS seatId,
        s.floor_no AS floorNo,
        s.seat_status AS seatStatus,
        s.seat_type AS seatType,
        z.id AS zoneId,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        z.is_enabled AS isEnabled
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      WHERE s.seat_code = ?
      LIMIT 1
    `,
    [seatCode]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    isEnabled: Boolean(rows[0].isEnabled)
  };
}

async function findSeatByQrToken(qrToken) {
  const [rows] = await query(
    `
      SELECT
        s.id,
        s.seat_code AS seatId,
        s.qr_token AS qrToken,
        s.floor_no AS floorNo,
        s.seat_status AS seatStatus,
        z.id AS zoneId,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        z.is_enabled AS isEnabled
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      WHERE s.qr_token = ?
      LIMIT 1
    `,
    [qrToken]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    isEnabled: Boolean(rows[0].isEnabled)
  };
}

async function assertReservationQrToken(qrToken, reservation) {
  const normalizedQrToken = String(qrToken || "").trim();
  if (!normalizedQrToken) {
    throw buildError("请先扫描座位二维码", 400, "QR_TOKEN_REQUIRED");
  }

  const seat = await findSeatByQrToken(normalizedQrToken);
  if (!seat) {
    throw buildError("未识别到有效的座位二维码", 400, "QR_TOKEN_INVALID");
  }

  if (seat.id !== reservation.seatDbId) {
    throw buildError(
      `二维码与当前预约座位不匹配，请扫描 ${reservation.seatId}`,
      400,
      "QR_TOKEN_SEAT_MISMATCH",
      {
        expectedSeatId: reservation.seatId,
        scannedSeatId: seat.seatId
      }
    );
  }

  return seat;
}

function parseLocationCoordinate(value, fieldName, min, max) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw buildError(`缺少有效的${fieldName}`, 400, "CHECKIN_LOCATION_REQUIRED", {
      field: fieldName
    });
  }

  if (normalized < min || normalized > max) {
    throw buildError(`${fieldName}超出允许范围`, 400, "CHECKIN_LOCATION_INVALID", {
      field: fieldName,
      min,
      max
    });
  }

  return normalized;
}

function isLocationGeofenceConfigured(rules = {}) {
  const latitude = Number(rules.checkinLocationLatitude);
  const longitude = Number(rules.checkinLocationLongitude);
  const radiusMeters = Number(rules.checkinLocationRadiusMeters);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Number.isFinite(radiusMeters) &&
    radiusMeters > 0 &&
    !(latitude === 0 && longitude === 0)
  );
}

function calculateGeoDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const latDistance = toRadians(lat2 - lat1);
  const lngDistance = toRadians(lng2 - lng1);
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const haversine =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos(startLat) * Math.cos(endLat) *
    Math.sin(lngDistance / 2) * Math.sin(lngDistance / 2);

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

async function assertCheckinEvidence(input, reservation, rules) {
  const latitude = parseLocationCoordinate(input.latitude, "签到纬度", -90, 90);
  const longitude = parseLocationCoordinate(input.longitude, "签到经度", -180, 180);
  const accuracy = Number(input.accuracy);
  const normalizedAccuracy = Number.isFinite(accuracy) && accuracy > 0
    ? Number(accuracy.toFixed(2))
    : 0;

  const evidence = {
    method: "location",
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: normalizedAccuracy,
    geofenceEnabled: false,
    distanceMeters: null,
    radiusMeters: null
  };

  if (!isLocationGeofenceConfigured(rules)) {
    return evidence;
  }

  const centerLatitude = Number(rules.checkinLocationLatitude);
  const centerLongitude = Number(rules.checkinLocationLongitude);
  const radiusMeters = Number(rules.checkinLocationRadiusMeters);
  const distanceMeters = calculateGeoDistanceMeters(latitude, longitude, centerLatitude, centerLongitude);

  evidence.geofenceEnabled = true;
  evidence.distanceMeters = Math.round(distanceMeters);
  evidence.radiusMeters = Math.round(radiusMeters);

  if (distanceMeters > radiusMeters) {
    throw buildError("当前定位不在图书馆签到范围内，请到馆后重试", 400, "CHECKIN_LOCATION_OUT_OF_RANGE", {
      distanceMeters: Math.round(distanceMeters),
      radiusMeters: Math.round(radiusMeters)
    });
  }

  return evidence;
}

function getPersistedCheckinType(checkinRecord) {
  return checkinRecord && checkinRecord.checkinType
    ? checkinRecord.checkinType
    : null;
}

function buildCheckinResultPayload(checkinEvidence) {
  return {
    checkinMethod: checkinEvidence.method,
    location: {
      latitude: checkinEvidence.latitude,
      longitude: checkinEvidence.longitude,
      accuracy: checkinEvidence.accuracy,
      geofenceEnabled: Boolean(checkinEvidence.geofenceEnabled),
      distanceMeters: checkinEvidence.distanceMeters,
      radiusMeters: checkinEvidence.radiusMeters
    }
  };
}

async function getReservationSyncContext(connection, reservationId) {
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
        r.checkin_open_at AS checkinOpenAt,
        r.checkin_deadline_at AS checkinDeadlineAt,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt
      FROM seat_reservation r
      WHERE r.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [reservationId]
  );

  return rows[0] || null;
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

async function upsertCheckinRecord(connection, payload) {
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

function buildTerminalUsageSummary(reservation, checkinRecord, options = {}) {
  const reservationDate = formatDate(reservation.reservationDate);
  const endAt = buildDateTime(reservationDate, formatTime(reservation.endTime));
  const firstCheckinAt = checkinRecord && checkinRecord.firstCheckinAt
    ? new Date(checkinRecord.firstCheckinAt)
    : endAt;
  const baseLeaveMinutes = Number(checkinRecord && checkinRecord.totalLeaveMinutes || 0);
  const extraLeaveMinutes = Number(options.extraLeaveMinutes || 0);
  const totalLeaveMinutes = baseLeaveMinutes + extraLeaveMinutes;
  const actualUsageMinutes = Math.max(0, calcDiffMinutes(firstCheckinAt, endAt) - totalLeaveMinutes);

  return {
    endAt,
    totalLeaveMinutes,
    actualUsageMinutes
  };
}

async function processNoShowReservationById(reservationId, rules) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const reservation = await getReservationSyncContext(connection, reservationId);
    if (!reservation || reservation.status !== "reserved") {
      await connection.rollback();
      return false;
    }

    const deadlineAt = new Date(reservation.checkinDeadlineAt);
    if (Number.isNaN(deadlineAt.getTime()) || deadlineAt > new Date()) {
      await connection.rollback();
      return false;
    }

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'no_show',
          violation_type = 'no_show',
          violation_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [formatDateTime(deadlineAt), reservation.id]
    );

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkoutType: "auto",
      checkoutAt: formatDateTime(deadlineAt),
      finalResult: "no_show"
    });

    await deleteReservationSlots(connection, reservation.id);
    await applyPenalty(connection, { id: reservation.userId }, reservation.id, rules.penalties.noShow, "未签到违约", rules);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processLeaveTimeoutReservationById(reservationId, rules) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const reservation = await getReservationSyncContext(connection, reservationId);
    if (!reservation || reservation.status !== "temporary_leave") {
      await connection.rollback();
      return false;
    }

    const checkinRecord = await getCheckinRecord(connection, reservation.id);
    const openLeave = await getOpenLeaveRecord(connection, reservation.id);

    if (!checkinRecord || !openLeave) {
      await connection.rollback();
      return false;
    }

    const now = new Date();
    const leaveDeadlineAt = new Date(openLeave.leaveDeadlineAt);
    if (Number.isNaN(leaveDeadlineAt.getTime()) || leaveDeadlineAt > now) {
      await connection.rollback();
      return false;
    }

    const leaveStartedAt = new Date(openLeave.leaveStartedAt);
    const leaveMinutes = calcDiffMinutes(leaveStartedAt, now);
    const nextTotalLeaveMinutes = Number(checkinRecord.totalLeaveMinutes || 0) + leaveMinutes;
    const firstCheckinAt = checkinRecord.firstCheckinAt ? new Date(checkinRecord.firstCheckinAt) : now;
    const actualUsageMinutes = Math.max(0, calcDiffMinutes(firstCheckinAt, now) - nextTotalLeaveMinutes);

    await connection.execute(
      `
        UPDATE reservation_leave_record
        SET
          returned_at = NOW(),
          leave_minutes = ?,
          is_timeout = 1
        WHERE id = ?
      `,
      [leaveMinutes, openLeave.id]
    );

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: getPersistedCheckinType(checkinRecord),
      firstCheckinAt: checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : null,
      checkoutType: "auto",
      checkoutAt: formatDateTime(now),
      leaveCount: Number(checkinRecord.leaveCount || 0),
      totalLeaveMinutes: nextTotalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord.lastLeaveStartedAt ? formatDateTime(checkinRecord.lastLeaveStartedAt) : null,
      lastReturnedAt: formatDateTime(now),
      actualUsageMinutes,
      finalResult: "leave_timeout"
    });

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'violation',
          violation_type = 'leave_timeout',
          violation_at = NOW(),
          checkout_at = NOW()
        WHERE id = ?
      `,
      [reservation.id]
    );

    await deleteReservationSlots(connection, reservation.id);
    await applyPenalty(connection, { id: reservation.userId }, reservation.id, rules.penalties.leaveTimeout, "暂离超时", rules);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processAutoCompleteReservationById(reservationId) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const reservation = await getReservationSyncContext(connection, reservationId);
    if (!reservation || !["checked_in", "temporary_leave"].includes(reservation.status)) {
      await connection.rollback();
      return false;
    }

    const reservationDate = formatDate(reservation.reservationDate);
    const endAt = buildDateTime(reservationDate, formatTime(reservation.endTime));
    if (Number.isNaN(endAt.getTime()) || endAt > new Date()) {
      await connection.rollback();
      return false;
    }

    const checkinRecord = await getCheckinRecord(connection, reservation.id);
    let extraLeaveMinutes = 0;
    let lastReturnedAt = null;

    if (reservation.status === "temporary_leave") {
      const openLeave = await getOpenLeaveRecord(connection, reservation.id);
      if (openLeave) {
        const leaveStartedAt = new Date(openLeave.leaveStartedAt);
        extraLeaveMinutes = calcDiffMinutes(leaveStartedAt, endAt);
        lastReturnedAt = endAt;

        await connection.execute(
          `
            UPDATE reservation_leave_record
            SET
              returned_at = ?,
              leave_minutes = ?,
              is_timeout = 0
            WHERE id = ?
          `,
          [formatDateTime(endAt), extraLeaveMinutes, openLeave.id]
        );
      }
    }

    const summary = buildTerminalUsageSummary(reservation, checkinRecord, {
      extraLeaveMinutes
    });

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: getPersistedCheckinType(checkinRecord),
      firstCheckinAt: checkinRecord && checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : null,
      checkoutType: "auto",
      checkoutAt: formatDateTime(summary.endAt),
      leaveCount: Number(checkinRecord && checkinRecord.leaveCount || 0),
      totalLeaveMinutes: summary.totalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord && checkinRecord.lastLeaveStartedAt ? formatDateTime(checkinRecord.lastLeaveStartedAt) : null,
      lastReturnedAt: lastReturnedAt ? formatDateTime(lastReturnedAt) : (checkinRecord && checkinRecord.lastReturnedAt ? formatDateTime(checkinRecord.lastReturnedAt) : null),
      actualUsageMinutes: summary.actualUsageMinutes,
      finalResult: "completed"
    });

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'completed',
          checkout_at = ?
        WHERE id = ?
      `,
      [formatDateTime(summary.endAt), reservation.id]
    );

    await deleteReservationSlots(connection, reservation.id);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function syncReservationStates(rules) {
  if (!rules) {
    return {
      noShowCount: 0,
      leaveTimeoutCount: 0,
      autoCompletedCount: 0
    };
  }

  const [noShowRows] = await query(
    `
      SELECT id
      FROM seat_reservation
      WHERE status = 'reserved'
        AND checkin_deadline_at < NOW()
      ORDER BY id ASC
      LIMIT 100
    `
  );

  let noShowCount = 0;
  for (const row of noShowRows) {
    if (await processNoShowReservationById(row.id, rules)) {
      noShowCount += 1;
    }
  }

  const [leaveTimeoutRows] = await query(
    `
      SELECT DISTINCT r.id
      FROM seat_reservation r
      INNER JOIN reservation_leave_record lr
        ON lr.reservation_id = r.id
       AND lr.returned_at IS NULL
      WHERE r.status = 'temporary_leave'
        AND lr.leave_deadline_at < NOW()
      ORDER BY r.id ASC
      LIMIT 100
    `
  );

  let leaveTimeoutCount = 0;
  for (const row of leaveTimeoutRows) {
    if (await processLeaveTimeoutReservationById(row.id, rules)) {
      leaveTimeoutCount += 1;
    }
  }

  const [autoCompleteRows] = await query(
    `
      SELECT id
      FROM seat_reservation
      WHERE status IN ('checked_in', 'temporary_leave')
        AND TIMESTAMP(reservation_date, end_time) <= NOW()
      ORDER BY id ASC
      LIMIT 100
    `
  );

  let autoCompletedCount = 0;
  for (const row of autoCompleteRows) {
    if (await processAutoCompleteReservationById(row.id)) {
      autoCompletedCount += 1;
    }
  }

  return {
    noShowCount,
    leaveTimeoutCount,
    autoCompletedCount
  };
}

async function listReservationsByStudentNo(studentNo, rules) {
  await syncReservationStates(rules);

  const user = await findUserByStudentNo(studentNo);
  if (!user) {
    return {
      user: null,
      current: [],
      history: []
    };
  }

  const [rows] = await query(
    `
      SELECT
        r.reservation_no AS reservationNo,
        ls.seat_code AS seatId,
        lz.zone_code AS zoneCode,
        lz.display_name AS zoneDisplayName,
        r.reservation_date AS reservationDate,
        r.start_time AS startTime,
        r.end_time AS endTime,
        r.status,
        r.source,
        r.checkin_open_at AS checkinOpenAt,
        r.checkin_deadline_at AS checkinDeadlineAt,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt,
        open_leave.leave_deadline_at AS leaveDeadlineAt
      FROM seat_reservation r
      INNER JOIN library_seat ls ON r.seat_id = ls.id
      INNER JOIN library_zone lz ON r.zone_id = lz.id
      LEFT JOIN reservation_leave_record open_leave
        ON open_leave.reservation_id = r.id
       AND open_leave.returned_at IS NULL
      WHERE r.user_id = ?
      ORDER BY r.reservation_date DESC, r.start_time DESC, r.id DESC
    `,
    [user.id]
  );

  const reservations = rows.map(mapReservationRow);

  return {
    user,
    current: reservations.filter((item) => CURRENT_STATUSES.includes(item.status)),
    history: reservations.filter((item) => HISTORY_STATUSES.includes(item.status))
  };
}

async function getReservationValidationContext(input, rules) {
  await syncReservationStates(rules);

  const studentNo = requireStudentNo(input.studentNo || input.userId);
  const seatId = input.seatId;
  const reservationDate = input.reservationDate;

  const user = await findUserByStudentNo(studentNo);
  const seat = seatId ? await findSeatBySeatCode(seatId) : null;

  let userTimeConflicts = [];
  let seatConflicts = [];
  let activeReservationCount = 0;
  let dailyReservationCount = 0;

  if (user) {
    const [activeCountRows] = await query(
      `
        SELECT COUNT(*) AS count
        FROM seat_reservation
        WHERE user_id = ?
          AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
      `,
      [user.id, ...CURRENT_STATUSES]
    );
    activeReservationCount = Number(activeCountRows[0] && activeCountRows[0].count || 0);

    if (reservationDate) {
      const [userConflictRows] = await query(
        `
          SELECT
            reservation_no AS reservationNo,
            start_time AS startTime,
            end_time AS endTime,
            status,
            seat_id AS seatDbId
          FROM seat_reservation
          WHERE user_id = ?
            AND reservation_date = ?
            AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
        `,
        [user.id, reservationDate, ...CURRENT_STATUSES]
      );

      userTimeConflicts = userConflictRows.map((row) => ({
        reservationNo: row.reservationNo,
        startTime: formatTime(row.startTime),
        endTime: formatTime(row.endTime),
        status: row.status,
        seatDbId: Number(row.seatDbId || 0)
      }));

      const [dailyCountRows] = await query(
        `
          SELECT COUNT(*) AS count
          FROM seat_reservation
          WHERE user_id = ?
            AND reservation_date = ?
            AND status NOT IN ('cancelled', 'admin_released')
        `,
        [user.id, reservationDate]
      );
      dailyReservationCount = Number(dailyCountRows[0] && dailyCountRows[0].count || 0);
    }
  }

  if (seat && reservationDate) {
    const [conflictRows] = await query(
      `
        SELECT
          reservation_no AS reservationNo,
          start_time AS startTime,
          end_time AS endTime,
          status
        FROM seat_reservation
        WHERE seat_id = ?
          AND reservation_date = ?
          AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
        ORDER BY start_time ASC
      `,
      [seat.id, reservationDate, ...CURRENT_STATUSES]
    );

    seatConflicts = conflictRows.map((row) => ({
      reservationNo: row.reservationNo,
      startTime: formatTime(row.startTime),
      endTime: formatTime(row.endTime),
      status: row.status
    }));
  }

  return {
    user,
    seat,
    userTimeConflicts,
    seatConflicts,
    activeReservationCount,
    dailyReservationCount
  };
}

function validateReservationInput(input, context, rules) {
  const { user, seat, userTimeConflicts, seatConflicts } = context;
  const activeReservationCount = Number(context.activeReservationCount || 0);
  const dailyReservationCount = Number(context.dailyReservationCount || 0);
  const reservationDate = input.reservationDate;
  const startTime = input.startTime;
  const endTime = input.endTime;

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const requestDate = reservationDate ? new Date(`${reservationDate}T00:00:00`) : null;
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const openMinutes = timeToMinutes(rules.openTime);
  const closeMinutes = timeToMinutes(rules.closeTime);
  const durationMinutes = startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null;
  const requestStartAt =
    reservationDate && startTime ? buildDateTime(reservationDate, startTime) : null;

  const overlappingConflicts = seatConflicts.filter((item) => {
    const conflictStart = timeToMinutes(item.startTime);
    const conflictEnd = timeToMinutes(item.endTime);
    if (conflictStart === null || conflictEnd === null || startMinutes === null || endMinutes === null) {
      return false;
    }
    return startMinutes < conflictEnd && endMinutes > conflictStart;
  });

  const overlappingUserConflicts = (userTimeConflicts || []).filter((item) => {
    const conflictStart = timeToMinutes(item.startTime);
    const conflictEnd = timeToMinutes(item.endTime);
    if (conflictStart === null || conflictEnd === null || startMinutes === null || endMinutes === null) {
      return false;
    }

    return startMinutes < conflictEnd && endMinutes > conflictStart;
  });
  const checks = [
    {
      key: "user_exists",
      label: "用户存在",
      passed: Boolean(user),
      detail: user ? `${user.studentNo} 可用于预约` : "未找到对应用户"
    },
    {
      key: "user_status",
      label: "用户状态正常",
      passed: Boolean(user) && user.status === "active" && !user.isBlacklisted,
      detail: user && user.isBlacklisted ? "用户当前处于黑名单期" : "用户状态可预约"
    },
    {
      key: "seat_exists",
      label: "座位存在",
      passed: Boolean(seat),
      detail: seat ? `${seat.seatId} 可用于预约` : "未找到对应座位"
    },
    {
      key: "seat_available",
      label: "座位可预约",
      passed: Boolean(seat) && seat.seatStatus === "available" && seat.isEnabled,
      detail: seat ? `当前状态 ${seat.seatStatus}` : "座位不存在"
    },
    {
      key: "date_window",
      label: "预约日期有效",
      passed:
        Boolean(requestDate) &&
        !Number.isNaN(requestDate.getTime()) &&
        diffDays(requestDate, today) >= 0 &&
        diffDays(requestDate, today) <= rules.advanceDays,
      detail: requestDate ? `允许预约今天起 ${rules.advanceDays} 天内` : "预约日期格式错误"
    },
    {
      key: "time_format",
      label: "时间格式有效",
      passed: startMinutes !== null && endMinutes !== null && endMinutes > startMinutes,
      detail: "结束时间必须晚于开始时间"
    },
    {
      key: "future_time",
      label: "预约开始时间不能早于当前时间",
      passed: Boolean(requestStartAt) && !Number.isNaN(requestStartAt.getTime()) && requestStartAt >= now,
      detail: "同一天不能补订已经开始的时段"
    },
    {
      key: "open_time",
      label: "预约时间在开放时段内",
      passed:
        startMinutes !== null &&
        endMinutes !== null &&
        openMinutes !== null &&
        closeMinutes !== null &&
        startMinutes >= openMinutes &&
        endMinutes <= closeMinutes,
      detail: `${rules.openTime} - ${rules.closeTime}`
    },
    {
      key: "duration_limit",
      label: "预约时长符合限制",
      passed:
        durationMinutes !== null &&
        durationMinutes >= rules.minReservationMinutes &&
        durationMinutes <= rules.maxReservationMinutes,
      detail: `${rules.minReservationMinutes}-${rules.maxReservationMinutes} 分钟`
    },
    {
      key: "user_time_conflict",
      label: "未超出有效预约上限",
      passed: activeReservationCount < rules.maxActiveReservations,
      detail: `当前有效预约 ${activeReservationCount} 条，上限 ${rules.maxActiveReservations} 条`
    },
    {
      key: "daily_limit",
      label: "未超出当日预约次数上限",
      passed: dailyReservationCount < rules.maxDailyReservations,
      detail: `当日已有预约 ${dailyReservationCount} 次，上限 ${rules.maxDailyReservations} 次`
    },
    {
      key: "account_time_conflict",
      label: "当前账号在该时段没有预约其他位置",
      passed: true,
      detail: overlappingUserConflicts.length === 0
        ? "当前时段没有命中账号预约冲突"
        : `你已预约 ${overlappingUserConflicts[0].startTime}-${overlappingUserConflicts[0].endTime} 的其他位置`
    },
    {
      key: "account_time_overlap",
      label: "当前账号在该时段没有预约其他位置",
      passed: overlappingUserConflicts.length === 0,
      detail: overlappingUserConflicts.length === 0
        ? "当前时段没有命中账号预约冲突"
        : `你已预约 ${overlappingUserConflicts[0].startTime}-${overlappingUserConflicts[0].endTime} 的其他位置`
    },
    {
      key: "seat_conflict",
      label: "目标时段无座位冲突",
      passed: overlappingConflicts.length === 0,
      detail:
        overlappingConflicts.length === 0
          ? "当前时段可预约"
          : `与 ${overlappingConflicts[0].reservationNo} 时间冲突`
    }
  ];

  return {
    valid: checks.every((item) => item.passed),
    checks,
    conflicts: overlappingConflicts,
    request: {
      studentNo: input.studentNo || "",
      seatId: input.seatId,
      reservationDate,
      startTime,
      endTime
    },
    user,
    seat,
    durationMinutes,
    startMinutes,
    endMinutes,
    message: checks.every((item) => item.passed)
      ? "当前请求通过校验，可以创建预约。"
      : "当前请求未通过校验，请调整日期、时间或座位。"
  };
}

function buildReservationNo() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    String(now.getMilliseconds()).padStart(3, "0"),
    String(Math.floor(Math.random() * 1000)).padStart(3, "0")
  ];
  return `RS${parts.join("")}`;
}

async function createReservation(input, rules) {
  const context = await getReservationValidationContext(input, rules);
  const validation = validateReservationInput(input, context, rules);

  if (!validation.valid) {
    throw buildError(validation.message, 400, "RESERVATION_VALIDATION_FAILED", validation);
  }

  const user = validation.user;
  const seat = validation.seat;
  const reservationNo = buildReservationNo();
  const reservationDate = validation.request.reservationDate;
  const startTime = validation.request.startTime;
  const endTime = validation.request.endTime;
  const startDateTime = buildDateTime(reservationDate, startTime);
  const checkinOpenAt = addMinutes(startDateTime, -rules.checkinAllowBeforeMinutes);
  const checkinDeadlineAt = addMinutes(startDateTime, rules.checkinAllowAfterMinutes);
  const ruleSnapshot = JSON.stringify({
    advanceDays: rules.advanceDays,
    minReservationMinutes: rules.minReservationMinutes,
    maxReservationMinutes: rules.maxReservationMinutes,
    maxActiveReservations: rules.maxActiveReservations,
    maxDailyReservations: rules.maxDailyReservations,
    openTime: rules.openTime,
    closeTime: rules.closeTime
  });

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      "SELECT id FROM app_user WHERE id = ? FOR UPDATE",
      [user.id]
    );

    const [activeCountRows] = await connection.execute(
      `
        SELECT COUNT(*) AS count
        FROM seat_reservation
        WHERE user_id = ?
          AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
      `,
      [user.id, ...CURRENT_STATUSES]
    );

    const activeReservationCount = Number(activeCountRows[0] && activeCountRows[0].count || 0);
    if (activeReservationCount >= rules.maxActiveReservations) {
      throw buildError(
        `当前有效预约已达到上限 ${rules.maxActiveReservations} 条`,
        400,
        "RESERVATION_ACTIVE_LIMIT"
      );
    }

    const [dailyCountRows] = await connection.execute(
      `
        SELECT COUNT(*) AS count
        FROM seat_reservation
        WHERE user_id = ?
          AND reservation_date = ?
          AND status NOT IN ('cancelled', 'admin_released')
      `,
      [user.id, reservationDate]
    );

    const dailyReservationCount = Number(dailyCountRows[0] && dailyCountRows[0].count || 0);
    if (dailyReservationCount >= rules.maxDailyReservations) {
      throw buildError(
        `当日预约次数已达到上限 ${rules.maxDailyReservations} 次`,
        400,
        "RESERVATION_DAILY_LIMIT"
      );
    }

    const [userConflictRows] = await connection.execute(
      `
        SELECT
          reservation_no AS reservationNo,
          start_time AS startTime,
          end_time AS endTime
        FROM seat_reservation
        WHERE user_id = ?
          AND reservation_date = ?
          AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
          AND start_time < ?
          AND end_time > ?
        LIMIT 1
        FOR UPDATE
      `,
      [user.id, reservationDate, ...CURRENT_STATUSES, `${endTime}:00`, `${startTime}:00`]
    );

    if (userConflictRows[0]) {
      throw buildError(
        `你已预约 ${formatTime(userConflictRows[0].startTime)}-${formatTime(userConflictRows[0].endTime)} 的其他位置`,
        409,
        "USER_RESERVATION_TIME_CONFLICT"
      );
    }

    const [seatConflictRows] = await connection.execute(
      `
        SELECT
          reservation_no AS reservationNo,
          start_time AS startTime,
          end_time AS endTime
        FROM seat_reservation
        WHERE seat_id = ?
          AND reservation_date = ?
          AND status IN (${CURRENT_STATUSES.map(() => "?").join(", ")})
          AND start_time < ?
          AND end_time > ?
        LIMIT 1
        FOR UPDATE
      `,
      [seat.id, reservationDate, ...CURRENT_STATUSES, `${endTime}:00`, `${startTime}:00`]
    );

    if (seatConflictRows[0]) {
      throw buildError(
        `该座位在 ${formatTime(seatConflictRows[0].startTime)}-${formatTime(seatConflictRows[0].endTime)} 已被预约`,
        409,
        "RESERVATION_SEAT_TIME_CONFLICT"
      );
    }

    const [insertResult] = await connection.execute(
      `
        INSERT INTO seat_reservation (
          reservation_no,
          user_id,
          seat_id,
          zone_id,
          floor_no,
          reservation_date,
          start_time,
          end_time,
          duration_minutes,
          source,
          status,
          checkin_open_at,
          checkin_deadline_at,
          rule_snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mini_program', 'reserved', ?, ?, ?)
      `,
      [
        reservationNo,
        user.id,
        seat.id,
        seat.zoneId,
        seat.floorNo,
        reservationDate,
        `${startTime}:00`,
        `${endTime}:00`,
        validation.durationMinutes,
        formatDateTime(checkinOpenAt),
        formatDateTime(checkinDeadlineAt),
        ruleSnapshot
      ]
    );

    const reservationId = insertResult.insertId;

    await connection.commit();

    return {
      reservationNo,
      reservationId,
      seatId: seat.seatId,
      zoneCode: seat.zoneCode,
      zoneDisplayName: seat.zoneDisplayName,
      reservationDate,
      startTime,
      endTime,
      status: "reserved",
      message: "预约创建成功"
    };
  } catch (error) {
    await connection.rollback();

    if (error && error.code === "ER_DUP_ENTRY") {
      throw buildError("预约创建发生并发冲突，请刷新后重试", 409, "RESERVATION_CONFLICT");
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function cancelReservationByNo(input, rules) {
  const studentNo = requireStudentNo(input.studentNo);
  const reservationNo = input.reservationNo;
  const cancelReason = input.cancelReason || "user_cancelled";

  await syncReservationStates(rules);

  const user = await findUserByStudentNo(studentNo);
  if (!user) {
    throw buildError("未找到对应用户", 404, "USER_NOT_FOUND");
  }

  const [rows] = await query(
    `
      SELECT
        id,
        reservation_no AS reservationNo,
        reservation_date AS reservationDate,
        start_time AS startTime,
        end_time AS endTime,
        status
      FROM seat_reservation
      WHERE reservation_no = ?
        AND user_id = ?
      LIMIT 1
    `,
    [reservationNo, user.id]
  );

  const reservation = rows[0];
  if (!reservation) {
    throw buildError("未找到对应预约记录", 404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status !== "reserved") {
    throw buildError("当前预约状态不允许取消", 400, "RESERVATION_CANCEL_NOT_ALLOWED");
  }

  const reservationDate = formatDate(reservation.reservationDate);
  const startTime = formatTime(reservation.startTime);
  const startDateTime = buildDateTime(reservationDate, startTime);
  const latestCancelAt = addMinutes(startDateTime, -rules.cancelBeforeMinutes);

  if (new Date() > latestCancelAt) {
    throw buildError("已超过可取消时间", 400, "RESERVATION_CANCEL_TIMEOUT");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancel_reason = ?
        WHERE id = ?
      `,
      [cancelReason, reservation.id]
    );

    await deleteReservationSlots(connection, reservation.id);

    await connection.commit();

    return {
      reservationNo,
      status: "cancelled",
      message: "预约已取消"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getReservationByNoForUser(studentNo, reservationNo) {
  const user = await findUserByStudentNo(studentNo);
  if (!user) {
    return { user: null, reservation: null };
  }

  const [rows] = await query(
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
        r.checkin_open_at AS checkinOpenAt,
        r.checkin_deadline_at AS checkinDeadlineAt,
        r.checked_in_at AS checkedInAt,
        r.checkout_at AS checkoutAt,
        ls.seat_code AS seatId,
        lz.zone_code AS zoneCode,
        lz.display_name AS zoneDisplayName
      FROM seat_reservation r
      INNER JOIN library_seat ls ON r.seat_id = ls.id
      INNER JOIN library_zone lz ON r.zone_id = lz.id
      WHERE r.reservation_no = ?
        AND r.user_id = ?
      LIMIT 1
    `,
    [reservationNo, user.id]
  );

  return {
    user,
    reservation: rows[0] || null
  };
}

async function getCheckinRecord(connection, reservationId) {
  const [rows] = await connection.execute(
    `
      SELECT
        id,
        checkin_type AS checkinType,
        first_checkin_at AS firstCheckinAt,
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

function calcDiffMinutes(start, end) {
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diff / 60000));
}

async function applyPenalty(connection, user, reservationId, delta, reason, rules) {
  if (!delta || delta <= 0) {
    return null;
  }

  const [rows] = await connection.execute(
    `
      SELECT
        credit_score AS creditScore,
        violation_count AS violationCount
      FROM app_user
      WHERE id = ?
      FOR UPDATE
    `,
    [user.id]
  );

  const profile = rows[0];
  if (!profile) {
    return null;
  }

  const before = Number(profile.creditScore || 0);
  const after = Math.max(0, before - delta);
  const shouldBlacklist = after < rules.blacklistCreditThreshold;
  const blacklistUntil = shouldBlacklist
    ? formatDateTime(addMinutes(new Date(), rules.blacklistDays * 24 * 60))
    : null;

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
    [after, shouldBlacklist ? 1 : 0, blacklistUntil, user.id]
  );

  await connection.execute(
    `
      INSERT INTO user_credit_log (
        user_id,
        reservation_id,
        change_type,
        change_reason,
        score_delta,
        score_before,
        score_after
      ) VALUES (?, ?, 'penalty', ?, ?, ?, ?)
    `,
    [user.id, reservationId, reason, -delta, before, after]
  );

  return {
    before,
    after,
    delta: -delta,
    blacklisted: shouldBlacklist
  };
}

async function checkinReservationByNo(input, rules) {
  const studentNo = requireStudentNo(input.studentNo);
  const reservationNo = input.reservationNo;

  await syncReservationStates(rules);

  const { user, reservation } = await getReservationByNoForUser(studentNo, reservationNo);

  if (!user) {
    throw buildError("未找到对应用户", 404, "USER_NOT_FOUND");
  }

  if (!reservation) {
    throw buildError("未找到对应预约记录", 404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status !== "reserved") {
    throw buildError("当前预约状态不允许签到", 400, "RESERVATION_CHECKIN_NOT_ALLOWED");
  }

  const checkinEvidence = await assertCheckinEvidence(input, reservation, rules);

  const now = new Date();
  const openAt = new Date(reservation.checkinOpenAt);
  const deadlineAt = new Date(reservation.checkinDeadlineAt);

  if (now < openAt) {
    throw buildError("还未到可签到时间", 400, "RESERVATION_CHECKIN_TOO_EARLY");
  }

  if (now > deadlineAt) {
    await syncReservationStates(rules);
    throw buildError("已超过签到截止时间", 400, "RESERVATION_CHECKIN_TIMEOUT");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'checked_in',
          checked_in_at = NOW()
        WHERE id = ?
      `,
      [reservation.id]
    );

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: null,
      firstCheckinAt: formatDateTime(now),
      leaveCount: 0,
      totalLeaveMinutes: 0,
      actualUsageMinutes: 0,
      finalResult: "reserved"
    });

    await connection.commit();

    return {
      reservationNo,
      seatId: reservation.seatId,
      status: "checked_in",
      message: "签到成功",
      ...buildCheckinResultPayload(checkinEvidence)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function checkoutReservationByNo(input, rules) {
  const studentNo = requireStudentNo(input.studentNo);
  const reservationNo = input.reservationNo;

  await syncReservationStates(rules);

  const { user, reservation } = await getReservationByNoForUser(studentNo, reservationNo);

  if (!user) {
    throw buildError("未找到对应用户", 404, "USER_NOT_FOUND");
  }

  if (!reservation) {
    throw buildError("未找到对应预约记录", 404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status !== "checked_in") {
    throw buildError("当前预约状态不允许签退", 400, "RESERVATION_CHECKOUT_NOT_ALLOWED");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const checkinRecord = await getCheckinRecord(connection, reservation.id);
    const now = new Date();
    const firstCheckinAt = checkinRecord && checkinRecord.firstCheckinAt
      ? new Date(checkinRecord.firstCheckinAt)
      : now;
    const totalLeaveMinutes = Number(checkinRecord && checkinRecord.totalLeaveMinutes || 0);
    const actualUsageMinutes = Math.max(0, calcDiffMinutes(firstCheckinAt, now) - totalLeaveMinutes);

    await connection.execute(
      `
        UPDATE seat_reservation
        SET
          status = 'completed',
          checkout_at = NOW()
        WHERE id = ?
      `,
      [reservation.id]
    );

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: getPersistedCheckinType(checkinRecord),
      firstCheckinAt: checkinRecord && checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : formatDateTime(firstCheckinAt),
      checkoutType: "direct",
      checkoutAt: formatDateTime(now),
      leaveCount: Number(checkinRecord && checkinRecord.leaveCount || 0),
      totalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord && checkinRecord.lastLeaveStartedAt ? formatDateTime(checkinRecord.lastLeaveStartedAt) : null,
      lastReturnedAt: checkinRecord && checkinRecord.lastReturnedAt ? formatDateTime(checkinRecord.lastReturnedAt) : null,
      actualUsageMinutes,
      finalResult: "completed"
    });

    await deleteReservationSlots(connection, reservation.id);

    await connection.commit();

    return {
      reservationNo,
      seatId: reservation.seatId,
      status: "completed",
      message: "签退成功"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function startLeaveByReservationNo(input, rules) {
  const studentNo = requireStudentNo(input.studentNo);
  const reservationNo = input.reservationNo;

  await syncReservationStates(rules);

  const { user, reservation } = await getReservationByNoForUser(studentNo, reservationNo);

  if (!user) {
    throw buildError("未找到对应用户", 404, "USER_NOT_FOUND");
  }

  if (!reservation) {
    throw buildError("未找到对应预约记录", 404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status !== "checked_in") {
    throw buildError("当前预约状态不允许暂离", 400, "RESERVATION_LEAVE_NOT_ALLOWED");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const checkinRecord = await getCheckinRecord(connection, reservation.id);
    if (!checkinRecord) {
      throw buildError("签到记录不存在，无法暂离", 400, "CHECKIN_RECORD_NOT_FOUND");
    }

    const openLeave = await getOpenLeaveRecord(connection, reservation.id);
    if (openLeave) {
      throw buildError("当前已有未结束的暂离记录", 400, "RESERVATION_LEAVE_ALREADY_OPEN");
    }

    const leaveCount = Number(checkinRecord.leaveCount || 0);
    const totalLeaveMinutes = Number(checkinRecord.totalLeaveMinutes || 0);

    if (leaveCount >= rules.maxLeaveTimes) {
      throw buildError("已达到暂离次数上限", 400, "RESERVATION_LEAVE_COUNT_LIMIT");
    }

    if (totalLeaveMinutes >= rules.maxLeaveMinutesTotal) {
      throw buildError("已达到累计暂离时长上限", 400, "RESERVATION_LEAVE_TOTAL_LIMIT");
    }

    const now = new Date();
    const deadline = addMinutes(now, rules.maxLeaveMinutesEach);
    const leaveSeq = leaveCount + 1;

    await connection.execute(
      `
        INSERT INTO reservation_leave_record (
          reservation_id,
          leave_seq,
          leave_started_at,
          leave_deadline_at
        ) VALUES (?, ?, NOW(), ?)
      `,
      [reservation.id, leaveSeq, formatDateTime(deadline)]
    );

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: getPersistedCheckinType(checkinRecord),
      firstCheckinAt: checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : formatDateTime(now),
      leaveCount: leaveSeq,
      totalLeaveMinutes,
      lastLeaveStartedAt: formatDateTime(now),
      lastReturnedAt: checkinRecord.lastReturnedAt ? formatDateTime(checkinRecord.lastReturnedAt) : null,
      actualUsageMinutes: Number(checkinRecord.actualUsageMinutes || 0),
      finalResult: "reserved"
    });

    await connection.execute(
      `
        UPDATE seat_reservation
        SET status = 'temporary_leave'
        WHERE id = ?
      `,
      [reservation.id]
    );

    await connection.commit();

    return {
      reservationNo,
      status: "temporary_leave",
      leaveDeadlineAt: formatDateTime(deadline),
      message: "已开始暂离"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function returnLeaveByReservationNo(input, rules) {
  const studentNo = requireStudentNo(input.studentNo);
  const reservationNo = input.reservationNo;

  await syncReservationStates(rules);

  const { user, reservation } = await getReservationByNoForUser(studentNo, reservationNo);

  if (!user) {
    throw buildError("未找到对应用户", 404, "USER_NOT_FOUND");
  }

  if (!reservation) {
    throw buildError("未找到对应预约记录", 404, "RESERVATION_NOT_FOUND");
  }

  if (reservation.status !== "temporary_leave") {
    throw buildError("当前预约状态不允许返回座位", 400, "RESERVATION_RETURN_NOT_ALLOWED");
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();

    const checkinRecord = await getCheckinRecord(connection, reservation.id);
    const openLeave = await getOpenLeaveRecord(connection, reservation.id);

    if (!checkinRecord || !openLeave) {
      throw buildError("未找到待返座的暂离记录", 400, "RESERVATION_OPEN_LEAVE_NOT_FOUND");
    }

    const now = new Date();
    const leaveStartedAt = new Date(openLeave.leaveStartedAt);
    const leaveDeadlineAt = new Date(openLeave.leaveDeadlineAt);
    const leaveMinutes = calcDiffMinutes(leaveStartedAt, now);
    const nextTotalLeaveMinutes = Number(checkinRecord.totalLeaveMinutes || 0) + leaveMinutes;
    const isTimeout = now > leaveDeadlineAt || nextTotalLeaveMinutes > rules.maxLeaveMinutesTotal;

    await connection.execute(
      `
        UPDATE reservation_leave_record
        SET
          returned_at = NOW(),
          leave_minutes = ?,
          is_timeout = ?
        WHERE id = ?
      `,
      [leaveMinutes, isTimeout ? 1 : 0, openLeave.id]
    );

    if (isTimeout) {
      const firstCheckinAt = checkinRecord.firstCheckinAt ? new Date(checkinRecord.firstCheckinAt) : now;
      const actualUsageMinutes = Math.max(0, calcDiffMinutes(firstCheckinAt, now) - nextTotalLeaveMinutes);

      await upsertCheckinRecord(connection, {
        reservationId: reservation.id,
        checkinType: getPersistedCheckinType(checkinRecord),
        firstCheckinAt: checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : formatDateTime(now),
        checkoutType: "auto",
        checkoutAt: formatDateTime(now),
        leaveCount: Number(checkinRecord.leaveCount || 0),
        totalLeaveMinutes: nextTotalLeaveMinutes,
        lastLeaveStartedAt: checkinRecord.lastLeaveStartedAt ? formatDateTime(checkinRecord.lastLeaveStartedAt) : null,
        lastReturnedAt: formatDateTime(now),
        actualUsageMinutes,
        finalResult: "leave_timeout"
      });

      await connection.execute(
        `
          UPDATE seat_reservation
          SET
            status = 'violation',
            violation_type = 'leave_timeout',
            violation_at = NOW(),
            checkout_at = NOW()
          WHERE id = ?
        `,
        [reservation.id]
      );

      await deleteReservationSlots(connection, reservation.id);
      await applyPenalty(connection, user, reservation.id, rules.penalties.leaveTimeout, "暂离超时", rules);

      await connection.commit();

      return {
        reservationNo,
        seatId: reservation.seatId,
        status: "violation",
        message: "暂离超时，已记为违约"
      };
    }

    await upsertCheckinRecord(connection, {
      reservationId: reservation.id,
      checkinType: getPersistedCheckinType(checkinRecord),
      firstCheckinAt: checkinRecord.firstCheckinAt ? formatDateTime(checkinRecord.firstCheckinAt) : formatDateTime(now),
      leaveCount: Number(checkinRecord.leaveCount || 0),
      totalLeaveMinutes: nextTotalLeaveMinutes,
      lastLeaveStartedAt: checkinRecord.lastLeaveStartedAt ? formatDateTime(checkinRecord.lastLeaveStartedAt) : null,
      lastReturnedAt: formatDateTime(now),
      actualUsageMinutes: Number(checkinRecord.actualUsageMinutes || 0),
      finalResult: "reserved"
    });

    await connection.execute(
      `
        UPDATE seat_reservation
        SET status = 'checked_in'
        WHERE id = ?
      `,
      [reservation.id]
    );

    await connection.commit();

    return {
      reservationNo,
      seatId: reservation.seatId,
      status: "checked_in",
      message: "返回座位成功"
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ACTIVE_STATUSES: CURRENT_STATUSES,
  HISTORY_STATUSES,
  findUserByStudentNo,
  findSeatBySeatCode,
  syncReservationStates,
  getReservationValidationContext,
  validateReservationInput,
  listReservationsByStudentNo,
  createReservation,
  cancelReservationByNo,
  getReservationByNoForUser,
  checkinReservationByNo,
  checkoutReservationByNo,
  startLeaveByReservationNo,
  returnLeaveByReservationNo
};
