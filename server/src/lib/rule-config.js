const { query } = require("./db");
const { defaultRules } = require("../config/default-rules");

const RULE_CONFIG_GROUPS = {
  reservation: {
    label: "预约规则",
    description: "影响可预约时间窗口、预约时长与预约次数限制。"
  },
  checkin: {
    label: "签到与暂离规则",
    description: "影响签到宽限时间、暂离次数和暂离时长。"
  },
  credit: {
    label: "信用与违约规则",
    description: "影响初始信用分、黑名单阈值与违约扣分。"
  }
};

const RULE_CONFIG_DEFINITIONS = [
  {
    configKey: "library_open_time",
    configGroup: "reservation",
    rulePath: ["openTime"],
    label: "开放时间",
    description: "图书馆每日开放时间",
    valueType: "time",
    inputType: "time"
  },
  {
    configKey: "library_close_time",
    configGroup: "reservation",
    rulePath: ["closeTime"],
    label: "闭馆时间",
    description: "图书馆每日闭馆时间",
    valueType: "time",
    inputType: "time"
  },
  {
    configKey: "reservation_advance_days",
    configGroup: "reservation",
    rulePath: ["advanceDays"],
    label: "提前预约天数",
    description: "允许提前多少天创建预约",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 30,
    step: 1
  },
  {
    configKey: "min_reservation_minutes",
    configGroup: "reservation",
    rulePath: ["minReservationMinutes"],
    label: "最短预约时长",
    description: "单次预约最短可预约分钟数",
    valueType: "number",
    inputType: "number",
    min: 10,
    max: 720,
    step: 10
  },
  {
    configKey: "max_reservation_minutes",
    configGroup: "reservation",
    rulePath: ["maxReservationMinutes"],
    label: "最长预约时长",
    description: "单次预约最长可预约分钟数",
    valueType: "number",
    inputType: "number",
    min: 30,
    max: 720,
    step: 10
  },
  {
    configKey: "max_active_reservations",
    configGroup: "reservation",
    rulePath: ["maxActiveReservations"],
    label: "最大生效预约数",
    description: "单用户同时生效中的预约上限",
    valueType: "number",
    inputType: "number",
    min: 1,
    max: 10,
    step: 1
  },
  {
    configKey: "max_daily_reservations",
    configGroup: "reservation",
    rulePath: ["maxDailyReservations"],
    label: "单日预约次数上限",
    description: "单用户单日最多可创建几次预约",
    valueType: "number",
    inputType: "number",
    min: 1,
    max: 20,
    step: 1
  },
  {
    configKey: "cancel_before_minutes",
    configGroup: "reservation",
    rulePath: ["cancelBeforeMinutes"],
    label: "取消截止时间",
    description: "距离预约开始前多少分钟后不可自助取消",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 120,
    step: 5
  },
  {
    configKey: "checkin_allow_before_minutes",
    configGroup: "checkin",
    rulePath: ["checkinAllowBeforeMinutes"],
    label: "允许提前签到",
    description: "预约开始前可提前签到的分钟数",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 120,
    step: 5
  },
  {
    configKey: "checkin_allow_after_minutes",
    configGroup: "checkin",
    rulePath: ["checkinAllowAfterMinutes"],
    label: "允许延后签到",
    description: "预约开始后最晚可签到的分钟数",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 120,
    step: 5
  },
  {
    configKey: "checkin_location_latitude",
    configGroup: "checkin",
    rulePath: ["checkinLocationLatitude"],
    label: "签到中心纬度",
    description: "图书馆签到中心点纬度，配置为 0 表示暂不启用严格定位范围校验",
    valueType: "number",
    inputType: "number",
    min: -90,
    max: 90,
    step: 0.000001
  },
  {
    configKey: "checkin_location_longitude",
    configGroup: "checkin",
    rulePath: ["checkinLocationLongitude"],
    label: "签到中心经度",
    description: "图书馆签到中心点经度，配置为 0 表示暂不启用严格定位范围校验",
    valueType: "number",
    inputType: "number",
    min: -180,
    max: 180,
    step: 0.000001
  },
  {
    configKey: "checkin_location_radius_meters",
    configGroup: "checkin",
    rulePath: ["checkinLocationRadiusMeters"],
    label: "签到允许半径",
    description: "定位签到允许距离图书馆中心点的最大半径，单位米",
    valueType: "number",
    inputType: "number",
    min: 10,
    max: 2000,
    step: 10
  },
  {
    configKey: "max_leave_times",
    configGroup: "checkin",
    rulePath: ["maxLeaveTimes"],
    label: "最多暂离次数",
    description: "单次预约最多允许发起几次暂离",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 10,
    step: 1
  },
  {
    configKey: "max_leave_minutes_each",
    configGroup: "checkin",
    rulePath: ["maxLeaveMinutesEach"],
    label: "单次暂离上限",
    description: "每次暂离最长允许多少分钟",
    valueType: "number",
    inputType: "number",
    min: 5,
    max: 180,
    step: 5
  },
  {
    configKey: "max_leave_minutes_total",
    configGroup: "checkin",
    rulePath: ["maxLeaveMinutesTotal"],
    label: "累计暂离上限",
    description: "单次预约累计暂离总分钟数上限",
    valueType: "number",
    inputType: "number",
    min: 5,
    max: 240,
    step: 5
  },
  {
    configKey: "initial_credit_score",
    configGroup: "credit",
    rulePath: ["initialCreditScore"],
    label: "初始信用分",
    description: "新用户注册时默认信用分",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 100,
    step: 1
  },
  {
    configKey: "blacklist_credit_threshold",
    configGroup: "credit",
    rulePath: ["blacklistCreditThreshold"],
    label: "黑名单阈值",
    description: "信用分低于该值时进入黑名单",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 100,
    step: 1
  },
  {
    configKey: "blacklist_days",
    configGroup: "credit",
    rulePath: ["blacklistDays"],
    label: "黑名单时长",
    description: "进入黑名单后默认限制天数",
    valueType: "number",
    inputType: "number",
    min: 1,
    max: 60,
    step: 1
  },
  {
    configKey: "penalty_no_show",
    configGroup: "credit",
    rulePath: ["penalties", "noShow"],
    label: "未签到扣分",
    description: "超过签到截止仍未签到时扣除的信用分",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 100,
    step: 1
  },
  {
    configKey: "penalty_leave_timeout",
    configGroup: "credit",
    rulePath: ["penalties", "leaveTimeout"],
    label: "暂离超时扣分",
    description: "暂离超时未返座时扣除的信用分",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 100,
    step: 1
  },
  {
    configKey: "penalty_manual_severe",
    configGroup: "credit",
    rulePath: ["penalties", "severe"],
    label: "严重违规扣分",
    description: "管理员人工判定严重违规时扣除的信用分",
    valueType: "number",
    inputType: "number",
    min: 0,
    max: 100,
    step: 1
  }
];

