-- Development only: fills the database with synthetic history, to look at query plans
-- and timings on a table of realistic size (see docs/database.md).
--
--   mysql -u root -p library_seat_reservation < sql/dev/generate_history.sql
--
-- Creates 5,000 readers ("HIST...") and 1,000,000 finished reservations spread over
-- the last 365 days. Remove everything again with sql/dev/remove_history.sql.

SET SESSION cte_max_recursion_depth = 1000000;

INSERT IGNORE INTO app_user (student_no, real_name, role, status)
WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
SELECT CONCAT('HIST', LPAD(i, 6, '0')), CONCAT('History reader ', i), 'reader', 'active' FROM n;

SET @first_user := (SELECT MIN(id) FROM app_user WHERE student_no LIKE 'HIST%');
SET @seat_count := (SELECT COUNT(*) FROM library_seat);

INSERT INTO seat_reservation
  (reservation_no, user_id, seat_id, zone_id, floor_no, reservation_date, start_time, end_time,
   duration_minutes, source, status, checkin_open_at, checkin_deadline_at, checked_in_at)
WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000000),
picked AS (
  SELECT
    i,
    @first_user + FLOOR(RAND(i) * 5000)                   AS user_id,
    1 + FLOOR(RAND(i + 1000000) * @seat_count)            AS seat_rank,
    CURRENT_DATE - INTERVAL (2 + FLOOR(RAND(i + 2000000) * 365)) DAY AS reservation_date,
    8 * 60 + 5 * FLOOR(RAND(i + 3000000) * 120)           AS start_minute,   -- 08:00 .. 17:55
    30 + 5 * FLOOR(RAND(i + 4000000) * 43)                AS duration,       -- 30 .. 240 minutes
    RAND(i + 5000000)                                     AS status_draw
  FROM n
),
seats AS (
  SELECT id, zone_id, floor_no, ROW_NUMBER() OVER (ORDER BY id) AS seat_rank FROM library_seat
)
SELECT
  CONCAT('HIST', LPAD(p.i, 10, '0')),
  p.user_id,
  s.id,
  s.zone_id,
  s.floor_no,
  p.reservation_date,
  SEC_TO_TIME(p.start_minute * 60),
  SEC_TO_TIME((p.start_minute + p.duration) * 60),
  p.duration,
  'mini_program',
  CASE WHEN p.status_draw < 0.85 THEN 'completed'
       WHEN p.status_draw < 0.93 THEN 'cancelled'
       WHEN p.status_draw < 0.98 THEN 'no_show'
       ELSE 'violation' END,
  TIMESTAMP(p.reservation_date, SEC_TO_TIME(p.start_minute * 60)) - INTERVAL 10 MINUTE,
  TIMESTAMP(p.reservation_date, SEC_TO_TIME(p.start_minute * 60)) + INTERVAL 15 MINUTE,
  CASE WHEN p.status_draw < 0.85 THEN TIMESTAMP(p.reservation_date, SEC_TO_TIME(p.start_minute * 60)) END
FROM picked p
INNER JOIN seats s ON s.seat_rank = p.seat_rank;

ANALYZE TABLE seat_reservation;
