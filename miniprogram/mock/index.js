const { getOffsetDate } = require("../utils/date");

const rules = {
  openTime: "06:30",
  closeTime: "22:30",
  advanceDays: 3,
  minReservationMinutes: 30,
  maxReservationMinutes: 240,
  maxLeaveTimes: 2,
  blacklistCreditThreshold: 60
};

const filters = [
  { key: "power_outlet", label: "有插座" },
  { key: "window", label: "靠窗" },
  { key: "quiet", label: "安静" },
  { key: "balanced_temperature", label: "温度均衡" },
  { key: "quiet_position", label: "避开通道" },
  { key: "table_4", label: "4人桌" },
  { key: "table_8", label: "8人桌" },
  { key: "near_bookshelf", label: "靠近书架" },
  { key: "near_restroom", label: "靠近卫生间" },
  { key: "sunlight_yes", label: "光照充足" }
];

const presets = [
  { key: "sprint", label: "冲刺学习", filters: ["power_outlet", "quiet", "quiet_position", "balanced_temperature"] },
  { key: "window", label: "临窗阅读", filters: ["window", "quiet", "sunlight_yes"] },
  { key: "group", label: "结伴自习", filters: ["table_8", "power_outlet", "balanced_temperature"] }
];

const ASSISTANT_FILTER_KEYWORDS = [
  { key: "power_outlet", keywords: ["插座", "充电", "电脑", "笔记本", "平板", "设备", "代码"], reason: "识别到设备用电需求" },
  { key: "window", keywords: ["靠窗", "窗边", "窗户", "临窗"], reason: "识别到临窗需求" },
  { key: "quiet", keywords: ["安静", "专注", "自习", "学习", "考研", "复习", "备考", "沉浸"], reason: "识别到安静专注需求" },
  { key: "balanced_temperature", keywords: ["空调别吹", "温度均衡", "不冷", "不热", "舒适"], reason: "识别到舒适温度需求" },
  { key: "quiet_position", keywords: ["避开通道", "不要通道", "少人走动", "不想被打扰"], reason: "识别到避开通道需求" },
  { key: "table_4", keywords: ["4人桌", "四人桌", "小桌"], reason: "识别到小桌需求" },
  { key: "table_8", keywords: ["8人桌", "八人桌", "大桌", "多人桌", "结伴", "一起", "讨论"], reason: "识别到多人桌需求" },
  { key: "near_bookshelf", keywords: ["书架", "找书", "资料"], reason: "识别到靠近书架需求" },
  { key: "near_restroom", keywords: ["卫生间", "洗手间", "厕所", "短时间"], reason: "识别到短时便利需求" },
  { key: "sunlight_yes", keywords: ["采光", "阳光", "光照", "亮一点", "白天看书"], reason: "识别到采光需求" }
];

const ASSISTANT_SCENE_KEYWORDS = [
  { key: "group", keywords: ["结伴", "一起", "讨论", "小组", "协作"], reason: "识别到协作学习场景" },
  { key: "window", keywords: ["靠窗", "窗边", "阅读", "采光", "阳光", "看书"], reason: "识别到临窗阅读场景" },
  { key: "sprint", keywords: ["冲刺", "考研", "复习", "备考", "专注", "安静", "刷题"], reason: "识别到冲刺学习场景" }
];

const ASSISTANT_TIME_KEYWORDS = [
  { key: "morning", keywords: ["早上", "上午", "清晨"], startTime: "08:00", endTime: "11:00", label: "上午时段" },
  { key: "afternoon", keywords: ["下午", "午后"], startTime: "14:00", endTime: "17:00", label: "下午时段" },
  { key: "night", keywords: ["晚上", "夜间", "晚自习"], startTime: "18:30", endTime: "21:00", label: "晚间时段" }
];

const AUTH_STORAGE_KEY = "library.currentUser";
const STORAGE_KEYS = {
  users: "library.mock.users",
  reservations: "library.mock.reservations",
  creditLogs: "library.mock.creditLogs",
  counter: "library.mock.counter"
};

const CURRENT_STATUSES = new Set(["reserved", "checked_in", "temporary_leave"]);

const DEFAULT_USERS = [
  {
    userId: "20260001",
    studentNo: "20260001",
    realName: "测试读者甲",
    role: "reader",
    status: "active",
    creditScore: 92,
    isBlacklisted: false,
    blacklistUntil: null
  }
];

const DEFAULT_CREDIT_LOGS = {
  "20260001": [
    {
      id: 1,
      createdAt: `${getOffsetDate(-2)} 10:20:00`,
      changeType: "penalty",
      changeReason: "预约后超时未签到",
      scoreDelta: -10,
      scoreAfter: 90
    },
    {
      id: 2,
      createdAt: `${getOffsetDate(-1)} 16:00:00`,
      changeType: "restore",
      changeReason: "管理员人工核验后恢复部分信用分",
      scoreDelta: 2,
      scoreAfter: 92
    }
  ]
};

