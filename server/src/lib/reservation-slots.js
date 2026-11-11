// Time slots of a reservation.
//
// Reservation times are aligned to a fixed grid (SLOT_MINUTES). Every active
// reservation occupies one row per slot in `seat_reservation_slot`, and that
// table has a unique key on (seat_id, reservation_date, slot_start). Two active
// reservations that overlap on the same seat would need the same slot row, so
// the database itself rejects a double booking, independently of the checks in
// the application code.

const SLOT_MINUTES = 5;

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ""));
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

function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

// True if the time lies on the slot grid, e.g. 09:00, 09:05, 09:10 for 5-minute slots.
function isAlignedToSlot(time, slotMinutes = SLOT_MINUTES) {
  const minutes = timeToMinutes(time);
  return minutes !== null && minutes % slotMinutes === 0;
}

// Slots covered by the half-open interval [startTime, endTime).
// Returns [{ slotStart: "09:00:00", slotEnd: "09:05:00" }, ...].
// Times that are not on the grid (old data) are widened to the surrounding slots.
function buildSlots(startTime, endTime, slotMinutes = SLOT_MINUTES) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return [];
  }

  const first = Math.floor(startMinutes / slotMinutes) * slotMinutes;
  const last = Math.ceil(endMinutes / slotMinutes) * slotMinutes;
  const slots = [];
  for (let cursor = first; cursor < last; cursor += slotMinutes) {
    slots.push({
      slotStart: minutesToTime(cursor),
      slotEnd: minutesToTime(cursor + slotMinutes)
    });
  }

  return slots;
}

module.exports = {
  SLOT_MINUTES,
  isAlignedToSlot,
  buildSlots
};
