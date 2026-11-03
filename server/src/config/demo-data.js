const { defaultRules } = require("./default-rules");

const mockUsers = [
  {
    userId: "20260001",
    studentNo: "20260001",
    realName: "测试读者甲",
    role: "reader",
    status: "active",
    creditScore: 92,
    isBlacklisted: false,
    blacklistUntil: null
  },
  {
    userId: "LIB001",
    studentNo: "LIB001",
    realName: "图书馆管理员",
    role: "admin",
    status: "active",
    creditScore: 100,
    isBlacklisted: false,
    blacklistUntil: null
  }
];

function addDays(baseDate, delta) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + delta);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildMockReservations(now = new Date()) {
  const today = formatDate(now);
  const tomorrow = formatDate(addDays(now, 1));
  const yesterday = formatDate(addDays(now, -1));
  const twoDaysAgo = formatDate(addDays(now, -2));

  return [
    {
      reservationNo: "RS-DEMO-0001",
      userId: "20260001",
      seatId: "Q3-A-01",
      zoneCode: "Q3",
      zoneDisplayName: "北侧Q3区",
      reservationDate: today,
      startTime: "09:00",
      endTime: "11:00",
      status: "checked_in",
      source: "mini_program"
    },
    {
      reservationNo: "RS-DEMO-0002",
      userId: "20260002",
      seatId: "Q12-A-01",
      zoneCode: "Q12",
      zoneDisplayName: "北侧Q12区",
      reservationDate: tomorrow,
      startTime: "14:00",
      endTime: "16:00",
      status: "reserved",
      source: "mini_program"
    },
    {
      reservationNo: "RS-DEMO-0003",
      userId: "20260001",
      seatId: "K3-B-01",
      zoneCode: "K3",
      zoneDisplayName: "西侧K3区",
      reservationDate: yesterday,
      startTime: "13:30",
      endTime: "15:30",
      status: "completed",
      source: "mini_program"
    },
    {
      reservationNo: "RS-DEMO-0004",
      userId: "20260001",
      seatId: "C8-A-03",
      zoneCode: "C8",
      zoneDisplayName: "南侧外圈C8区",
      reservationDate: twoDaysAgo,
      startTime: "08:00",
      endTime: "10:00",
      status: "no_show",
      source: "mini_program"
    }
  ];
}

function buildMockNotices(now = new Date()) {
  const publishDate = formatDate(now);

  return [
    {
      id: 1,
      title: "一期默认规则已启用",
      content: "当前系统先按常规高校图书馆管理方式配置，后续如学校有正式制度，再统一修订。",
      publishDate,
      noticeType: "rule"
    },
    {
      id: 2,
      title: "选座模式说明",
      content: "一期采用平面图分区选座加分区内列表选座，不要求单座位像素级点击。",
      publishDate,
      noticeType: "system"
    }
  ];
}

function buildMockProfile(now = new Date()) {
  const reservations = buildMockReservations(now).filter(
    (reservation) => reservation.userId === "20260001"
  );

  return {
    user: {
      userId: "20260001",
      studentNo: "20260001",
      realName: "测试读者甲",
      role: "reader",
      status: "active",
      creditScore: 92,
      isBlacklisted: false,
      blacklistUntil: null,
      statistics: {
        totalReservations: reservations.length,
        completedReservations: reservations.filter((item) => item.status === "completed").length,
        violationCount: 1
      }
    },
    creditLogs: [
      {
        id: 1,
        createdAt: `${formatDate(addDays(now, -2))} 10:20:00`,
        changeType: "penalty",
        changeReason: "预约后超时未签到",
        scoreDelta: -10,
        scoreAfter: 90
      },
      {
        id: 2,
        createdAt: `${formatDate(addDays(now, -1))} 16:00:00`,
        changeType: "restore",
        changeReason: "管理员人工核验后恢复部分信用分",
        scoreDelta: 2,
        scoreAfter: 92
      }
    ],
    ruleHints: {
      initialCreditScore: defaultRules.initialCreditScore,
      blacklistCreditThreshold: defaultRules.blacklistCreditThreshold,
      blacklistDays: defaultRules.blacklistDays
    }
  };
}

function getMockUser(userId) {
  return mockUsers.find((item) => item.userId === userId) || mockUsers[0];
}

module.exports = {
  mockUsers,
  buildMockReservations,
  buildMockNotices,
  buildMockProfile,
  getMockUser
};
