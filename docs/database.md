# Database: concurrent bookings and query performance

This document describes how the backend keeps reservations correct when many readers
book at the same moment, what was wrong with the first implementation, and what the
measurements look like. Everything here can be reproduced with the scripts in the
repository.

- [The problem](#the-problem)
- [What was wrong with the first version](#what-was-wrong-with-the-first-version)
- [The booking transaction now](#the-booking-transaction-now)
- [The slot table: a guarantee inside the database](#the-slot-table-a-guarantee-inside-the-database)
- [Tests](#tests)
- [Measurements](#measurements)
- [Query plans on one million reservations](#query-plans-on-one-million-reservations)
- [Limits](#limits)

## The problem

Two rules must hold at all times, also when requests arrive at the same moment:

1. A seat has at most one active reservation at any point in time.
2. A reader has at most `max_active_reservations` active reservations (default: 1).

Both rules are of the form "check that something does not exist, then insert". Without
protection two transactions can both pass the check and both insert.

## What was wrong with the first version

The first version locked the reader's row and then ran the conflict check as a locking
read (`SELECT ... FOR UPDATE`) over the existing reservations of the seat, at InnoDB's
default isolation level REPEATABLE READ.

This prevented double bookings, but it had three defects that only show up under load:

**1. Deadlocks, also between bookings of different seats.** When the conflict check finds
no row, InnoDB cannot lock a row, so it locks the *gap* in the index
`(seat_id, reservation_date, start_time)` where a conflicting row would be. Gap locks do
not block each other, so two transactions can hold a lock on the same gap. Each of them
then wants to insert into that gap, each insert waits for the other transaction's gap
lock, and MySQL has to abort one of them (`ER_LOCK_DEADLOCK`). A gap reaches from one
existing index entry to the next. For a day with few reservations it covers many seats,
so the deadlock also hit readers who booked *different* seats.

**2. The aborted booking was reported as an internal error (HTTP 500)**, although nothing
was wrong with the request.

**3. Reservation numbers could collide.** The number was a millisecond timestamp plus
three random digits. Two bookings in the same millisecond had a chance of 1 in 1000 to
draw the same number, hit the unique key on `reservation_no`, and be rejected as a
"conflict" although they were for different seats.

A fourth point was not a bug but a gap: the table `seat_reservation_slot` with its unique
key existed in the schema, but the booking code never wrote to it.

## The booking transaction now

`createReservationInTransaction` in
[`server/src/repositories/reservation-repository.js`](../server/src/repositories/reservation-repository.js):

```
SET TRANSACTION ISOLATION LEVEL READ COMMITTED
START TRANSACTION
  1. SELECT ... FROM app_user     WHERE id = ? FOR UPDATE     -- lock the reader
  2. SELECT ... FROM library_seat WHERE id = ? FOR UPDATE     -- lock the seat
  3. check: seat still available, limits of the reader, time conflicts of reader and seat
  4. INSERT INTO seat_reservation ...
  5. INSERT INTO seat_reservation_slot ...                    -- one row per 5 minutes
COMMIT
```

- **The seat row is the lock for all bookings of that seat.** A second booking of the
  same seat waits at step 2 until the first one has committed. Its checks in step 3 then
  see the first reservation and reject the request with a normal "seat is taken" answer
  (HTTP 409).
- **The reader row does the same for the limits of one reader**, for example one reader
  sending bookings for several seats at once.
- **Fixed lock order.** Every booking locks the reader first and the seat second. Two
  bookings can therefore never wait for each other in a cycle.
- **READ COMMITTED instead of REPEATABLE READ.** The checks in step 3 are plain reads. At
  READ COMMITTED each statement sees everything that was committed before it started,
  which includes the booking that held the seat lock before. InnoDB also takes no gap
  locks for these statements, so bookings of different seats do not touch each other.
- **Retry.** If MySQL still reports a deadlock or a lock wait timeout (other transactions
  such as cancellations also touch these rows), the booking is run again, up to three
  times. A rolled-back transaction has changed nothing, so this is safe. After the last
  attempt the reader gets HTTP 503 "busy, try again" instead of an internal error.
- **Reservation numbers** now use six digits from `crypto.randomInt`, and a collision is
  detected by the name of the violated key and retried with a new number.

## The slot table: a guarantee inside the database

MySQL has no constraint that forbids overlapping time ranges (PostgreSQL has exclusion
constraints for this). The usual way to get a guarantee from the database itself is to
cut time into slots:

- Reservation times lie on a 5-minute grid (`09:00`, `09:05`, ...). The validation rejects
  other times.
- Every active reservation has one row per slot in `seat_reservation_slot`.
- `UNIQUE (seat_id, reservation_date, slot_start)`.

Two overlapping active reservations of one seat would both need the row of a shared slot,
and the second insert fails. This holds for *any* code that writes reservations, also for
code that forgets the locks. The locks in the transaction remain the normal mechanism,
because they give a clean answer; the unique key is the last line of defence.

The slots are written in the booking transaction and deleted in the same transaction that
ends a reservation (cancel, check-out, no-show, timeout, release by an admin), so the
table only holds the slots of active reservations. `sql/006_backfill_reservation_slots.sql`
fills it for reservations that existed before.

The cost is one multi-row insert per booking (24 rows for two hours).

## Tests

`npm run test:concurrency` (in `server/`, needs MySQL with schema and seed data) calls the
booking code directly with many requests at once and then inspects the database:

| Test | Expectation |
|---|---|
| 30 readers book the same seat and time | exactly one booking, 29 clean rejections, no other error |
| 30 readers book random overlapping intervals on one seat (5 rounds) | no two active reservations overlap; number of slot rows × 5 = booked minutes |
| 30 readers book 30 different seats at the same time | all 30 succeed |
| one reader books 30 seats at once | exactly `max_active_reservations` succeed |
| two back-to-back reservations (10:00–11:00, 11:00–12:00) | both succeed |
| a time off the 5-minute grid | rejected by validation |
| cancel, then another reader books the same time | succeeds, the slots were released |
| an overlapping reservation written directly with SQL, without locks or checks | rejected by the unique key (`ER_DUP_ENTRY`) |

## Measurements

Environment: MySQL 8.0.46 and Node.js 22 on the same machine (2 virtual CPUs, 7 GB RAM,
Linux container), InnoDB buffer pool 128 MB (default), connection pool of 10, table
`seat_reservation` filled with one million finished reservations. The numbers come from
one run of `npm run bench:booking` on the old and on the new code; they vary by a few
percent between runs. They are meant for comparing the two versions on the same machine,
not as absolute performance figures.

**Different seats: 200 readers book 200 different seats.** No request competes for a seat
here, so every booking should succeed.

| Concurrent requests | Before: failed | After: failed | After: bookings/s | After: p50 | After: p95 |
|---:|---:|---:|---:|---:|---:|
| 1 | 0 of 200 | 0 of 200 | 202 | 4.6 ms | 7.3 ms |
| 4 | 82 of 200 | 0 of 200 | 329 | 11.2 ms | 20.4 ms |
| 8 | 133 of 200 | 0 of 200 | 380 | 20.5 ms | 32.4 ms |
| 16 | 149 of 200 | 0 of 200 | 364 | 42.1 ms | 63.2 ms |
| 32 | 158 of 200 | 0 of 200 | 379 | 80.2 ms | 115.1 ms |

Before the change, most bookings failed as soon as requests ran in parallel. In a separate
run with 8 parallel requests, all 118 failures were `ER_LOCK_DEADLOCK`.

**Same seat: 20 readers book the same seat and time, 50 rounds (1,000 requests).**

| Answer | Before | After |
|---|---:|---:|
| accepted | 50 | 50 |
| rejected: seat is taken | 927 | 950 |
| failed with `ER_LOCK_DEADLOCK` (HTTP 500) | 23 | 0 |

In both versions exactly one reader got the seat in every round, so the first version did
not produce double bookings. Its problem was the failed requests.

**Cost.** With one request at a time the new transaction is slower: 202 instead of 254
bookings per second (p50 4.6 ms instead of 3.7 ms). It runs one more locking read and
inserts the slot rows. I consider this an acceptable price for correct behaviour under
load.

Throughput stops growing at about 8 parallel requests. The machine has two cores shared
by MySQL and Node.js, and every booking runs about twenty statements (validation, state
synchronisation, transaction); I did not analyse this limit further.

## Query plans on one million reservations

A table with a few demo rows says nothing about indexes. `sql/dev/generate_history.sql`
creates 5,000 readers and 1,000,000 finished reservations over the last 365 days. With
this data I looked at the plans (`EXPLAIN ANALYZE`) of the queries that run for every
request.

| Query | Index used | Time |
|---|---|---:|
| conflict check for one seat and day | `idx_seat_reservation_seat_date (seat_id, reservation_date, start_time)` | < 0.1 ms |
| active reservations of one reader | `idx_seat_reservation_status_date`, then filter on reader | 0.1 ms |
| occupied seats for a day and time window | `idx_seat_reservation_status_date (status, reservation_date)` | < 0.1 ms |
| overdue check-ins (state synchronisation) | `idx_seat_reservation_status_date` | < 0.1 ms |
| **statistics of the admin dashboard** (`WHERE reservation_date BETWEEN ? AND ?`) | **none: full table scan** | **about 300 ms** |

The queries of the booking path only touch active reservations, and there are few of
those however long the history is. The statistics query was the weak point: no index
started with `reservation_date`, so it read all one million rows for any date range.

Fix: `KEY idx_seat_reservation_date (reservation_date)`
(`sql/007_add_reservation_date_index.sql`). Best of five runs:

| Date range | Before | After |
|---|---:|---:|
| 1 day | 301 ms | 0.3 ms |
| 7 days | 296 ms | 25 ms |
| 30 days | 325 ms | 123 ms |
| 90 days | 404 ms | 389 ms |

The index helps most for short ranges. For 30 days the query still has to fetch about
80,000 rows through the index, one by one, because the query needs columns that are not
in the index. For 90 days this is no faster than reading the table. If long ranges become
important, the next steps would be a covering index or a small table of daily totals that
is updated when a reservation ends.

## Limits

- The measurements were taken on a small shared machine, with client and database on the
  same host and synthetic data. They show the difference between the two versions, not
  what a production server would reach.
- The slot grid is fixed at five minutes in `server/src/lib/reservation-slots.js`.
  Changing it means rebuilding the slot table.
- The synthetic history is uniformly random. Real usage has peaks (exam weeks, popular
  zones), which the data does not model.
- Only the booking transaction retries on deadlocks. The other transactions (cancel,
  check-in, leave, check-out) answer HTTP 503 in that case.