const SEAT_STATUS_META = {
  available: {
    statusKey: "available",
    statusLabel: "可预约",
    statusTone: "available",
    statusDescription: "当前时段可直接预约",
    canReserve: true
  },
  reserved: {
    statusKey: "reserved",
    statusLabel: "已预约",
    statusTone: "reserved",
    statusDescription: "当前时段已被占用",
    canReserve: false
  },
  maintenance: {
    statusKey: "maintenance",
    statusLabel: "维护中",
    statusTone: "maintenance",
    statusDescription: "当前不可使用",
    canReserve: false
  },
  checked_in: {
    statusKey: "checked_in",
    statusLabel: "使用中",
    statusTone: "occupied",
    statusDescription: "当前已有读者正在使用",
    canReserve: false
  },
  temporary_leave: {
    statusKey: "temporary_leave",
    statusLabel: "暂离中",
    statusTone: "leave",
    statusDescription: "当前座位被暂离读者保留",
    canReserve: false
  },
  user_conflict: {
    statusKey: "user_conflict",
    statusLabel: "时段冲突",
    statusTone: "reserved",
    statusDescription: "你的账号在这个时段已有其他预约",
    canReserve: false
  }
};

const SCENE_MODEL_META = {
  focus: { label: "深度专注型", confidenceText: "88% 场景置信" },
  comfort: { label: "舒适久学型", confidenceText: "91% 场景置信" },
  device: { label: "设备作业型", confidenceText: "87% 场景置信" },
  open: { label: "开放协作型", confidenceText: "89% 场景置信" }
};

function parseZoneCode(zoneCode) {
  const text = String(zoneCode || "");
  const matched = text.match(/^([A-Z]+)(\d+)$/i);

  return {
    gridLetter: matched ? matched[1].toUpperCase() : "",
    gridNumber: matched ? Number(matched[2]) : 0
  };
}

const zones = [
  { zoneCode: "Q3", displayName: "北侧Q3区", band: "north", floor: 7, seatCount: 68, tableGroupCount: 10, annotationStatus: "pending" },
  { zoneCode: "Q12", displayName: "北侧Q12区", band: "north", floor: 7, seatCount: 60, tableGroupCount: 9, annotationStatus: "pending" },
  { zoneCode: "K3", displayName: "西侧K3区", band: "west", floor: 7, seatCount: 48, tableGroupCount: 8, annotationStatus: "pending" },
  { zoneCode: "C8", displayName: "南侧外圈C8区", band: "south_outer", floor: 7, seatCount: 48, tableGroupCount: 8, annotationStatus: "pending" },
  { zoneCode: "E15", displayName: "东侧E15区", band: "east", floor: 7, seatCount: 32, tableGroupCount: 6, annotationStatus: "pending" },
  { zoneCode: "D10", displayName: "南侧内圈D10区", band: "south_inner", floor: 7, seatCount: 16, tableGroupCount: 2, annotationStatus: "pending" }
];

