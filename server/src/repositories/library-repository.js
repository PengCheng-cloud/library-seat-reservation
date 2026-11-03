const { query } = require("../lib/db");

function parseJsonField(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function buildSeatSearchText(seat) {
  return [
    seat.seatId,
    seat.zoneCode,
    seat.zoneDisplayName,
    seat.rawTagsText || "",
    (seat.rawTags || []).join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function mapZoneRow(row) {
  return {
    id: row.id,
    zoneCode: row.zoneCode,
    displayName: row.displayName,
    band: row.band,
    floor: row.floorNo,
    floorNo: row.floorNo,
    gridLetter: row.gridLetter,
    gridNumber: row.gridNumber,
    seatCount: row.seatCount,
    tableGroupCount: row.tableGroupCount,
    annotationStatus: row.annotationStatus,
    sortOrder: row.sortOrder,
    isEnabled: Boolean(row.isEnabled)
  };
}

function mapSeatRow(row) {
  const seat = {
    id: row.id,
    seatId: row.seatCode,
    seatCode: row.seatCode,
    floor: row.floorNo,
    floorNo: row.floorNo,
    zoneCode: row.zoneCode,
    zoneDisplayName: row.zoneDisplayName,
    zoneBand: row.zoneBand,
    tableCode: row.tableCode,
    tableGroupCode: row.tableGroupCode,
    seatSeq: row.seatSeq,
    seatSeqLabel: row.seatSeqLabel,
    qrToken: row.qrToken,
    seatType: row.seatType,
    seatCapacity: row.seatCapacity,
    seatStatus: row.seatStatus,
    hasPower: Boolean(row.hasPower),
    nearWindow: Boolean(row.nearWindow),
    quietLevel: row.quietLevel,
    nearRestroom: Boolean(row.nearRestroom),
    nearPantry: Boolean(row.nearPantry),
    nearAC: Boolean(row.nearAC),
    nearBookshelf: Boolean(row.nearBookshelf),
    nearCorridor: Boolean(row.nearCorridor),
    sunlight: row.sunlight,
    rawTagsText: row.rawTagsText,
    rawTags: parseJsonField(row.rawTagsJson, []),
    tagKeys: parseJsonField(row.tagKeysJson, []),
    specificLocation: row.specificLocation,
    gridLetter: row.gridLetter,
    gridNumber: row.gridNumber
  };

  seat.searchText = buildSeatSearchText(seat);
  return seat;
}

async function listZonesFromDb() {
  const [rows] = await query(
    `
      SELECT
        id,
        zone_code AS zoneCode,
        floor_no AS floorNo,
        grid_letter AS gridLetter,
        grid_number AS gridNumber,
        zone_band AS band,
        display_name AS displayName,
        seat_count AS seatCount,
        table_group_count AS tableGroupCount,
        annotation_status AS annotationStatus,
        sort_order AS sortOrder,
        is_enabled AS isEnabled
      FROM library_zone
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, id ASC
    `
  );

  return rows.map(mapZoneRow);
}

async function listSeatsFromDb() {
  const [rows] = await query(
    `
      SELECT
        s.id,
        s.seat_code AS seatCode,
        s.floor_no AS floorNo,
        s.table_code AS tableCode,
        s.table_group_code AS tableGroupCode,
        s.seat_seq AS seatSeq,
        s.seat_seq_label AS seatSeqLabel,
        s.qr_token AS qrToken,
        s.seat_type AS seatType,
        s.seat_capacity AS seatCapacity,
        s.seat_status AS seatStatus,
        s.has_power AS hasPower,
        s.near_window AS nearWindow,
        s.quiet_level AS quietLevel,
        s.near_restroom AS nearRestroom,
        s.near_pantry AS nearPantry,
        s.near_ac AS nearAC,
        s.near_bookshelf AS nearBookshelf,
        s.near_corridor AS nearCorridor,
        s.sunlight AS sunlight,
        s.raw_tags_text AS rawTagsText,
        s.raw_tags_json AS rawTagsJson,
        s.tag_keys_json AS tagKeysJson,
        s.specific_location AS specificLocation,
        z.zone_code AS zoneCode,
        z.display_name AS zoneDisplayName,
        z.zone_band AS zoneBand,
        z.grid_letter AS gridLetter,
        z.grid_number AS gridNumber
      FROM library_seat s
      INNER JOIN library_zone z ON s.zone_id = z.id
      WHERE z.is_enabled = 1
      ORDER BY s.sort_order ASC, s.id ASC
    `
  );

  return rows.map(mapSeatRow);
}

module.exports = {
  listZonesFromDb,
  listSeatsFromDb
};
