const { query } = require("../lib/db");

const ACTIVE_STATUSES = ["reserved", "checked_in", "temporary_leave"];

function formatTime(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 5);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

async function listSeatUsageByWindow(options = {}) {
  const reservationDate = String(options.reservationDate || "");
  const startTime = String(options.startTime || "");
  const endTime = String(options.endTime || "");

  if (!isValidDate(reservationDate) || !isValidTime(startTime) || !isValidTime(endTime)) {
    return new Map();
  }

  const [rows] = await query(
    `
      SELECT
        ls.seat_code AS seatId,
        r.reservation_no AS reservationNo,
        r.status,
        r.start_time AS startTime,
        r.end_time AS endTime
      FROM seat_reservation r
      INNER JOIN library_seat ls ON r.seat_id = ls.id
      WHERE r.reservation_date = ?
        AND r.status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
        AND r.start_time < ?
        AND r.end_time > ?
      ORDER BY FIELD(r.status, 'checked_in', 'temporary_leave', 'reserved'), r.start_time ASC, r.id ASC
    `,
    [reservationDate, ...ACTIVE_STATUSES, `${endTime}:00`, `${startTime}:00`]
  );

  const seatUsageMap = new Map();

  rows.forEach((row) => {
    if (seatUsageMap.has(row.seatId)) {
      return;
    }

    seatUsageMap.set(row.seatId, {
      seatId: row.seatId,
      reservationNo: row.reservationNo,
      status: row.status,
      startTime: formatTime(row.startTime),
      endTime: formatTime(row.endTime)
    });
  });

  return seatUsageMap;
}

async function listUserReservationConflictByWindow(options = {}) {
  const studentNo = String(options.studentNo || "").trim();
  const reservationDate = String(options.reservationDate || "");
  const startTime = String(options.startTime || "");
  const endTime = String(options.endTime || "");

  if (!studentNo || !isValidDate(reservationDate) || !isValidTime(startTime) || !isValidTime(endTime)) {
    return null;
  }

  const [rows] = await query(
    `
      SELECT
        r.reservation_no AS reservationNo,
        r.status,
        r.start_time AS startTime,
        r.end_time AS endTime,
        ls.seat_code AS seatId,
        lz.zone_code AS zoneCode
      FROM seat_reservation r
      INNER JOIN app_user u ON r.user_id = u.id
      INNER JOIN library_seat ls ON r.seat_id = ls.id
      INNER JOIN library_zone lz ON r.zone_id = lz.id
      WHERE u.student_no = ?
        AND r.reservation_date = ?
        AND r.status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
        AND r.start_time < ?
        AND r.end_time > ?
      ORDER BY FIELD(r.status, 'checked_in', 'temporary_leave', 'reserved'), r.start_time ASC, r.id ASC
      LIMIT 1
    `,
    [studentNo, reservationDate, ...ACTIVE_STATUSES, `${endTime}:00`, `${startTime}:00`]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    reservationNo: rows[0].reservationNo,
    status: rows[0].status,
    startTime: formatTime(rows[0].startTime),
    endTime: formatTime(rows[0].endTime),
    seatId: rows[0].seatId,
    zoneCode: rows[0].zoneCode
  };
}

async function listSeatUsageByDate(options = {}) {
  const seatId = String(options.seatId || "").trim();
  const reservationDate = String(options.reservationDate || "");

  if (!seatId || !isValidDate(reservationDate)) {
    return [];
  }

  const [rows] = await query(
    `
      SELECT
        ls.seat_code AS seatId,
        r.reservation_no AS reservationNo,
        r.status,
        r.start_time AS startTime,
        r.end_time AS endTime
      FROM seat_reservation r
      INNER JOIN library_seat ls ON r.seat_id = ls.id
      WHERE ls.seat_code = ?
        AND r.reservation_date = ?
        AND r.status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
      ORDER BY r.start_time ASC, r.id ASC
    `,
    [seatId, reservationDate, ...ACTIVE_STATUSES]
  );

  return rows.map((row) => ({
    seatId: row.seatId,
    reservationNo: row.reservationNo,
    status: row.status,
    startTime: formatTime(row.startTime),
    endTime: formatTime(row.endTime)
  }));
}

module.exports = {
  listSeatUsageByWindow,
  listUserReservationConflictByWindow,
  listSeatUsageByDate
};