const seats = [
  {
    seatId: "Q3-A-01",
    zoneCode: "Q3",
    zoneDisplayName: "北侧Q3区",
    tableGroupCode: "Q3-A",
    seatType: "8人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: true,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "window", "quiet", "balanced_temperature", "quiet_position", "sunlight_yes", "table_8"],
    rawTags: ["有插座", "靠窗", "安静", "温度均衡", "8人桌", "位置避静", "光照充足"]
  },
  {
    seatId: "Q3-A-03",
    zoneCode: "Q3",
    zoneDisplayName: "北侧Q3区",
    tableGroupCode: "Q3-A",
    seatType: "8人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: false,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "quiet", "balanced_temperature", "quiet_position", "sunlight_yes", "table_8"],
    rawTags: ["有插座", "内侧", "安静", "温度均衡", "8人桌", "位置避静"]
  },
  {
    seatId: "Q12-A-01",
    zoneCode: "Q12",
    zoneDisplayName: "北侧Q12区",
    tableGroupCode: "Q12-A",
    seatType: "8人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: true,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "window", "quiet", "balanced_temperature", "quiet_position", "sunlight_yes", "table_8"],
    rawTags: ["有插座", "靠窗", "安静", "温度均衡", "8人桌"]
  },
  {
    seatId: "Q12-B-05",
    zoneCode: "Q12",
    zoneDisplayName: "北侧Q12区",
    tableGroupCode: "Q12-B",
    seatType: "8人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: false,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "quiet", "balanced_temperature", "quiet_position", "table_8"],
    rawTags: ["有插座", "安静", "温度均衡", "8人桌"]
  },
  {
    seatId: "K3-B-01",
    zoneCode: "K3",
    zoneDisplayName: "西侧K3区",
    tableGroupCode: "K3-B",
    seatType: "4人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: true,
    nearCorridor: false,
    nearRestroom: true,
    nearPantry: true,
    nearAC: true,
    seatStatus: "available",
    tagKeys: ["power_outlet", "window", "quiet", "near_restroom", "table_4", "sunlight_yes"],
    rawTags: ["有插座", "靠窗", "安静", "离洗手间近", "4人桌"]
  },
  {
    seatId: "K3-B-03",
    zoneCode: "K3",
    zoneDisplayName: "西侧K3区",
    tableGroupCode: "K3-B",
    seatType: "4人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: false,
    nearCorridor: false,
    nearRestroom: true,
    nearPantry: true,
    nearAC: true,
    seatStatus: "available",
    tagKeys: ["power_outlet", "quiet", "near_restroom", "table_4"],
    rawTags: ["有插座", "内侧", "安静", "离洗手间近", "4人桌"]
  },
  {
    seatId: "C8-A-01",
    zoneCode: "C8",
    zoneDisplayName: "南侧外圈C8区",
    tableGroupCode: "C8-A",
    seatType: "8人桌",
    quietLevel: "一般",
    hasPower: false,
    nearWindow: false,
    nearCorridor: true,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["table_8"],
    rawTags: ["8人桌", "靠近通道"]
  },
  {
    seatId: "C8-A-02",
    zoneCode: "C8",
    zoneDisplayName: "南侧外圈C8区",
    tableGroupCode: "C8-A",
    seatType: "8人桌",
    quietLevel: "一般",
    hasPower: true,
    nearWindow: false,
    nearCorridor: true,
    nearRestroom: false,
    nearPantry: false,
    nearAC: true,
    seatStatus: "available",
    tagKeys: ["power_outlet", "table_8"],
    rawTags: ["有插座", "8人桌", "靠近通道"]
  },
  {
    seatId: "E15-C-01",
    zoneCode: "E15",
    zoneDisplayName: "东侧E15区",
    tableGroupCode: "E15-C",
    seatType: "4人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: true,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "window", "quiet", "near_bookshelf", "table_4", "sunlight_yes"],
    rawTags: ["有插座", "靠窗", "安静", "靠近书架", "4人桌"]
  },
  {
    seatId: "D10-A-01",
    zoneCode: "D10",
    zoneDisplayName: "南侧内圈D10区",
    tableGroupCode: "D10-A",
    seatType: "8人桌",
    quietLevel: "安静",
    hasPower: true,
    nearWindow: false,
    nearCorridor: false,
    nearRestroom: false,
    nearPantry: false,
    nearAC: false,
    seatStatus: "available",
    tagKeys: ["power_outlet", "quiet", "balanced_temperature", "quiet_position", "table_8"],
    rawTags: ["有插座", "安静", "温度均衡", "8人桌"]
  }
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasWxStorage() {
  return typeof wx !== "undefined" && wx && typeof wx.getStorageSync === "function";
}

const memoryStore = {};

function getStorageValue(key, fallback) {
  if (hasWxStorage()) {
    const value = wx.getStorageSync(key);
    return value === "" || value === undefined || value === null ? fallback : value;
  }

  return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : fallback;
}

function setStorageValue(key, value) {
  if (hasWxStorage()) {
    wx.setStorageSync(key, value);
    return;
  }

  memoryStore[key] = value;
}

function getCurrentMockUser() {
  return getStorageValue(AUTH_STORAGE_KEY, null);
}

function ensureUsers() {
  const users = getStorageValue(STORAGE_KEYS.users, null);
  if (users && users.length) {
    return users;
  }

  const initialized = deepClone(DEFAULT_USERS);
  setStorageValue(STORAGE_KEYS.users, initialized);
  return initialized;
}

function ensureCreditLogs() {
  const logs = getStorageValue(STORAGE_KEYS.creditLogs, null);
  if (logs) {
    return logs;
  }

  const initialized = deepClone(DEFAULT_CREDIT_LOGS);
  setStorageValue(STORAGE_KEYS.creditLogs, initialized);
  return initialized;
}

function createSeedReservation({ reservationNo, studentNo, seatId, reservationDate, startTime, endTime, status }) {
  const seat = seats.find((item) => item.seatId === seatId);
  return {
    reservationNo,
    userId: studentNo,
    studentNo,
    seatId,
    zoneCode: seat.zoneCode,
    zoneDisplayName: seat.zoneDisplayName,
    reservationDate,
    startTime,
    endTime,
    status,
    seatQrToken: `SEAT:${seatId}`,
    checkinOpenAt: `${reservationDate} ${startTime}:00`,
    checkinDeadlineAt: `${reservationDate} ${endTime}:00`,
    leaveDeadlineAt: "",
    createdAt: `${reservationDate} ${startTime}:00`
  };
}

function ensureReservations() {
  const reservations = getStorageValue(STORAGE_KEYS.reservations, null);
  if (reservations && reservations.length) {
    return reservations;
  }

  const initialized = [
    createSeedReservation({
      reservationNo: "RS-MOCK-0001",
      studentNo: "20260001",
      seatId: "Q3-A-01",
      reservationDate: getOffsetDate(0),
      startTime: "09:00",
      endTime: "11:00",
      status: "checked_in"
    }),
    createSeedReservation({
      reservationNo: "RS-MOCK-0002",
      studentNo: "20260001",
      seatId: "Q12-A-01",
      reservationDate: getOffsetDate(1),
      startTime: "14:00",
      endTime: "16:00",
      status: "reserved"
    }),
    createSeedReservation({
      reservationNo: "RS-MOCK-0003",
      studentNo: "20260001",
      seatId: "K3-B-01",
      reservationDate: getOffsetDate(-1),
      startTime: "13:30",
      endTime: "15:30",
      status: "completed"
    }),
    createSeedReservation({
      reservationNo: "RS-MOCK-0004",
      studentNo: "20260001",
      seatId: "C8-A-02",
      reservationDate: getOffsetDate(-2),
      startTime: "08:30",
      endTime: "10:00",
      status: "no_show"
    })
  ];

  setStorageValue(STORAGE_KEYS.reservations, initialized);
  setStorageValue(STORAGE_KEYS.counter, 5);
  return initialized;
}

function saveUsers(users) {
  setStorageValue(STORAGE_KEYS.users, users);
}

function saveReservations(reservations) {
  setStorageValue(STORAGE_KEYS.reservations, reservations);
}

function saveCreditLogs(creditLogs) {
  setStorageValue(STORAGE_KEYS.creditLogs, creditLogs);
}

function nextReservationNo() {
  const current = Number(getStorageValue(STORAGE_KEYS.counter, 5));
  setStorageValue(STORAGE_KEYS.counter, current + 1);
  return `RS-MOCK-${String(current).padStart(4, "0")}`;
}

function getSeatById(seatId) {
  return seats.find((item) => item.seatId === seatId) || null;
}

function timeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function buildUsageMap(query) {
  const reservations = ensureReservations();
  const reservationDate = query.reservationDate || "";
  const startMinutes = timeToMinutes(query.startTime);
  const endMinutes = timeToMinutes(query.endTime);
  const currentUser = query.studentNo || ((getCurrentMockUser() || {}).studentNo || "");
  const seatUsageMap = new Map();
  let userConflict = null;

  reservations.forEach((item) => {
    if (!CURRENT_STATUSES.has(item.status)) {
      return;
    }

    if (reservationDate && item.reservationDate !== reservationDate) {
      return;
    }

    const itemStart = timeToMinutes(item.startTime);
    const itemEnd = timeToMinutes(item.endTime);
    const hasOverlap = startMinutes !== null && endMinutes !== null
      ? overlaps(startMinutes, endMinutes, itemStart, itemEnd)
      : true;

    if (!hasOverlap) {
      return;
    }

    seatUsageMap.set(item.seatId, item);
    if (currentUser && item.studentNo === currentUser) {
      userConflict = item;
    }
  });

  return {
    seatUsageMap,
    userConflict
  };
}

function decorateAvailability(seat, query = {}) {
  const { seatUsageMap, userConflict } = buildUsageMap(query);
  const usage = seatUsageMap.get(seat.seatId);

  if (usage) {
    return SEAT_STATUS_META[usage.status] || SEAT_STATUS_META.reserved;
  }

  if (userConflict) {
    return {
      ...SEAT_STATUS_META.user_conflict,
      statusDescription: `你在 ${userConflict.startTime}-${userConflict.endTime} 已预约 ${userConflict.seatId}`
    };
  }

  return SEAT_STATUS_META[seat.seatStatus] || SEAT_STATUS_META.available;
}

function normalizeFilters(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueByKey(items, keyName) {
  const used = new Set();
  return (items || []).filter((item) => {
    const value = item && item[keyName];
    if (!value || used.has(value)) {
      return false;
    }
    used.add(value);
    return true;
  });
}

function parseAssistantMessage(message = "") {
  const text = String(message || "").trim();
  const matchedFilters = [];
  const matchedScenes = [];
  const matchedTimes = [];

  ASSISTANT_FILTER_KEYWORDS.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      const filterMeta = filters.find((item) => item.key === rule.key) || { key: rule.key, label: rule.key };
      matchedFilters.push({
        key: rule.key,
        label: filterMeta.label,
        keyword,
        reason: rule.reason
      });
    }
  });

  ASSISTANT_SCENE_KEYWORDS.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      const presetMeta = presets.find((item) => item.key === rule.key) || { key: rule.key, label: rule.key };
      matchedScenes.push({
        key: rule.key,
        label: presetMeta.label,
        description: presetMeta.description || "",
        keyword,
        reason: rule.reason
      });
    }
  });

  ASSISTANT_TIME_KEYWORDS.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      matchedTimes.push({
        key: rule.key,
        label: rule.label,
        keyword,
        startTime: rule.startTime,
        endTime: rule.endTime
      });
    }
  });

  const parsedFilters = uniqueByKey(matchedFilters, "key");
  const scene = uniqueByKey(matchedScenes, "key")[0] || null;
  const timeWindow = uniqueByKey(matchedTimes, "key")[0] || null;

  if (scene) {
    const preset = presets.find((item) => item.key === scene.key);
    (preset && preset.filters || []).forEach((filterKey) => {
      if (!parsedFilters.find((item) => item.key === filterKey)) {
        const filterMeta = filters.find((item) => item.key === filterKey) || { key: filterKey, label: filterKey };
        parsedFilters.push({
          key: filterKey,
          label: filterMeta.label,
          keyword: scene.label,
          reason: `根据“${scene.label}”场景补充偏好`
        });
      }
    });
  }

  return {
    text,
    filters: parsedFilters,
    scene,
    timeWindow
  };
}

