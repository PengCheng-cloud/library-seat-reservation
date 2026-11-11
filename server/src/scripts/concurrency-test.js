// Concurrency tests for seat reservations. They need a running MySQL database with
// the schema and the seed data, but no HTTP server:
//
//   npm run test:concurrency
//
// The tests call the reservation code directly, with many requests at the same
// moment, and then check the state of the database. They create their own readers
// (student numbers starting with "CONC") and remove everything they created.

require("dotenv").config();

const assert = require("assert/strict");
const { getPool, closePool } = require("../lib/db");
const { getActiveRules } = require("../lib/rule-config");
const { buildSlots, isAlignedToSlot, SLOT_MINUTES } = require("../lib/reservation-slots");
const {
  createReservation,
  cancelReservationByNo
} = require("../repositories/reservation-repository");

const READER_COUNT = Number(process.env.CONCURRENCY_READERS || 30);
const READER_PREFIX = "CONC";

function readerNo(index) {
  return `${READER_PREFIX}${String(index).padStart(4, "0")}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// Runs all requests at the same moment and sorts the answers by error code.
async function runTogether(requests) {
  const results = await Promise.allSettled(requests.map((request) => request()));
  const tally = {};
  const succeeded = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      tally.OK = (tally.OK || 0) + 1;
      succeeded.push(result.value);
    } else {
      const key = result.reason.code || `UNEXPECTED: ${result.reason.message}`;
      tally[key] = (tally[key] || 0) + 1;
    }
  }

  return { tally, succeeded };
}

// Answers that mean "this booking lost against another one". Anything else is a bug.
const EXPECTED_REJECTIONS = new Set([
  "RESERVATION_SEAT_TIME_CONFLICT",
  "RESERVATION_VALIDATION_FAILED",
  "RESERVATION_ACTIVE_LIMIT",
  "RESERVATION_DAILY_LIMIT",
  "USER_RESERVATION_TIME_CONFLICT",
  "RESERVATION_CONFLICT"
]);

function assertOnlyExpectedRejections(tally) {
  for (const key of Object.keys(tally)) {
    assert.ok(key === "OK" || EXPECTED_REJECTIONS.has(key), `unexpected answer: ${key} (${tally[key]} times)`);
  }
}

async function removeTestReservations(pool) {
  // The slots go with the reservations (ON DELETE CASCADE).
  await pool.query(
    "DELETE r FROM seat_reservation r INNER JOIN app_user u ON u.id = r.user_id WHERE u.student_no LIKE ?",
    [`${READER_PREFIX}%`]
  );
}

async function countOverlappingPairs(pool, reservationDate) {
  const [rows] = await pool.query(
    `
      SELECT COUNT(*) AS pairs
      FROM seat_reservation a
      INNER JOIN seat_reservation b
        ON b.seat_id = a.seat_id
       AND b.reservation_date = a.reservation_date
       AND b.id > a.id
       AND b.start_time < a.end_time
       AND b.end_time > a.start_time
      WHERE a.reservation_date = ?
        AND a.status IN ('reserved', 'checked_in', 'temporary_leave')
        AND b.status IN ('reserved', 'checked_in', 'temporary_leave')
    `,
    [reservationDate]
  );

  return Number(rows[0].pairs);
}

async function main() {
  const pool = getPool();
  const rules = await getActiveRules();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const reservationDate = formatDate(tomorrow);

  await removeTestReservations(pool);
  for (let index = 0; index < READER_COUNT; index += 1) {
    await pool.query(
      "INSERT IGNORE INTO app_user (student_no, real_name, role, status) VALUES (?, ?, 'reader', 'active')",
      [readerNo(index), `Concurrency test ${index}`]
    );
  }

  // Seats without any active reservation on the test day.
  const [seatRows] = await pool.query(
    `
      SELECT s.id, s.seat_code AS seatCode
      FROM library_seat s
      WHERE s.seat_status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM seat_reservation r
          WHERE r.seat_id = s.id
            AND r.reservation_date = ?
            AND r.status IN ('reserved', 'checked_in', 'temporary_leave')
        )
      ORDER BY s.id
      LIMIT ?
    `,
    [reservationDate, READER_COUNT + 5]
  );
  assert.ok(seatRows.length >= READER_COUNT + 5, "not enough free seats in the seed data");
  const seats = seatRows.map((row) => row.seatCode);

  const book = (reader, seatCode, startTime, endTime) => () =>
    createReservation({ studentNo: readerNo(reader), seatId: seatCode, reservationDate, startTime, endTime }, rules);

  let passed = 0;
  const test = async (name, body) => {
    await removeTestReservations(pool);
    await body();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  };

  await test("slot helper covers a half-open interval on the 5-minute grid", async () => {
    assert.equal(SLOT_MINUTES, 5);
    assert.deepEqual(buildSlots("09:00", "09:10"), [
      { slotStart: "09:00:00", slotEnd: "09:05:00" },
      { slotStart: "09:05:00", slotEnd: "09:10:00" }
    ]);
    assert.equal(buildSlots("09:00", "13:00").length, 48);
    assert.equal(buildSlots("09:02", "09:08").length, 2);
    assert.equal(buildSlots("10:00", "10:00").length, 0);
    assert.equal(isAlignedToSlot("09:05"), true);
    assert.equal(isAlignedToSlot("09:07"), false);
  });

  await test(`${READER_COUNT} readers book the same seat and time: exactly one wins`, async () => {
    const { tally } = await runTogether(
      Array.from({ length: READER_COUNT }, (_, reader) => book(reader, seats[0], "10:00", "12:00"))
    );
    assertOnlyExpectedRejections(tally);
    assert.equal(tally.OK, 1, JSON.stringify(tally));
    assert.equal(await countOverlappingPairs(pool, reservationDate), 0);
    const [slotRows] = await pool.query(
      "SELECT COUNT(*) AS slots FROM seat_reservation_slot s INNER JOIN library_seat l ON l.id = s.seat_id WHERE l.seat_code = ? AND s.reservation_date = ?",
      [seats[0], reservationDate]
    );
    assert.equal(Number(slotRows[0].slots), 24, "a 2-hour reservation occupies 24 slots");
  });

  await test("random overlapping intervals on one seat never overlap in the database", async () => {
    for (let round = 0; round < 5; round += 1) {
      await removeTestReservations(pool);
      const requests = Array.from({ length: READER_COUNT }, (_, reader) => {
        const start = 8 * 60 + SLOT_MINUTES * Math.floor(Math.random() * 60); // 08:00 .. 12:55
        const duration = 30 + SLOT_MINUTES * Math.floor(Math.random() * 30); // 30 .. 175 minutes
        return book(reader, seats[1], minutesToTime(start), minutesToTime(start + duration));
      });
      const { tally } = await runTogether(requests);
      assertOnlyExpectedRejections(tally);
      assert.ok(tally.OK >= 1);
      assert.equal(await countOverlappingPairs(pool, reservationDate), 0);

      const [rows] = await pool.query(
        `
          SELECT
            (SELECT COALESCE(SUM(r.duration_minutes), 0) FROM seat_reservation r
              INNER JOIN app_user u ON u.id = r.user_id WHERE u.student_no LIKE ?) AS bookedMinutes,
            (SELECT COUNT(*) FROM seat_reservation_slot s
              INNER JOIN seat_reservation r ON r.id = s.reservation_id
              INNER JOIN app_user u ON u.id = r.user_id WHERE u.student_no LIKE ?) AS slots
        `,
        [`${READER_PREFIX}%`, `${READER_PREFIX}%`]
      );
      assert.equal(Number(rows[0].slots) * SLOT_MINUTES, Number(rows[0].bookedMinutes), "slots match the booked time");
    }
  });

  await test("different seats at the same time do not block each other", async () => {
    const { tally } = await runTogether(
      Array.from({ length: READER_COUNT }, (_, reader) => book(reader, seats[reader + 2], "14:00", "16:00"))
    );
    assert.deepEqual(tally, { OK: READER_COUNT });
  });

  await test("one reader books many seats at once: the limit of active reservations holds", async () => {
    const { tally } = await runTogether(
      Array.from({ length: READER_COUNT }, (_, index) => book(0, seats[index + 2], "14:00", "16:00"))
    );
    assertOnlyExpectedRejections(tally);
    assert.equal(tally.OK, rules.maxActiveReservations, JSON.stringify(tally));
  });

  await test("back-to-back reservations on one seat are both accepted", async () => {
    const { tally } = await runTogether([
      book(0, seats[0], "10:00", "11:00"),
      book(1, seats[0], "11:00", "12:00")
    ]);
    assert.deepEqual(tally, { OK: 2 });
  });

  await test("times off the 5-minute grid are rejected", async () => {
    const { tally } = await runTogether([book(0, seats[0], "10:02", "11:00")]);
    assert.deepEqual(tally, { RESERVATION_VALIDATION_FAILED: 1 });
  });

  await test("cancelling releases the slots for the next reader", async () => {
    const first = await book(0, seats[0], "10:00", "12:00")();
    await assert.rejects(book(1, seats[0], "11:00", "13:00")(), (error) => EXPECTED_REJECTIONS.has(error.code));
    await cancelReservationByNo({ studentNo: readerNo(0), reservationNo: first.reservationNo }, rules);
    const second = await book(1, seats[0], "11:00", "13:00")();
    assert.equal(second.status, "reserved");
  });

  await test("the unique key rejects an overlapping reservation written past the application checks", async () => {
    const first = await book(0, seats[0], "10:00", "12:00")();
    const [userRows] = await pool.query("SELECT id FROM app_user WHERE student_no = ?", [readerNo(1)]);
    const [seatRow] = await pool.query("SELECT id, zone_id AS zoneId, floor_no AS floorNo FROM library_seat WHERE seat_code = ?", [seats[0]]);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // Deliberately no locks and no conflict check, as a buggy code path would do it.
      const [insert] = await connection.query(
        `
          INSERT INTO seat_reservation
            (reservation_no, user_id, seat_id, zone_id, floor_no, reservation_date, start_time, end_time,
             duration_minutes, source, status, checkin_open_at, checkin_deadline_at)
          VALUES (?, ?, ?, ?, ?, ?, '11:30:00', '12:30:00', 60, 'mini_program', 'reserved', NOW(), NOW())
        `,
        [`${first.reservationNo}X`, userRows[0].id, seatRow[0].id, seatRow[0].zoneId, seatRow[0].floorNo, reservationDate]
      );
      await assert.rejects(
        connection.query(
          "INSERT INTO seat_reservation_slot (reservation_id, seat_id, reservation_date, slot_start, slot_end) VALUES (?, ?, ?, '11:30:00', '11:35:00')",
          [insert.insertId, seatRow[0].id, reservationDate]
        ),
        (error) => error.code === "ER_DUP_ENTRY"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
    assert.equal(await countOverlappingPairs(pool, reservationDate), 0);
  });

  await removeTestReservations(pool);
  await pool.query("DELETE FROM app_user WHERE student_no LIKE ?", [`${READER_PREFIX}%`]);
  console.log(`\n${passed} tests passed (${READER_COUNT} concurrent readers, MySQL at ${process.env.DB_HOST || "127.0.0.1"})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
