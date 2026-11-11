-- Index for queries that select reservations by date only, such as the statistics
-- of the admin dashboard (WHERE reservation_date BETWEEN ? AND ?). Without it these
-- queries read the whole table. Measurements are in docs/database.md.
--
-- Only needed for databases created before this index was added to 001_schema.sql.

USE `library_seat_reservation`;

ALTER TABLE `seat_reservation`
  ADD KEY `idx_seat_reservation_date` (`reservation_date`);