function getMatchedFilterCount(seat, filtersList) {
  return (filtersList || []).filter((filterKey) => seat.tagKeys.includes(filterKey)).length;
}

function buildRelaxedMockItems(candidates, filtersList) {
  if (!filtersList.length) {
    return {
      relaxed: false,
      items: candidates
    };
  }

  const strictItems = candidates.filter((seat) => filtersList.every((filterKey) => seat.tagKeys.includes(filterKey)));
  if (strictItems.length) {
    return {
      relaxed: false,
      items: strictItems
    };
  }

  const threshold = Math.max(1, Math.min(filtersList.length - 1, Math.ceil(filtersList.length * 0.6)));
  const withMatchCount = candidates
    .map((seat) => ({
      seat,
      matchedFilterCount: getMatchedFilterCount(seat, filtersList)
    }))
    .filter((item) => item.matchedFilterCount > 0);
  const relaxedItems = withMatchCount
    .filter((item) => item.matchedFilterCount >= threshold)
    .map((item) => item.seat);

  return {
    relaxed: true,
    items: (relaxedItems.length ? relaxedItems : withMatchCount.map((item) => item.seat))
  };
}

function computeScore(seat, activeFilters, activeZone) {
  let score = 50;

  activeFilters.forEach((filterKey) => {
    if (seat.tagKeys.includes(filterKey)) {
      score += 8;
    }
  });

  if (seat.hasPower) {
    score += 7;
  }
  if (seat.nearWindow) {
    score += 5;
  }
  if (seat.quietLevel === "安静") {
    score += 9;
  }
  if (!seat.nearCorridor) {
    score += 6;
  }
  if (!seat.nearAC) {
    score += 4;
  }
  if (activeZone && seat.zoneCode === activeZone) {
    score += 6;
  }

  return score;
}

