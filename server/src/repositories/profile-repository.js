const { query } = require("../lib/db");

function formatDateTime(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function mapCreditLogRow(row) {
  return {
    id: row.id,
    changeType: row.changeType,
    changeReason: row.changeReason,
    scoreDelta: Number(row.scoreDelta || 0),
    scoreAfter: Number(row.scoreAfter || 0),
    createdAt: formatDateTime(row.createdAt) || ""
  };
}

async function getProfileByStudentNo(studentNo) {
  const [userRows] = await query(
    `
      SELECT
        u.id,
        u.student_no AS studentNo,
        u.real_name AS realName,
        u.role,
        u.status,
        u.credit_score AS creditScore,
        u.violation_count AS violationCount,
        u.is_blacklisted AS isBlacklisted,
        u.blacklist_until AS blacklistUntil,
        COUNT(r.id) AS totalReservations,
        SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) AS completedReservations
      FROM app_user u
      LEFT JOIN seat_reservation r ON r.user_id = u.id
      WHERE u.student_no = ?
      GROUP BY u.id
      LIMIT 1
    `,
    [studentNo]
  );

  const user = userRows[0];
  if (!user) {
    return null;
  }

  const [creditLogRows] = await query(
    `
      SELECT
        id,
        change_type AS changeType,
        change_reason AS changeReason,
        score_delta AS scoreDelta,
        score_after AS scoreAfter,
        created_at AS createdAt
      FROM user_credit_log
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `,
    [user.id]
  );

  return {
    user: {
      userId: user.studentNo,
      studentNo: user.studentNo,
      realName: user.realName,
      role: user.role,
      status: user.status,
      creditScore: Number(user.creditScore || 0),
      isBlacklisted: Boolean(user.isBlacklisted),
      blacklistUntil: formatDateTime(user.blacklistUntil),
      statistics: {
        totalReservations: Number(user.totalReservations || 0),
        completedReservations: Number(user.completedReservations || 0),
        violationCount: Number(user.violationCount || 0)
      }
    },
    creditLogs: creditLogRows.map(mapCreditLogRow)
  };
}

module.exports = {
  getProfileByStudentNo
};
