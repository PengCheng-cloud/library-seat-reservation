const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

let cache = null;

function readJson(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function compareSeatIds(left, right) {
  return left.localeCompare(right, "zh-CN", { numeric: true });
}

function compareZones(left, right) {
  const bandOrder = ["north", "west", "east", "south_inner", "south_outer", "inner"];
  const bandDiff = bandOrder.indexOf(left.band) - bandOrder.indexOf(right.band);
  if (bandDiff !== 0) {
    return bandDiff;
  }

  if (left.band === "west" || left.band === "east") {
    return right.gridLetter.localeCompare(left.gridLetter);
  }

  return left.gridNumber - right.gridNumber || left.gridLetter.localeCompare(right.gridLetter);
}

function ensureLoaded() {
  if (cache) {
    return cache;
  }

  const seatMaster = readJson("seat_master.json");
  const zoneTemplate = readJson("seat_zone_template.json");
  const stats = readJson("seat_stats.json");

  const zones = zoneTemplate.zones
    .map((zone) => ({
      ...zone,
      seats: []
    }))
    .sort(compareZones);

  const zoneMap = new Map(zones.map((zone) => [zone.zoneCode, zone]));

  const seats = seatMaster.seats.map((seat) => {
    const record = {
      ...seat,
      seatStatus: "available",
      searchText: [
        seat.seatId,
        seat.zoneCode,
        seat.zoneDisplayName,
        seat.rawTagsText || "",
        (seat.rawTags || []).join(" ")
      ]
        .join(" ")
        .toLowerCase()
    };

    const zone = zoneMap.get(record.zoneCode);
    if (zone) {
      zone.seats.push(record);
    }

    return record;
  });

  const seatMap = new Map(seats.map((seat) => [seat.seatId, seat]));

  cache = {
    seatMaster,
    zoneTemplate,
    stats,
    zones,
    zoneMap,
    seats,
    seatMap
  };

  return cache;
}

function getDataset() {
  return ensureLoaded();
}

function getZones() {
  return ensureLoaded().zones;
}

function getSeats() {
  return ensureLoaded().seats;
}

function getStats() {
  return ensureLoaded().stats;
}

function getZoneByCode(zoneCode) {
  return ensureLoaded().zoneMap.get(zoneCode) || null;
}

function getSeatById(seatId) {
  return ensureLoaded().seatMap.get(seatId) || null;
}

module.exports = {
  compareSeatIds,
  compareZones,
  getDataset,
  getZones,
  getSeats,
  getStats,
  getZoneByCode,
  getSeatById
};