function inferSceneModel(seat) {
  if (seat.seatType === "8人桌" && seat.nearCorridor) {
    return SCENE_MODEL_META.open;
  }
  if (seat.hasPower && (seat.nearRestroom || seat.nearAC || seat.nearPantry)) {
    return SCENE_MODEL_META.device;
  }
  if (seat.nearWindow && seat.quietLevel === "安静") {
    return SCENE_MODEL_META.comfort;
  }
  return SCENE_MODEL_META.focus;
}

function pickTopRecommendations(items, limit = 6) {
  const result = [];
  const tableGroups = new Set();

  items.forEach((item) => {
    if (result.length >= limit) {
      return;
    }

    if (!tableGroups.has(item.tableGroupCode)) {
      result.push(item);
      tableGroups.add(item.tableGroupCode);
    }
  });

  if (result.length < limit) {
    items.forEach((item) => {
      if (result.length >= limit) {
        return;
      }

      if (!result.find((current) => current.seatId === item.seatId)) {
        result.push(item);
      }
    });
  }

  return result;
}

function getFilteredSeats(query) {
  const activeFilters = normalizeFilters(query.filters);
  const search = String(query.search || "").trim().toLowerCase();
  const zoneCode = query.zoneCode || "";
  const limit = Number(query.limit) || 20;
  const currentUser = getCurrentMockUser();

  const candidates = seats
    .filter((seat) => {
      if (zoneCode && seat.zoneCode !== zoneCode) {
        return false;
      }

      if (search && !`${seat.seatId} ${seat.zoneCode} ${seat.rawTags.join(" ")}`.toLowerCase().includes(search)) {
        return false;
      }

      return true;
    })

  const relaxedState = buildRelaxedMockItems(candidates, activeFilters);

  const items = relaxedState.items
    .map((seat) => ({
      ...seat,
      ...decorateAvailability(seat, {
        reservationDate: query.reservationDate,
        startTime: query.startTime,
        endTime: query.endTime,
        studentNo: query.studentNo || (currentUser && currentUser.studentNo) || ""
      }),
      sceneModelLabel: inferSceneModel(seat).label,
      sceneModelConfidenceText: inferSceneModel(seat).confidenceText,
      score: computeScore(seat, activeFilters, zoneCode),
      fitPercent: Math.max(62, Math.min(98, Math.round(computeScore(seat, activeFilters, zoneCode) - 8))),
      reasons: seat.rawTags.slice(0, 4)
    }))
    .sort((left, right) => right.score - left.score || left.seatId.localeCompare(right.seatId, "zh-CN", { numeric: true }))
    .map((seat) => ({
      ...seat,
      recommendationBadge: `${seat.fitPercent}%匹配`
    }));

  const availableItems = items.filter((seat) => seat.canReserve);
  const topRecommendations = pickTopRecommendations(availableItems, 6);

  return {
    filters: activeFilters,
    total: items.length,
    availableCount: availableItems.length,
    unavailableCount: items.filter((seat) => !seat.canReserve).length,
    recommendationSummary: {
      title: activeFilters.length ? "本地推荐结果" : "综合推荐结果",
      description: relaxedState.relaxed
        ? "当前没有完全匹配的座位，系统已自动放宽到最接近的结果。"
        : "当前使用的是本地数据，推荐结果按偏好匹配度和舒适度综合排序。",
      badge: `${availableItems.length} 个可约 · 精选 ${topRecommendations.length} 个起点`,
      hintTags: activeFilters.map((key) => (filters.find((item) => item.key === key) || {}).label || key).slice(0, 4),
      focusSeatId: topRecommendations[0] ? topRecommendations[0].seatId : "",
      focusTableGroupCode: topRecommendations[0] ? topRecommendations[0].tableGroupCode : "",
      modelNote: relaxedState.relaxed ? "本地数据模式已启用偏好放宽策略。" : "本地数据模式已启用需求-座位匹配与偏好排序。",
      isRelaxed: relaxedState.relaxed
    },
    items: items.slice(0, limit),
    topRecommendations
  };
}

