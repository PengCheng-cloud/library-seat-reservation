-- Removes the synthetic history created by sql/dev/generate_history.sql.
DELETE FROM seat_reservation WHERE reservation_no LIKE 'HIST%';
DELETE FROM app_user WHERE student_no LIKE 'HIST%';
ANALYZE TABLE seat_reservation;