const RULE_CONFIG_KEYS = RULE_CONFIG_DEFINITIONS.map((item) => item.configKey);

function cloneRules(source = defaultRules) {
  return JSON.parse(JSON.stringify(source));
}

function getValueByPath(target, path) {
  return path.reduce((current, key) => (current == null ? undefined : current[key]), target);
}

function setValueByPath(target, path, value) {
  let current = target;

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[path[path.length - 1]] = value;
}

function getRuleConfigDefinition(configKey) {
  return RULE_CONFIG_DEFINITIONS.find((item) => item.configKey === configKey) || null;
}

function parseConfigValue(valueType, value) {
  if (valueType === "number") {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  if (valueType === "boolean") {
    return String(value).trim() === "true";
  }

  return String(value || "").trim();
}

function normalizeConfigInput(definition, rawValue) {
  const text = String(rawValue == null ? "" : rawValue).trim();

  if (!definition) {
    throw new Error("未找到对应的规则配置项");
  }

  if (!text) {
    throw new Error(`请填写“${definition.label}”`);
  }

  if (definition.valueType === "time") {
    if (!/^\d{2}:\d{2}$/.test(text)) {
      throw new Error(`“${definition.label}”必须是 HH:MM 格式`);
    }

    return {
      parsedValue: text,
      storedValue: text
    };
  }

  if (definition.valueType === "number") {
    const numberValue = Number(text);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`“${definition.label}”必须是数字`);
    }

    if (definition.min !== undefined && numberValue < definition.min) {
      throw new Error(`“${definition.label}”不能小于 ${definition.min}`);
    }

    if (definition.max !== undefined && numberValue > definition.max) {
      throw new Error(`“${definition.label}”不能大于 ${definition.max}`);
    }

    return {
      parsedValue: numberValue,
      storedValue: String(numberValue)
    };
  }

  if (definition.valueType === "boolean") {
    const normalized = text === "true" || text === "1";
    return {
      parsedValue: normalized,
      storedValue: normalized ? "true" : "false"
    };
  }

  return {
    parsedValue: text,
    storedValue: text
  };
}