function getZones(query) {
  const activeFilters = normalizeFilters(query.filters);
  const search = String(query.search || "").trim().toLowerCase();

  const items = zones.map((zone) => {
    const grid = parseZoneCode(zone.zoneCode);
    const zoneSeats = seats.filter((seat) => {
      if (seat.zoneCode !== zone.zoneCode) {
        return false;
      }

      if (search && !`${seat.seatId} ${seat.rawTags.join(" ")}`.toLowerCase().includes(search)) {
        return false;
      }

      return true;
    });
    const relaxedState = buildRelaxedMockItems(zoneSeats, activeFilters);
    const matchedSeatCount = relaxedState.items.length;

    return {
      ...zone,
      gridLetter: zone.gridLetter || grid.gridLetter,
      gridNumber: zone.gridNumber || grid.gridNumber,
      matchedSeatCount
    };
  });

  return {
    floor: 7,
    items
  };
}

function requireMockStudentNo(studentNo) {
  const value = String(studentNo || ((getCurrentMockUser() || {}).studentNo || "")).trim();
  if (!value) {
    const error = new Error("请先登录");
    error.code = "AUTH_REQUIRED";
    throw error;
  }

  return value;
}

function getUserByStudentNo(studentNo) {
  return ensureUsers().find((item) => item.studentNo === studentNo) || null;
}

function ensureCreditLogList(studentNo) {
  const logs = ensureCreditLogs();
  if (!logs[studentNo]) {
    logs[studentNo] = [];
    saveCreditLogs(logs);
  }
  return logs[studentNo];
}

function splitReservations(studentNo) {
  const reservations = ensureReservations().filter((item) => item.studentNo === studentNo);
  return {
    current: reservations.filter((item) => CURRENT_STATUSES.has(item.status)),
    history: reservations.filter((item) => !CURRENT_STATUSES.has(item.status))
  };
}

function buildUserStatistics(studentNo) {
  const reservations = ensureReservations().filter((item) => item.studentNo === studentNo);
  return {
    totalReservations: reservations.length,
    completedReservations: reservations.filter((item) => item.status === "completed").length,
    violationCount: reservations.filter((item) => item.status === "no_show" || item.status === "violation").length
  };
}

function login(form) {
  const studentNo = String((form && form.studentNo) || "").trim();
  const realName = String((form && form.realName) || "").trim();
  const user = getUserByStudentNo(studentNo);

  if (!user) {
    const error = new Error("该学号尚未注册");
    error.code = "USER_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  if (user.realName !== realName) {
    const error = new Error("姓名与学号不匹配");
    error.code = "USER_NAME_MISMATCH";
    error.statusCode = 400;
    throw error;
  }

  return {
    user: deepClone(user),
    mode: "mock_demo",
    message: "登录成功"
  };
}

function register(form) {
  const studentNo = String((form && form.studentNo) || "").trim();
  const realName = String((form && form.realName) || "").trim();
  const users = ensureUsers();

  if (users.some((item) => item.studentNo === studentNo)) {
    const error = new Error("该学号已经注册");
    error.code = "STUDENT_NO_ALREADY_REGISTERED";
    error.statusCode = 409;
    throw error;
  }

  const user = {
    userId: studentNo,
    studentNo,
    realName,
    role: "reader",
    status: "active",
    creditScore: 100,
    isBlacklisted: false,
    blacklistUntil: null
  };

  users.push(user);
  saveUsers(users);
  ensureCreditLogList(studentNo);

  return {
    user: deepClone(user),
    mode: "mock_demo",
    message: "注册成功"
  };
}

function getReservations(studentNo) {
  const safeStudentNo = requireMockStudentNo(studentNo);
  return splitReservations(safeStudentNo);
}

function getProfile(studentNo) {
  const safeStudentNo = requireMockStudentNo(studentNo);
  const user = getUserByStudentNo(safeStudentNo);
  const creditLogs = ensureCreditLogList(safeStudentNo);

  return {
    user: {
      ...deepClone(user),
      statistics: buildUserStatistics(safeStudentNo)
    },
    creditLogs: deepClone(creditLogs),
    ruleHints: {
      initialCreditScore: 100,
      blacklistCreditThreshold: 60,
      blacklistDays: 7
    }
  };
}

function buildReservationChecks(payload, studentNo) {
  const seat = getSeatById(payload.seatId);
  const reservations = ensureReservations();
  const current = reservations.filter((item) => item.studentNo === studentNo && CURRENT_STATUSES.has(item.status));
  const sameSeatConflict = reservations.some((item) => (
    item.seatId === payload.seatId &&
    item.reservationDate === payload.reservationDate &&
    CURRENT_STATUSES.has(item.status) &&
    overlaps(timeToMinutes(payload.startTime), timeToMinutes(payload.endTime), timeToMinutes(item.startTime), timeToMinutes(item.endTime))
  ));
  const userConflict = reservations.some((item) => (
    item.studentNo === studentNo &&
    item.reservationDate === payload.reservationDate &&
    CURRENT_STATUSES.has(item.status) &&
    overlaps(timeToMinutes(payload.startTime), timeToMinutes(payload.endTime), timeToMinutes(item.startTime), timeToMinutes(item.endTime))
  ));

  const checks = [
    {
      label: "目标座位存在",
      passed: Boolean(seat),
      detail: seat ? `${seat.seatId} 可用于当前预约` : "未找到对应座位"
    },
    {
      label: "座位当前状态可预约",
      passed: Boolean(seat) && seat.seatStatus === "available",
      detail: seat ? `当前状态：${seat.seatStatus}` : "座位不存在"
    },
    {
      label: "日期已填写",
      passed: Boolean(payload.reservationDate),
      detail: "本地数据模式仍会保留日期和时间窗概念"
    },
    {
      label: "时间格式合法",
      passed: Boolean(payload.startTime) && Boolean(payload.endTime) && timeToMinutes(payload.endTime) > timeToMinutes(payload.startTime),
      detail: "结束时间应晚于开始时间"
    },
    {
      label: "当前账号没有重叠预约",
      passed: !userConflict,
      detail: userConflict ? "当前时段你已有其他预约" : `当前进行中预约 ${current.length} 条`
    },
    {
      label: "目标座位没有冲突预约",
      passed: !sameSeatConflict,
      detail: sameSeatConflict ? "该座位当前时段已被占用" : "当前没有命中冲突记录"
    }
  ];

  return {
    seat,
    checks,
    valid: checks.every((item) => item.passed)
  };
}

