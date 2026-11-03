function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function getOffsetDate(offsetDays) {
  const next = new Date();
  next.setDate(next.getDate() + offsetDays);
  return formatDate(next);
}

module.exports = {
  formatDate,
  getOffsetDate
};
