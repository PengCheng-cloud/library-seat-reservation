// Small benchmark for the booking transaction. Needs MySQL with schema and seed data.
//
//   npm run bench:booking
//
// Part 1 (contention): many readers book the same seat and time, several rounds.
//   Shows how the losing requests are answered.
// Part 2 (throughput): readers book different seats, at several levels of concurrency.
//   Shows bookings per second and the latency of a single booking.
//
// The script creates its own readers ("BENCH...") and removes what it created.

require("dotenv").config();

const { performance } = require("perf_hooks");
const { getPool, closePool } = require("../lib/db");
const { getActiveRules } = require("../lib/rule-config");
const { createReservation } = require("../repositories/reservation-repository");

const READERS = Number(process.env.BENCH_READERS || 200);
const CONTENTION_READERS = Number(process.env.BENCH_CONTENTION_READERS || 20);
const CONTENTION_ROUNDS = Number(process.env.BENCH_CONTENTION_ROUNDS || 50);
const PREFIX = "BENCH";

const readerNo = (index) => `${PREFIX}${String(index).padStart(5, "0")}`;

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function cleanReservations(pool) {
  await pool.query(
    "DELETE r FROM seat_reservation r INNER JOIN app_user u ON u.id = r.user_id WHERE u.student_no LIKE ?",
    [`${PREFIX}%`]
  );
}

async function main() {
  const pool = getPool();
  const rules = await getActiveRules();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const reservationDate = formatDate(tomorrow);

  await cleanReservations(pool);
  const values = Array.from({ length: READERS }, (_, index) => [readerNo(index), `Benchmark ${index}`, "reader", "active"]);
  await pool.query("INSERT IGNORE INTO app_user (student_no, real_name, role, status) VALUES ?", [values]);

  const [seatRows] = await pool.query(
    `
      SELECT s.seat_code AS seatCode
      FROM library_seat s
      WHERE s.seat_status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM seat_reservation r
          WHERE r.seat_id = s.id AND r.reservation_date = ?
            AND r.status IN ('reserved', 'checked_in', 'temporary_leave')
        )
      ORDER BY s.id
      LIMIT ?
    `,
    [reservationDate, READERS]
  );
  const seats = seatRows.map((row) => row.seatCode);

  const book = (reader, seatCode) =>
    createReservation({ studentNo: readerNo(reader), seatId: seatCode, reservationDate, startTime: "10:00", endTime: "12:00" }, rules);

  // ---- Part 1: contention on one seat ----
  const tally = {};
  let roundsWithExactlyOneWinner = 0;
  for (let round = 0; round < CONTENTION_ROUNDS; round += 1) {
    await cleanReservations(pool);
    const results = await Promise.allSettled(
      Array.from({ length: CONTENTION_READERS }, (_, reader) => book(reader, seats[round % seats.length]))
    );
    let winners = 0;
    for (const result of results) {
      const key = result.status === "fulfilled" ? "accepted" : result.reason.code || "other error";
      tally[key] = (tally[key] || 0) + 1;
      if (result.status === "fulfilled") {
        winners += 1;
      }
    }
    if (winners === 1) {
      roundsWithExactlyOneWinner += 1;
    }
  }
  console.log(`Contention: ${CONTENTION_READERS} readers, same seat and time, ${CONTENTION_ROUNDS} rounds`);
  console.log(`  rounds with exactly one accepted booking: ${roundsWithExactlyOneWinner}/${CONTENTION_ROUNDS}`);
  for (const [key, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(34)} ${count}`);
  }

  // ---- Part 2: throughput on different seats ----
  console.log(`\nThroughput: ${READERS} bookings on ${READERS} different seats`);
  console.log("  concurrency   bookings/s   p50 ms   p95 ms   failed");
  for (const concurrency of [1, 4, 8, 16, 32]) {
    await cleanReservations(pool);
    const latencies = [];
    let failed = 0;
    let next = 0;
    const startedAt = performance.now();
    const worker = async () => {
      while (next < READERS) {
        const index = next;
        next += 1;
        const t0 = performance.now();
        try {
          await book(index, seats[index]);
        } catch (error) {
          failed += 1;
        }
        latencies.push(performance.now() - t0);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    const seconds = (performance.now() - startedAt) / 1000;
    latencies.sort((a, b) => a - b);
    console.log(
      `  ${String(concurrency).padStart(11)}   ${(READERS / seconds).toFixed(0).padStart(10)}   ${percentile(latencies, 50).toFixed(1).padStart(6)}   ${percentile(latencies, 95).toFixed(1).padStart(6)}   ${String(failed).padStart(6)}`
    );
  }

  await cleanReservations(pool);
  await pool.query("DELETE FROM app_user WHERE student_no LIKE ?", [`${PREFIX}%`]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