function previewReservation(payload) {
  const studentNo = requireMockStudentNo(payload.studentNo);
  const result = buildReservationChecks(payload, studentNo);
  return {
    valid: result.valid,
    seat: result.seat,
    request: payload,
    checks: result.checks,
    message: result.valid ? "当前请求已通过预校验，可以继续完成预约流程。" : "当前请求未通过预校验，请先调整时间窗或座位。"
  };
}

function createReservation(payload) {
  const studentNo = requireMockStudentNo(payload.studentNo);
  const preview = previewReservation(payload);
  if (!preview.valid) {
    const error = new Error(preview.message);
    error.code = "RESERVATION_VALIDATION_FAILED";
    error.payload = preview;
    throw error;
  }

  const reservations = ensureReservations();
  const seat = getSeatById(payload.seatId);
  const record = {
    reservationNo: nextReservationNo(),
    userId: studentNo,
    studentNo,
    seatId: payload.seatId,
    zoneCode: seat.zoneCode,
    zoneDisplayName: seat.zoneDisplayName,
    reservationDate: payload.reservationDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    status: "reserved",
    seatQrToken: `SEAT:${payload.seatId}`,
    checkinOpenAt: `${payload.reservationDate} ${payload.startTime}:00`,
    checkinDeadlineAt: `${payload.reservationDate} ${payload.endTime}:00`,
    leaveDeadlineAt: "",
    createdAt: `${payload.reservationDate} ${payload.startTime}:00`
  };

  reservations.unshift(record);
  saveReservations(reservations);
  return deepClone(record);
}

function getReservationByNo(reservationNo, studentNo) {
  const safeStudentNo = requireMockStudentNo(studentNo);
  const reservations = ensureReservations();
  const item = reservations.find((record) => record.reservationNo === reservationNo && record.studentNo === safeStudentNo);
  if (!item) {
    const error = new Error("未找到对应预约");
    error.code = "RESERVATION_NOT_FOUND";
    throw error;
  }
  return { reservations, item };
}

function cancelReservation(reservationNo, payload = {}) {
  const { reservations, item } = getReservationByNo(reservationNo, payload.studentNo);
  item.status = "cancelled";
  saveReservations(reservations);
  return deepClone(item);
}

function checkinReservation(reservationNo, payload = {}) {
  const { reservations, item } = getReservationByNo(reservationNo, payload.studentNo);
  item.status = "checked_in";
  item.checkinImageUrl = payload.checkinImageUrl || item.checkinImageUrl || "";
  saveReservations(reservations);
  return deepClone(item);
}

function uploadCheckinImage(payload = {}) {
  const reservationNo = String(payload.reservationNo || "mock-reservation");
  const seatId = String(payload.seatId || "mock-seat");
  const source = String(payload.source || "upload");

  return {
    key: `mock/checkin/${reservationNo}-${seatId}.jpg`,
    url: `https://mock.library.local/checkin/${reservationNo}-${seatId}.jpg`,
    source,
    uploadedAt: new Date().toISOString()
  };
}

function checkoutReservation(reservationNo, payload = {}) {
  const { reservations, item } = getReservationByNo(reservationNo, payload.studentNo);
  item.status = "completed";
  saveReservations(reservations);
  return deepClone(item);
}

function startLeaveReservation(reservationNo, payload = {}) {
  const { reservations, item } = getReservationByNo(reservationNo, payload.studentNo);
  item.status = "temporary_leave";
  item.leaveDeadlineAt = `${item.reservationDate} ${item.endTime}:00`;
  saveReservations(reservations);
  return deepClone(item);
}

function returnReservationSeat(reservationNo, payload = {}) {
  const { reservations, item } = getReservationByNo(reservationNo, payload.studentNo);
  item.status = "checked_in";
  item.leaveDeadlineAt = "";
  saveReservations(reservations);
  return deepClone(item);
}

