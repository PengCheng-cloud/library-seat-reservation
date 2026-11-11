-- Fills `seat_reservation_slot` for the active reservations that already exist.
--
-- New reservations write their slots inside the booking transaction. Run this file
-- once after `004_seed_final_demo_data.sql` (or on an existing database) so that the
-- seeded reservations occupy their slots as well. It can be run again without harm.
--
-- A reservation covers the 5-minute slots of [start_time, end_time). Times that are
-- not on the 5-minute grid are widened to the surrounding slots.

SET NAMES utf8mb4;

USE `library_seat_reservation`;

-- Slots of reservations that are no longer active are released.
DELETE s
FROM `seat_reservation_slot` s
INNER JOIN `seat_reservation` r ON r.id = s.reservation_id
WHERE r.status NOT IN ('reserved', 'checked_in', 'temporary_leave');

INSERT IGNORE INTO `seat_reservation_slot`
  (`reservation_id`, `seat_id`, `reservation_date`, `slot_start`, `slot_end`)
WITH RECURSIVE slot_grid (slot_index) AS (
  SELECT 0
  UNION ALL
  SELECT slot_index + 1 FROM slot_grid WHERE slot_index < 287   -- 288 slots of 5 minutes = 24 hours
)
SELECT
  r.id,
  r.seat_id,
  r.reservation_date,
  SEC_TO_TIME(g.slot_index * 300),
  SEC_TO_TIME((g.slot_index + 1) * 300)
FROM `seat_reservation` r
INNER JOIN slot_grid g
  ON g.slot_index >= FLOOR(TIME_TO_SEC(r.start_time) / 300)
 AND g.slot_index <  CEIL(TIME_TO_SEC(r.end_time) / 300)
WHERE r.status IN ('reserved', 'checked_in', 'temporary_leave');
