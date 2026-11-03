const { query } = require("../lib/db");

function formatDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getHomeSummaryFromDb() {
  const [rows] = await query(
    `
      SELECT
        (SELECT COUNT(*) FROM library_seat) AS seatCount,
        (SELECT COUNT(*) FROM library_zone WHERE is_enabled = 1) AS zoneCount,
        (SELECT COUNT(DISTINCT table_group_code) FROM library_seat) AS tableGroupCount,
        (SELECT COUNT(*) FROM library_seat WHERE quiet_level = '安静') AS quietSeatCount,
        (SELECT COUNT(*) FROM library_seat WHERE has_power = 1) AS poweredSeatCount
    `
  );

  return rows[0];
}

async function listPublishedNoticesFromDb(limit = 5) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 50));
  const [rows] = await query(
    `
      SELECT
        id,
        title,
        content,
        notice_type AS noticeType,
        publish_at AS publishAt
      FROM system_notice
      WHERE status = 'published'
        AND audience IN ('all', 'reader')
        AND (publish_at IS NULL OR publish_at <= NOW())
        AND (expire_at IS NULL OR expire_at >= NOW())
      ORDER BY COALESCE(publish_at, created_at) DESC, id DESC
      LIMIT ${safeLimit}
    `
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    noticeType: row.noticeType,
    publishDate: formatDate(row.publishAt) || ""
  }));
}

async function listHotZonesFromDb(limit = 6) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 10));
  const [rows] = await query(
    `
      SELECT
        z.zone_code AS zoneCode,
        z.display_name AS displayName,
        z.zone_band AS band,
        z.grid_letter AS gridLetter,
        z.grid_number AS gridNumber,
        z.seat_count AS seatCount,
        z.table_group_count AS tableGroupCount,
        SUM(CASE WHEN s.quiet_level = '安静' THEN 1 ELSE 0 END) AS quietSeatCount
      FROM library_zone z
      LEFT JOIN library_seat s ON s.zone_id = z.id
      WHERE z.is_enabled = 1
      GROUP BY z.id
      ORDER BY z.seat_count DESC, z.sort_order ASC, z.id ASC
      LIMIT ${safeLimit}
    `
  );

  return rows.map((row) => ({
    zoneCode: row.zoneCode,
    displayName: row.displayName,
    band: row.band,
    gridLetter: row.gridLetter,
    gridNumber: row.gridNumber,
    seatCount: row.seatCount,
    tableGroupCount: row.tableGroupCount,
    quietSeatCount: Number(row.quietSeatCount || 0)
  }));
}

module.exports = {
  getHomeSummaryFromDb,
  listPublishedNoticesFromDb,
  listHotZonesFromDb
};