function getHomeData() {
  return {
    systemName: "图书馆预约占座系统",
    stage: "移动预约端",
    summary: {
      seatCount: 1772,
      zoneCount: 54,
      tableGroupCount: 291,
      quietSeatCount: 1524,
      poweredSeatCount: 1348
    },
    rules,
    filters,
    presets,
    notices: [
      {
        id: 1,
        title: "当前为默认规则版",
        content: "一期先按常规高校图书馆制度推进，后续按学校真实制度微调。",
        publishDate: getOffsetDate(0),
        noticeType: "rule"
      },
      {
        id: 2,
        title: "选座方式说明",
        content: "当前小程序先做平面图分区选座和分区内列表选座。",
        publishDate: getOffsetDate(0),
        noticeType: "system"
      }
    ],
    hotZones: zones.slice(0, 4)
  };
}

function getRules() {
  return {
    rules,
    filters,
    presets
  };
}

function getAlgorithmOverview() {
  return {
    generatedAt: "2026-05-14 12:35:45",
    experiments: [
      {
        key: "request-seat-matching",
        title: "需求-座位匹配推荐实验",
        generatedAt: "2026-05-14 12:35:45",
        bestModel: "支持向量机SVM",
        accuracyText: "90.67%",
        macroF1Text: "90.65%",
        precisionText: "89.81%",
        recallText: "91.53%",
        featureCount: 68,
        classCount: 4,
        metricRows: [
          { model: "支持向量机SVM", accuracyText: "90.67%", macroF1Text: "90.65%" },
          { model: "逻辑回归", accuracyText: "89.50%", macroF1Text: "89.36%" },
          { model: "随机森林", accuracyText: "87.10%", macroF1Text: "86.46%" },
          { model: "神经网络MLP", accuracyText: "86.79%", macroF1Text: "85.92%" },
          { model: "K近邻KNN", accuracyText: "73.75%", macroF1Text: "75.70%" }
        ]
      }
    ]
  };
}

function getSeatAssistant(payload = {}) {
  const parsed = parseAssistantMessage(payload.message || "");
  const seatResult = getFilteredSeats({
    ...payload,
    limit: 100,
    filters: parsed.filters.map((item) => item.key),
    startTime: (parsed.timeWindow && parsed.timeWindow.startTime) || payload.startTime,
    endTime: (parsed.timeWindow && parsed.timeWindow.endTime) || payload.endTime
  });
  const candidateSeats = (seatResult.items || [])
    .filter((item) => item.canReserve)
    .map((item, index) => ({
      rank: index + 1,
      seatId: item.seatId,
      zoneCode: item.zoneCode,
      zoneDisplayName: item.zoneDisplayName,
      tableGroupCode: item.tableGroupCode,
      recommendationBadge: item.recommendationBadge,
      fitPercent: item.fitPercent,
      matchedFilterCount: item.matchedFilterCount,
      missingFilters: item.missingFilters || [],
      missingFiltersText: (item.missingFilters || []).join("、"),
      sceneModelLabel: item.sceneModelLabel,
      sceneModelConfidenceText: item.sceneModelConfidenceText,
      reasons: (item.reasons || []).slice(0, 4)
    }));
  const topSeats = candidateSeats.slice(0, 3);
  const firstSeat = topSeats[0] || null;

  return {
    queryText: parsed.text,
    recognizedFilters: parsed.filters,
    scene: parsed.scene,
    timeWindow: parsed.timeWindow || null,
    summaryTitle: parsed.scene ? `${parsed.scene.label} AI 推荐` : "AI 需求解析结果",
    summaryText: parsed.filters.length
      ? `已识别 ${parsed.filters.length} 项偏好${parsed.scene ? `，场景倾向为“${parsed.scene.label}”` : ""}${firstSeat ? `，当前首推座位是 ${firstSeat.seatId}` : ""}。`
      : "当前未识别到明确偏好，建议补充安静、靠窗、插座等需求关键词。",
    analysisSteps: [
      {
        title: "需求解析",
        content: parsed.filters.length
          ? `从自然语言中提取到 ${parsed.filters.map((item) => item.label).join("、")} 等偏好。`
          : "当前未提取到明确偏好，系统将按综合条件推荐。"
      },
      {
        title: "场景识别",
        content: parsed.scene
          ? `系统已将本次需求映射到“${parsed.scene.label}”场景。`
          : "当前按综合优选场景进行排序。"
      },
      {
        title: "排序输出",
        content: "本地数据模式会综合需求-座位匹配度、偏好命中和可预约状态输出推荐结果。"
      }
    ],
    applyPlan: {
      filters: parsed.filters.map((item) => item.key),
      zoneCode: firstSeat ? firstSeat.zoneCode : "",
      reservationDate: payload.reservationDate || "",
      startTime: (parsed.timeWindow && parsed.timeWindow.startTime) || payload.startTime || "09:00",
      endTime: (parsed.timeWindow && parsed.timeWindow.endTime) || payload.endTime || "11:00"
    },
    recommendationSummary: seatResult.recommendationSummary,
    topSeats,
    candidateSeats,
    candidateTotal: candidateSeats.length,
    candidateMoreCount: Math.max(candidateSeats.length - topSeats.length, 0)
  };
}

module.exports = {
  login,
  register,
  getHomeData,
  getRules,
  getAlgorithmOverview,
  getZones,
  getSeats: getFilteredSeats,
  getSeatAssistant,
  getReservations,
  getProfile,
  previewReservation,
  createReservation,
  cancelReservation,
  uploadCheckinImage,
  checkinReservation,
  checkoutReservation,
  startLeaveReservation,
  returnReservationSeat
};