function buildRulesFromConfigRows(rows = []) {
  const rules = cloneRules(defaultRules);
  const rowMap = new Map((rows || []).map((row) => [row.configKey, row]));

  RULE_CONFIG_DEFINITIONS.forEach((definition) => {
    const matchedRow = rowMap.get(definition.configKey);
    if (!matchedRow) {
      return;
    }

    const parsedValue = parseConfigValue(definition.valueType, matchedRow.configValue);
    if (parsedValue === null || parsedValue === undefined || parsedValue === "") {
      return;
    }

    setValueByPath(rules, definition.rulePath, parsedValue);
  });

  return rules;
}

function buildRuleConfigItems(rows = []) {
  const rowMap = new Map((rows || []).map((row) => [row.configKey, row]));
  const activeRules = buildRulesFromConfigRows(rows);

  return RULE_CONFIG_DEFINITIONS.map((definition) => {
    const matchedRow = rowMap.get(definition.configKey) || null;
    const currentValue = getValueByPath(activeRules, definition.rulePath);
    const defaultValue = getValueByPath(defaultRules, definition.rulePath);

    return {
      configKey: definition.configKey,
      configGroup: definition.configGroup,
      groupLabel: (RULE_CONFIG_GROUPS[definition.configGroup] || {}).label || definition.configGroup,
      label: definition.label,
      description: definition.description,
      valueType: definition.valueType,
      inputType: definition.inputType || definition.valueType,
      value: currentValue,
      defaultValue,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      updatedAt: matchedRow ? matchedRow.updatedAt : null
    };
  });
}

async function queryRuleConfigRows(executor = query) {
  const placeholders = RULE_CONFIG_KEYS.map(() => "?").join(", ");
  const [rows] = await executor(
    `
      SELECT
        config_key AS configKey,
        config_group AS configGroup,
        config_value AS configValue,
        value_type AS valueType,
        description,
        updated_at AS updatedAt
      FROM system_config
      WHERE config_key IN (${placeholders})
      ORDER BY config_group ASC, config_key ASC
    `,
    RULE_CONFIG_KEYS
  );

  return rows;
}

async function getActiveRules() {
  try {
    const rows = await queryRuleConfigRows();
    return buildRulesFromConfigRows(rows);
  } catch (error) {
    return cloneRules(defaultRules);
  }
}

module.exports = {
  RULE_CONFIG_GROUPS,
  RULE_CONFIG_DEFINITIONS,
  RULE_CONFIG_KEYS,
  cloneRules,
  getRuleConfigDefinition,
  normalizeConfigInput,
  buildRulesFromConfigRows,
  buildRuleConfigItems,
  queryRuleConfigRows,
  getActiveRules
};
