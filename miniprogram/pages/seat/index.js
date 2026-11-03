const api = require("../../services/api");
const { getOffsetDate } = require("../../utils/date");
const { ensureLoggedIn } = require("../../utils/auth");
const { consumeTabRouteOptions, openPage } = require("../../utils/navigation");
const { getLatestAssistantResult, setLatestAssistantResult, clearLatestAssistantResult } = require("../../utils/assistant-store");
const {
  decorateSeatFeaturePreview,
  decorateSeatFeatureCollection,
  toggleSeatFeaturePreviewById
} = require("../../utils/seat-feature");
const {
  assistantPrompts,
  spaceGuides,
  featureGallery,
  libraryAssets
} = require("../../config/showcase");

function syncTabBar(page) {
  const tabBar = page && typeof page.getTabBar === "function" ? page.getTabBar() : null;
  if (tabBar && typeof tabBar.syncSelected === "function") {
    tabBar.syncSelected();
  }
}

const BAND_META = {
  north: {
    label: "北侧分区",
    order: 1
  },
  west: {
    label: "西侧分区",
    order: 2
  },
  east: {
    label: "东侧分区",
    order: 3
  },
  south_inner: {
    label: "南侧内圈",
    order: 4
  },
  south_outer: {
    label: "南侧外圈",
    order: 5
  }
};

const PLAN_LEGEND_ITEMS = [
  { tone: "hot", label: "充足 10+" },
  { tone: "warm", label: "较多 4-9" },
  { tone: "cool", label: "紧张 1-3" },
  { tone: "empty", label: "已满 0" }
];

const STATUS_GUIDE_ITEMS = [
  { tone: "available", label: "可预约" },
  { tone: "reserved", label: "已预约" },
  { tone: "occupied", label: "使用中" },
  { tone: "leave", label: "暂离中" },
  { tone: "maintenance", label: "维护中" },
  { tone: "disabled", label: "已停用" }
];

const FLOOR_PLAN_IMAGE = libraryAssets.floorPlan;
const FLOOR_PLAN_STAGE_RATIO = Number((4768 / 4840 * 100).toFixed(2));
const PLAN_HORIZONTAL_NUMBERS = [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
const PLAN_SIDE_LETTERS = ["P", "N", "M", "L", "K", "H", "G", "F", "E", "D"];
const PLAN_LAYOUT = {
  north: {
    startX: 14.2,
    endX: 85.8,
    topY: 11.2
  },
  southInner: {
    startX: 27.8,
    endX: 72.2,
    topY: 80.2
  },
  southOuter: {
    startX: 15.3,
    endX: 84.7,
    topY: 88.6
  },
  west: {
    leftX: 10.1,
    startY: 18.2,
    endY: 81.6
  },
  east: {
    leftX: 89.9,
    startY: 18.2,
    endY: 81.6
  }
};

const FEATURE_GALLERY_MAP = new Map(featureGallery.map((item) => [item.key, item]));
const WORKSPACE_TABS = [
  { key: "map", label: "地图" },
  { key: "smart", label: "AI助手" }
];
const TIME_WINDOW_PRESETS = [
  { key: "morning", label: "上午", startTime: "09:00", endTime: "11:00" },
  { key: "afternoon", label: "下午", startTime: "14:00", endTime: "17:00" },
  { key: "evening", label: "晚上", startTime: "18:00", endTime: "21:00" }
];
const ASSISTANT_CHART_COLORS = ["#728b82", "#8ea79d", "#f0b67f", "#7f9fe2", "#b89de0", "#7dc2a5"];
const ASSISTANT_CHART_CANVAS_RPX = 260;

function runNextTick(callback) {
  if (typeof wx !== "undefined" && typeof wx.nextTick === "function") {
    wx.nextTick(callback);
    return;
  }

  setTimeout(callback, 0);
}

function getAssistantChartCanvasSize() {
  const fallbackWidth = 375;
  try {
    const systemInfo = typeof wx !== "undefined" && typeof wx.getWindowInfo === "function"
      ? wx.getWindowInfo()
      : (typeof wx !== "undefined" && typeof wx.getSystemInfoSync === "function"
        ? wx.getSystemInfoSync()
        : { windowWidth: fallbackWidth });
    const windowWidth = Number(systemInfo.windowWidth || fallbackWidth);
    return Math.max(96, Math.round(windowWidth * ASSISTANT_CHART_CANVAS_RPX / 750));
  } catch (error) {
    return Math.round(fallbackWidth * ASSISTANT_CHART_CANVAS_RPX / 750);
  }
}

function parseZoneCode(zoneCode) {
  const text = String(zoneCode || "");
  const matched = text.match(/^([A-Z]+)(\d+)$/i);

  return {
    text,
    letter: matched ? matched[1].toUpperCase() : text,
    number: matched ? Number(matched[2]) : Number.MAX_SAFE_INTEGER
  };
}

function compareZoneCode(left, right) {
  const leftZone = parseZoneCode(left.zoneCode || left);
  const rightZone = parseZoneCode(right.zoneCode || right);

  return (
    leftZone.letter.localeCompare(rightZone.letter) ||
    leftZone.number - rightZone.number ||
    leftZone.text.localeCompare(rightZone.text)
  );
}

function compareCodeWithNumber(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function compareGridLetterDescending(left, right) {
  return String(right || "").localeCompare(String(left || ""), "en", {
    sensitivity: "base"
  });
}

function interpolatePosition(index, total, start, end) {
  if (total <= 1) {
    return Number(((start + end) / 2).toFixed(2));
  }

  const ratio = index / (total - 1);
  return Number((start + (end - start) * ratio).toFixed(2));
}

function getZoneGridPosition(zone) {
  const gridLetter = String(zone && zone.gridLetter ? zone.gridLetter : "").toUpperCase();
  const gridNumber = Number(zone && zone.gridNumber);

  if (gridLetter && Number.isFinite(gridNumber)) {
    return {
      gridLetter,
      gridNumber
    };
  }

  const parsed = parseZoneCode(zone && zone.zoneCode);
  return {
    gridLetter: parsed.letter || "",
    gridNumber: Number.isFinite(parsed.number) && parsed.number !== Number.MAX_SAFE_INTEGER
      ? parsed.number
      : null
  };
}

function normalizeFilterKeys(filters) {
  return Array.from(new Set((filters || []).filter(Boolean)));
}

function areSameFilters(left, right) {
  const leftNormalized = normalizeFilterKeys(left).sort();
  const rightNormalized = normalizeFilterKeys(right).sort();

  if (leftNormalized.length !== rightNormalized.length) {
    return false;
  }

  return leftNormalized.every((item, index) => item === rightNormalized[index]);
}

function getZoneTileTone(matchedSeatCount) {
  if (matchedSeatCount >= 10) {
    return "hot";
  }

  if (matchedSeatCount >= 4) {
    return "warm";
  }

  if (matchedSeatCount > 0) {
    return "cool";
  }

  return "empty";
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getBandLabel(band) {
  return ((BAND_META[band] || {}).label || "当前分区");
}

function getPlanPlacement(normalizedZone) {
  const gridNumberIndex = PLAN_HORIZONTAL_NUMBERS.indexOf(normalizedZone.gridNumber);
  const sideLetterIndex = PLAN_SIDE_LETTERS.indexOf(normalizedZone.gridLetter);
  let leftPercent = 50;
  let topPercent = 50;
  let shape = "horizontal";

  if (normalizedZone.band === "north") {
    const layout = PLAN_LAYOUT.north;
    leftPercent = interpolatePosition(
      Math.max(gridNumberIndex, 0),
      PLAN_HORIZONTAL_NUMBERS.length,
      layout.startX,
      layout.endX
    );
    topPercent = layout.topY;
  } else if (normalizedZone.band === "south_inner") {
    const layout = PLAN_LAYOUT.southInner;
    leftPercent = interpolatePosition(
      Math.max(gridNumberIndex, 0),
      PLAN_HORIZONTAL_NUMBERS.length,
      layout.startX,
      layout.endX
    );
    topPercent = layout.topY;
  } else if (normalizedZone.band === "south_outer") {
    const layout = PLAN_LAYOUT.southOuter;
    leftPercent = interpolatePosition(
      Math.max(gridNumberIndex, 0),
      PLAN_HORIZONTAL_NUMBERS.length,
      layout.startX,
      layout.endX
    );
    topPercent = layout.topY;
  } else if (normalizedZone.band === "west") {
    const layout = PLAN_LAYOUT.west;
    leftPercent = layout.leftX;
    topPercent = interpolatePosition(
      Math.max(sideLetterIndex, 0),
      PLAN_SIDE_LETTERS.length,
      layout.startY,
      layout.endY
    );
    shape = "side";
  } else if (normalizedZone.band === "east") {
    const layout = PLAN_LAYOUT.east;
    leftPercent = layout.leftX;
    topPercent = interpolatePosition(
      Math.max(sideLetterIndex, 0),
      PLAN_SIDE_LETTERS.length,
      layout.startY,
      layout.endY
    );
    shape = "side";
  }

  return {
    leftPercent,
    topPercent,
    shape
  };
}

function buildZoneGroups(zones, activeZone) {
  const groups = new Map();

  (zones || []).forEach((zone) => {
    const bandKey = zone.band || "other";
    const groupMeta = BAND_META[bandKey] || {
      label: bandKey || "其他分区",
      order: 99
    };

    if (!groups.has(bandKey)) {
      groups.set(bandKey, {
        band: bandKey,
        label: groupMeta.label,
        order: groupMeta.order,
        items: []
      });
    }

    const selected = zone.zoneCode === activeZone;
    const matchedSeatCount = Number(zone.matchedSeatCount || 0);

    groups.get(bandKey).items.push({
      ...zone,
      selected,
      matchedSeatCount,
      tone: getZoneTileTone(matchedSeatCount)
    });
  });

  return Array.from(groups.values())
    .map((group) => {
      const items = group.items.sort(compareZoneCode);
      return {
        ...group,
        items,
        zoneCount: items.length,
        availableZoneCount: items.filter((item) => item.matchedSeatCount > 0).length
      };
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}

function buildActiveZoneDetail(zones, activeZone) {
  return (zones || []).find((item) => item.zoneCode === activeZone) || null;
}

function buildActiveZoneStats(activeZoneDetail) {
  if (!activeZoneDetail) {
    return [];
  }

  return [
    {
      label: "分区总座位",
      value: activeZoneDetail.seatCount || 0
    },
    {
      label: "桌组数量",
      value: activeZoneDetail.tableGroupCount || 0
    },
    {
      label: "可约座位",
      value: activeZoneDetail.matchedSeatCount || 0
    }
  ];
}

function buildFloorMap(zones, activeZone) {
  const normalizedZones = (zones || [])
    .map((item) => ({
      ...item,
      ...getZoneGridPosition(item)
    }))
    .filter((item) => item.gridLetter && Number.isFinite(item.gridNumber));

  const gridNumbers = Array.from(
    new Set(normalizedZones.map((item) => item.gridNumber))
  ).sort((left, right) => left - right);
  const gridLetters = Array.from(
    new Set(normalizedZones.map((item) => item.gridLetter))
  ).sort(compareGridLetterDescending);

  if (!gridNumbers.length || !gridLetters.length) {
    return {
      columns: [],
      rows: [],
      gridStyle: ""
    };
  }

  const zoneMap = new Map(normalizedZones.map((item) => [`${item.gridLetter}-${item.gridNumber}`, item]));

  const rows = gridLetters.map((gridLetter) => ({
    gridLetter,
    cells: gridNumbers.map((gridNumber) => {
      const zone = zoneMap.get(`${gridLetter}-${gridNumber}`);

      if (!zone) {
        return {
          key: `${gridLetter}-${gridNumber}`,
          empty: true,
          tone: "empty"
        };
      }

      const matchedSeatCount = Number(zone.matchedSeatCount || 0);

      return {
        ...zone,
        key: zone.zoneCode,
        empty: false,
        selected: zone.zoneCode === activeZone,
        tone: getZoneTileTone(matchedSeatCount),
        matchedSeatCount
      };
    })
  }));

  return {
    columns: gridNumbers,
    rows,
    gridStyle: `grid-template-columns: 88rpx repeat(${gridNumbers.length}, minmax(144rpx, 1fr));`
  };
}

function buildPlanHotspots(zones, activeZone) {
  return (zones || []).map((zone) => {
    const normalizedZone = {
      ...zone,
      ...getZoneGridPosition(zone)
    };
    const placement = getPlanPlacement(normalizedZone);
    const tone = getZoneTileTone(Number(normalizedZone.matchedSeatCount || 0));

    return {
      ...normalizedZone,
      key: normalizedZone.zoneCode,
      selected: normalizedZone.zoneCode === activeZone,
      tone,
      shape: placement.shape,
      hotspotStyle: `left:${placement.leftPercent}%;top:${placement.topPercent}%;`
    };
  });
}

function getZonePreviewScale(band) {
  if (band === "west" || band === "east") {
    return 2.8;
  }

  if (band === "south_outer") {
    return 2.55;
  }

  return 2.35;
}

function buildActiveZonePreview(zones, activeZone) {
  const activeZoneDetail = buildActiveZoneDetail(zones, activeZone);

  if (!activeZoneDetail) {
    return null;
  }

  const normalizedZone = {
    ...activeZoneDetail,
    ...getZoneGridPosition(activeZoneDetail)
  };
  const placement = getPlanPlacement(normalizedZone);
  const scale = getZonePreviewScale(normalizedZone.band);
  const scaledSize = Number((scale * 100).toFixed(2));
  const previewLeft = clampNumber(
    Number((50 - placement.leftPercent * scale).toFixed(2)),
    100 - scaledSize,
    0
  );
  const previewTop = clampNumber(
    Number((50 - placement.topPercent * scale).toFixed(2)),
    100 - scaledSize,
    0
  );
  const ringLeft = clampNumber(
    Number((previewLeft + placement.leftPercent * scale).toFixed(2)),
    8,
    92
  );
  const ringTop = clampNumber(
    Number((previewTop + placement.topPercent * scale).toFixed(2)),
    8,
    92
  );

  return {
    zoneCode: normalizedZone.zoneCode,
    displayName: normalizedZone.displayName,
    bandLabel: getBandLabel(normalizedZone.band),
    previewImageStyle: `width:${scaledSize}%;height:${scaledSize}%;left:${previewLeft}%;top:${previewTop}%;`,
    ringShape: placement.shape === "side" ? "side" : "circle",
    ringStyle: `left:${ringLeft}%;top:${ringTop}%;`
  };
}

function hasSunlightFeature(seat) {
  if (!seat) {
    return false;
  }

  const sunlightText = String(seat.sunlight || "");
  return (
    sunlightText.includes("有") ||
    sunlightText.includes("充足") ||
    ((seat.tagKeys || []).includes("sunlight_yes"))
  );
}

function seatMatchesFilterFeature(seat, filterKey) {
  if (!seat || !filterKey) {
    return false;
  }

  switch (filterKey) {
    case "power_outlet":
      return Boolean(seat.hasPower);
    case "window":
      return Boolean(seat.nearWindow);
    case "quiet":
      return seat.quietLevel === "安静";
    case "balanced_temperature":
      return seat.nearAC === false;
    case "quiet_position":
      return seat.nearCorridor === false;
    case "table_4":
      return String(seat.seatType || "").includes("4人桌");
    case "table_8":
      return String(seat.seatType || "").includes("8人桌");
    case "near_restroom":
      return Boolean(seat.nearRestroom);
    case "sunlight_yes":
      return hasSunlightFeature(seat);
    default:
      return false;
  }
}

function buildFeatureAtlasCards(activeFilters, filterOptions) {
  const descriptionMap = new Map((filterOptions || []).map((item) => [item.key, item.description]));

  return featureGallery
    .map((item, index) => {
      const isFilterCard = item.actionType === "filter";
      const selected = isFilterCard && activeFilters.includes(item.actionValue);

      return {
        ...item,
        selected,
        sortWeight: selected ? 0 : (isFilterCard ? 1 : 2),
        displayBadge: selected ? "已启用" : item.badge,
        actionHint: isFilterCard ? (selected ? "点击可取消筛选" : "点击可加入筛选") : "馆内设施参考",
        detailText: (isFilterCard && descriptionMap.get(item.actionValue)) || item.note,
        originalIndex: index
      };
    })
    .sort((left, right) => left.sortWeight - right.sortWeight || left.originalIndex - right.originalIndex);
}

function getSelectedSeatFeatureKeys(seat) {
  if (!seat) {
    return [];
  }

  const keys = [];
  [
    "power_outlet",
    "window",
    "sunlight_yes",
    "quiet",
    "balanced_temperature",
    "quiet_position",
    "table_4",
    "table_8",
    "near_restroom"
  ].forEach((key) => {
    if (seatMatchesFilterFeature(seat, key)) {
      keys.push(key);
    }
  });

  if (seat.nearPantry) {
    keys.push("pantry");
  }

  return Array.from(new Set(keys));
}

function getSeatFeatureNote(key) {
  switch (key) {
    case "power_outlet":
      return "该座位支持设备用电，适合带电脑、平板或充电需求。";
    case "window":
      return "该座位靠窗，视野更开阔，也更适合白天阅读。";
    case "sunlight_yes":
      return "白天采光更充足，适合看书、写字和长时间停留。";
    case "quiet":
      return "所在区域整体更安静，适合连续专注或备考复习。";
    case "balanced_temperature":
      return "相对避开空调直吹区域，长时间坐着会更舒服。";
    case "quiet_position":
      return "相对远离主通道，人员走动带来的打扰更少。";
    case "table_4":
      return "4 人桌更灵活，适合单人、双人或轻量讨论。";
    case "table_8":
      return "8 人桌更适合结伴自习、多人作业或小组协作。";
    case "near_restroom":
      return "离卫生间更近，短时停留或中途离席更方便。";
    case "pantry":
      return "靠近开水间，长时间学习时补水会更方便。";
    default:
      return "";
  }
}

function buildSelectedSeatFeatureCards(selectedSeat, activeFilters) {
  if (!selectedSeat) {
    return [];
  }

  const matchedKeys = (activeFilters || []).filter((key) =>
    FEATURE_GALLERY_MAP.has(key) && seatMatchesFilterFeature(selectedSeat, key)
  );
  const seatFeatureKeys = getSelectedSeatFeatureKeys(selectedSeat);
  const orderedKeys = Array.from(new Set([...matchedKeys, ...seatFeatureKeys])).slice(0, 4);

  return orderedKeys
    .map((key) => {
      const base = FEATURE_GALLERY_MAP.get(key);
      if (!base) {
        return null;
      }

      const highlighted = matchedKeys.includes(key);
      return {
        ...base,
        highlighted,
        displayBadge: highlighted ? "命中偏好" : "环境特征",
        detailText: getSeatFeatureNote(key)
      };
    })
    .filter(Boolean);
}

function buildSelectedSeatFeatureSummary(featureCards) {
  if (!featureCards.length) {
    return "";
  }

  const highlightedCount = featureCards.filter((item) => item.highlighted).length;

  if (highlightedCount) {
    return `当前选中座位命中了 ${highlightedCount} 项已启用偏好，并具备以下可视化环境特征。`;
  }

  return "当前选中座位的主要环境特征如下，可以直接结合实景图进行说明。";
}

function decorateWorkspaceTabs(activeKey) {
  return WORKSPACE_TABS.map((item) => ({
    ...item,
    selected: item.key === activeKey
  }));
}

function buildTimeQuickOptions(startTime, endTime) {
  return TIME_WINDOW_PRESETS.map((item) => ({
    ...item,
    selected: item.startTime === startTime && item.endTime === endTime
  }));
}

function getAssistantFilterHint(filterItem) {
  switch (filterItem && filterItem.key) {
    case "power_outlet":
      return "设备需求已识别";
    case "window":
      return "靠窗偏好已识别";
    case "quiet":
      return "安静需求已识别";
    case "balanced_temperature":
      return "温度舒适已识别";
    case "quiet_position":
      return "避开通道已识别";
    case "table_4":
      return "偏向小桌学习";
    case "table_8":
      return "偏向多人桌组";
    case "near_restroom":
      return "便利需求已识别";
    case "sunlight_yes":
      return "采光偏好已识别";
    default:
      return "需求已识别";
  }
}

function buildAssistantInsightModel(result) {
  const recognizedFilters = (result && result.recognizedFilters) || [];
  const scene = (result && result.scene) || null;
  const timeWindow = (result && result.timeWindow) || null;
  const topSeat = (result && result.topSeats && result.topSeats[0]) || null;
  const segmentsSource = recognizedFilters.length
    ? recognizedFilters.slice(0, 5)
    : [{ key: "general", label: "综合偏好", reason: "建议补充更具体的需求" }];
  let remainder = 100;
  const segments = segmentsSource.map((item, index) => {
    const value = index === segmentsSource.length - 1
      ? remainder
      : Number((100 / segmentsSource.length).toFixed(2));
    remainder = Number((remainder - value).toFixed(2));
    return {
      label: item.label,
      value,
      color: ASSISTANT_CHART_COLORS[index % ASSISTANT_CHART_COLORS.length],
      note: getAssistantFilterHint(item)
    };
  });
  const matchedCount = topSeat && Number.isFinite(Number(topSeat.matchedFilterCount))
    ? Number(topSeat.matchedFilterCount)
    : Math.min(
        recognizedFilters.length,
        Number((topSeat && topSeat.reasons && topSeat.reasons.length) || 0)
      );
  const fitPercentText = topSeat && topSeat.fitPercent
    ? String(topSeat.fitPercent).includes("%")
      ? String(topSeat.fitPercent)
      : `${topSeat.fitPercent}%`
    : `${Math.min(95, 42 + recognizedFilters.length * 12)}%`;
  const parsedPercent = Number(String(fitPercentText).replace("%", ""));
  const progressPercent = Number.isFinite(parsedPercent)
    ? Math.max(0, Math.min(parsedPercent, 100))
    : Math.min(95, 42 + recognizedFilters.length * 12);

  return {
    centerValue: fitPercentText,
    centerLabel: topSeat ? "首推匹配度" : "需求清晰度",
    progressPercent,
    progressColor: segments[0] ? segments[0].color : ASSISTANT_CHART_COLORS[0],
    legend: segments,
    stats: [
      { label: "已识别", value: `${recognizedFilters.length || 1} 项` },
      { label: "场景", value: (scene && scene.label) || "综合" },
      {
        label: "首推命中",
        value: topSeat && recognizedFilters.length
          ? `${matchedCount}/${recognizedFilters.length}`
          : (topSeat ? "已生成" : "待生成")
      },
      { label: "时间", value: (timeWindow && timeWindow.label) || "当前时段" }
    ]
  };
}

function getEvidenceCountText(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? `${numericValue}` : fallback;
}

function buildEvidenceProcessRows(evidence, modelLabel) {
  const sourceSteps = evidence && Array.isArray(evidence.processSteps)
    ? evidence.processSteps.filter((item) => item)
    : [];
  const fallbackSteps = [
    "解析自然语言需求、场景和时间窗",
    "筛出当前时间可预约的候选座位",
    `${modelLabel} 批量预测需求-座位匹配结果`,
    "结合偏好命中、冲突惩罚和可用状态排序"
  ];
  const steps = sourceSteps.length ? sourceSteps : fallbackSteps;

  return steps.slice(0, 4).map((item, index) => ({
    index: index + 1,
    text: typeof item === "string"
      ? item
      : (item.text || item.content || item.title || String(item))
  }));
}

function buildAlgorithmEvidenceView(result) {
  const evidence = (result && result.algorithmEvidence) || {};
  const taskType = evidence.taskType || "";
  const isMatchingTask = String(taskType).includes("匹配");
  const modelName = evidence.deploymentModelName || "推荐排序模型";
  const modelShortName = evidence.deploymentModelShortName || evidence.deploymentModelName || "模型";
  const deepLearningName = evidence.deepLearningModelName || "";
  const deepLearningShortName = evidence.deepLearningModelShortName || deepLearningName || "深度学习模型";
  const recognizedFilterCount = Number(
    (result && result.recognizedFilterCount) ||
    ((result && result.recognizedFilters && result.recognizedFilters.length) || 0)
  );
  const predictedSeatCount = Number(evidence.predictedSeatCount || 0);
  const inferenceDurationMs = Number(evidence.inferenceDurationMs || 0);
  const datasetDemandCount = Number(evidence.datasetDemandCount || 0);
  const datasetSeatCount = Number(evidence.datasetSeatCount || 0);
  const datasetFeatureCount = Number(evidence.datasetFeatureCount || 0);
  const datasetLabelCount = Number(evidence.datasetLabelCount || 0);
  const datasetParts = [];

  if (datasetDemandCount && datasetSeatCount) {
    datasetParts.push(`${datasetDemandCount} 条需求 × ${datasetSeatCount} 个座位`);
  } else if (datasetSeatCount) {
    datasetParts.push(`${datasetSeatCount} 个座位`);
  }
  if (datasetFeatureCount && datasetLabelCount) {
    datasetParts.push(`${datasetFeatureCount} 项特征 / ${datasetLabelCount} 类标签`);
  }

  const runtimeParts = [
    `解析 ${Number.isFinite(recognizedFilterCount) ? recognizedFilterCount : 0} 项偏好`
  ];
  if (predictedSeatCount) {
    runtimeParts.push(`预测 ${predictedSeatCount} 个候选`);
  }
  if (inferenceDurationMs) {
    runtimeParts.push(`${inferenceDurationMs} ms`);
  }

  return {
    processTitle: isMatchingTask ? "需求-座位匹配推理过程" : "AI 推荐推理过程",
    kicker: isMatchingTask ? "需求-座位匹配模型" : "AI 推理中枢",
    modelTitle: modelName,
    modelShortName,
    targetLabel: "TopN",
    badgeText: String(evidence.inferenceModeText || "").includes("实时") ? "实时预测" : "模型预测",
    runtimeText: runtimeParts.join(" · "),
    datasetText: datasetParts.join(" · "),
    summaryText: evidence.summaryText || "",
    deploymentReason: evidence.deploymentReason || "",
    processRows: buildEvidenceProcessRows(evidence, modelShortName),
    metricCards: [
      {
        value: evidence.deploymentModelMacroF1Text || "--",
        label: `${modelShortName} Macro-F1`
      },
      {
        value: evidence.deploymentModelMicroF1Text || "--",
        label: `${modelShortName} Micro-F1`
      },
      {
        value: getEvidenceCountText(predictedSeatCount, "--"),
        label: "候选样本"
      }
    ],
    hasDeepLearningComparison: Boolean(
      deepLearningName ||
      evidence.deepLearningModelMacroF1Text ||
      evidence.deepLearningModelMicroF1Text
    ),
    deepLearningTitle: deepLearningName || deepLearningShortName,
    deepLearningShortName,
    deepLearningNote: evidence.deepLearningNote || "同一需求-座位匹配数据集上的深度学习对比模型。",
    deepLearningMetrics: [
      {
        value: evidence.deepLearningModelMacroF1Text || "--",
        label: `${deepLearningShortName} Macro-F1`
      },
      {
        value: evidence.deepLearningModelMicroF1Text || "--",
        label: `${deepLearningShortName} Micro-F1`
      }
    ]
  };
}

function buildScenePresets(presets, filterOptions, activePresetKey) {
  const labelMap = new Map((filterOptions || []).map((item) => [item.key, item.label]));

  return (presets || []).map((preset) => ({
    ...preset,
    selected: preset.key === activePresetKey,
    filterLabels: (preset.filters || []).map((filterKey) => labelMap.get(filterKey) || filterKey),
    filterSummary: (preset.filters || [])
      .map((filterKey) => labelMap.get(filterKey) || filterKey)
      .slice(0, 3)
      .join(" · ") || "进入后可继续调整"
  }));
}

function detectPresetKey(presets, activeFilters) {
  const matchedPreset = (presets || []).find((preset) => areSameFilters(preset.filters || [], activeFilters));
  return matchedPreset ? matchedPreset.key : "";
}

function buildActivePreferenceSummary(activeFilterDetails, activePresetLabel) {
  if (!activeFilterDetails.length) {
    return "当前未设置硬性偏好，系统会优先按安静度、可用性与综合舒适度推荐座位。";
  }

  if (activePresetLabel) {
    return `已应用“${activePresetLabel}”场景，并保留 ${activeFilterDetails.length} 项偏好条件。`;
  }

  return `当前已启用 ${activeFilterDetails.length} 项偏好，系统会优先展示匹配度更高的座位。`;
}

function buildRecommendationSummaryView(response, activeFilterDetails, activePresetLabel) {
  if (response && response.recommendationSummary) {
    return {
      ...response.recommendationSummary,
      focusText: response.recommendationSummary.focusSeatId
        ? `建议先从 ${response.recommendationSummary.focusSeatId} 开始比较，再在同桌组里确认最终位置。`
        : "当前暂无可直接推荐的座位，请先调整时间窗或筛选条件。",
      hasHintTags: Boolean(
        response.recommendationSummary.hintTags &&
        response.recommendationSummary.hintTags.length
      ),
      modelNote: response.recommendationSummary.modelNote || "",
      relaxedTagText: response.recommendationSummary.isRelaxed ? "已自动放宽到最接近结果" : "完全命中当前偏好"
    };
  }

  const fallbackTags = (activeFilterDetails || []).map((item) => item.label).slice(0, 4);
  const topSeat = (response && response.topRecommendations && response.topRecommendations[0]) || null;

  return {
    title: activePresetLabel ? `${activePresetLabel}推荐` : "智能推荐结果",
    description: topSeat
      ? "已根据当前偏好、时间窗和分区状态优先选出更适合作为起点的座位。"
      : "当前筛选条件下暂无推荐座位，可以尝试放宽偏好后重新检索。",
    badge: `${(response && response.availableCount) || 0} 个可约`,
    hintTags: fallbackTags,
    hasHintTags: fallbackTags.length > 0,
    focusSeatId: topSeat ? topSeat.seatId : "",
    focusTableGroupCode: topSeat ? topSeat.tableGroupCode : "",
    focusText: topSeat
      ? `建议先从 ${topSeat.seatId} 开始比较，再在同桌组里确认最终位置。`
      : "当前暂无可直接推荐的座位，请先调整时间窗或筛选条件。",
    modelNote: "当前推荐已结合需求-座位匹配逻辑、偏好命中和可预约状态。",
    relaxedTagText: "完全命中当前偏好"
  };
}

function getSeatDisplayScore(seat) {
  return seat.recommendationBadge || `${seat.score || 0} 分`;
}

function decorateSeatDisplay(seat, activeFilters) {
  return decorateSeatFeaturePreview({
    ...seat,
    displayScore: getSeatDisplayScore(seat),
    selectActionLabel: seat.canReserve ? "选择这个座位" : "查看详情",
    sceneModelText: seat.sceneModelLabel
      ? `${seat.algorithmModelShortName || "模型"}预测：${seat.sceneModelLabel}`
      : "",
    sceneModelMetaText: seat.sceneModelConfidenceText || ""
  }, activeFilters);
}

function decorateSeatCollections(seats, activeFilters) {
  return (seats || []).map((seat) => decorateSeatDisplay(seat, activeFilters));
}

function decorateAssistantResult(result, activeFilters) {
  if (!result) {
    return null;
  }

  return {
    ...result,
    algorithmEvidenceView: buildAlgorithmEvidenceView(result),
    topSeats: decorateSeatFeatureCollection(result.topSeats || [], activeFilters),
    candidateSeats: decorateSeatFeatureCollection(result.candidateSeats || [], activeFilters)
  };
}

function buildReservationActionLabel(selectedSeat) {
  if (!selectedSeat) {
    return "确认预约";
  }

  return selectedSeat.canReserve ? "确认预约" : "当前不可预约";
}

function buildFullSeatListToggleText(showFullSeatList) {
  return showFullSeatList ? "收起完整列表" : "展开完整列表";
}

function buildSeatFeatureToggleText(expanded) {
  return expanded ? "收起特征预览" : "展开特征预览";
}

function getTableGroupLabel(tableGroupCode) {
  const parts = String(tableGroupCode || "").split("-");
  return parts.length >= 2 ? `${parts[1]}组` : String(tableGroupCode || "");
}

function getTableGroupCode(tableGroupCode) {
  const parts = String(tableGroupCode || "").split("-");
  return parts.length >= 2 ? parts[1] : String(tableGroupCode || "");
}

function getTableGroupTone(availableCount, seatCount) {
  if (!availableCount) {
    return "empty";
  }

  if (availableCount === seatCount) {
    return "full";
  }

  if (availableCount >= Math.ceil(seatCount / 2)) {
    return "partial";
  }

  return "limited";
}

function compareSeatOrder(left, right) {
  const leftSeq = Number(left.seatSeq);
  const rightSeq = Number(right.seatSeq);

  if (Number.isFinite(leftSeq) && Number.isFinite(rightSeq) && leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return compareCodeWithNumber(left.seatId, right.seatId);
}

function isNearWindowSeat(seat) {
  return Boolean(seat && (seat.nearWindow || (seat.tagKeys || []).includes("window")));
}

function buildSeatInlineGridStyle(seatCount) {
  const visualColumns = Math.max(Number(seatCount) || 0, 2);
  return `grid-template-columns: repeat(${visualColumns}, minmax(104rpx, 1fr)); width: ${visualColumns * 116 - 12}rpx; min-width: 100%;`;
}

function buildSeatVisualRows(items) {
  const seats = (items || []).slice().sort(compareSeatOrder);
  if (!seats.length) {
    return [];
  }

  return [{
    rowKey: "row-main",
    rowRole: "inline",
    rowLabel: "",
    seats,
    visualGridStyle: buildSeatInlineGridStyle(seats.length)
  }];
}

function getSeatVisualLabel(seat) {
  if (seat.seatSeqLabel) {
    return seat.seatSeqLabel;
  }

  const seatSeq = Number(seat.seatSeq);
  if (Number.isFinite(seatSeq)) {
    return String(seatSeq).padStart(2, "0");
  }

  const segments = String(seat.seatId || "").split("-");
  return segments[segments.length - 1] || String(seat.seatId || "--");
}

function buildTableGroups(seats, selectedSeatId, recommendedSeatIds) {
  const groups = new Map();
  const recommendedSeatIdSet = new Set(recommendedSeatIds || []);

  (seats || []).forEach((seat) => {
    const groupKey = seat.tableGroupCode || seat.seatId;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        tableGroupCode: groupKey,
        zoneDisplayName: seat.zoneDisplayName,
        zoneCode: seat.zoneCode,
        seatType: seat.seatType,
        items: []
      });
    }

    groups.get(groupKey).items.push({
      ...seat,
      isSelected: seat.seatId === selectedSeatId,
      isRecommended: recommendedSeatIdSet.has(seat.seatId),
      isNearWindow: isNearWindowSeat(seat),
      windowBadge: isNearWindowSeat(seat) ? "靠窗" : "",
      visualLabel: getSeatVisualLabel(seat),
      visualHint: seat.canReserve ? (recommendedSeatIdSet.has(seat.seatId) ? "推荐" : "可约") : seat.statusLabel
    });
  });

  return Array.from(groups.values())
    .map((group) => {
      const items = group.items.sort(compareSeatOrder);
      const windowSeatIds = new Set(
        items.filter((item) => item.isNearWindow).slice(0, 2).map((item) => item.seatId)
      );
      items.forEach((item) => {
        item.windowBadge = windowSeatIds.has(item.seatId) ? "靠窗" : "";
      });
      const seatRows = buildSeatVisualRows(items);
      const topSeats = items;
      const bottomSeats = [];
      const maxVisualColumns = Math.max(items.length, 2);

      return {
        ...group,
        items,
        topSeats,
        bottomSeats,
        seatRows,
        tableCode: getTableGroupCode(group.tableGroupCode),
        groupLabel: getTableGroupLabel(group.tableGroupCode),
        seatCount: items.length,
        availableCount: items.filter((item) => item.canReserve).length,
        unavailableCount: items.filter((item) => !item.canReserve).length,
        recommendedCount: items.filter((item) => item.isRecommended).length,
        selected: items.some((item) => item.isSelected),
        groupTone: getTableGroupTone(
          items.filter((item) => item.canReserve).length,
          items.length
        ),
        tableShape: items.length >= 8 ? "wide" : "compact",
        maxVisualColumns,
        visualSeats: items,
        visualGridStyle: buildSeatInlineGridStyle(maxVisualColumns)
      };
    })
    .sort((left, right) => compareCodeWithNumber(left.tableGroupCode, right.tableGroupCode));
}

function pickActiveTableGroupCode(tableGroups, currentCode, selectedSeat) {
  if (selectedSeat && selectedSeat.tableGroupCode) {
    const matchedBySeat = (tableGroups || []).find((item) => item.tableGroupCode === selectedSeat.tableGroupCode);
    if (matchedBySeat) {
      return matchedBySeat.tableGroupCode;
    }
  }

  if (currentCode) {
    const matchedCurrent = (tableGroups || []).find((item) => item.tableGroupCode === currentCode);
    if (matchedCurrent) {
      return matchedCurrent.tableGroupCode;
    }
  }

  const firstAvailable = (tableGroups || []).find((item) => item.availableCount > 0);
  return firstAvailable ? firstAvailable.tableGroupCode : (((tableGroups || [])[0] || {}).tableGroupCode || "");
}

function decorateTableGroups(tableGroups, activeTableGroupCode) {
  return (tableGroups || []).map((item) => ({
    ...item,
    isActive: item.tableGroupCode === activeTableGroupCode
  }));
}

function buildActiveTableGroupDetail(tableGroups, activeTableGroupCode) {
  return (tableGroups || []).find((item) => item.tableGroupCode === activeTableGroupCode) || null;
}

function buildZoneWorkbench(tableGroups, activeZoneDetail) {
  if (!activeZoneDetail) {
    return null;
  }

  const layoutType = activeZoneDetail.band === "west" || activeZoneDetail.band === "east"
    ? "vertical"
    : "horizontal";
  const orderedGroups = (tableGroups || []).slice().sort((left, right) => (
    compareCodeWithNumber(left.tableGroupCode, right.tableGroupCode)
  ));
  const splitIndex = Math.ceil(orderedGroups.length / 2);

  return {
    layoutType,
    primaryLabel: layoutType === "vertical" ? "左列桌组" : "上排桌组",
    secondaryLabel: layoutType === "vertical" ? "右列桌组" : "下排桌组",
    aisleLabel: "中间通道",
    primaryItems: orderedGroups.slice(0, splitIndex),
    secondaryItems: orderedGroups.slice(splitIndex),
    availableGroupCount: orderedGroups.filter((item) => item.availableCount > 0).length,
    recommendedGroupCount: orderedGroups.filter((item) => item.recommendedCount > 0).length
  };
}

function buildReservationCheckSummary(checks, failedOnly) {
  return (checks || [])
    .filter((item) => (failedOnly ? !item.passed : true))
    .map((item) => `${item.passed ? "通过" : "未通过"} ${item.label}${item.detail ? `：${item.detail}` : ""}`)
    .join("\n");
}

function decodeRouteValue(value) {
  let decodedValue = String(value || "").trim();
  if (!decodedValue) {
    return "";
  }

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextValue = decodeURIComponent(decodedValue);
      if (nextValue === decodedValue) {
        break;
      }
      decodedValue = nextValue;
    } catch (error) {
      break;
    }
  }

  return decodedValue;
}

function normalizeRouteOptions(options = {}) {
  return Object.keys(options || {}).reduce((result, key) => {
    result[key] = decodeRouteValue(options[key]);
    return result;
  }, {});
}

function parseFilterQuery(value) {
  return decodeRouteValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAssistantCandidateSeats(result) {
  const items = []
    .concat((result && result.candidateSeats) || [])
    .concat((result && result.topSeats) || []);
  const plan = getAssistantResultPlan(result);
  if (plan && plan.seatId) {
    items.push({
      seatId: plan.seatId,
      zoneCode: plan.zoneCode || ""
    });
  }

  const used = new Set();
  return items.filter((item) => {
    const seatId = item && item.seatId ? String(item.seatId) : "";
    if (!seatId || used.has(seatId)) {
      return false;
    }
    used.add(seatId);
    return true;
  });
}

function getAssistantCandidateSeatIds(result) {
  return getAssistantCandidateSeats(result).map((item) => item.seatId);
}

function buildAssistantSeatRankMap(candidateSeats) {
  return new Map((candidateSeats || []).map((item, index) => [item.seatId, index]));
}

function scopeSeatsByAssistantCandidates(seats, candidateSeats) {
  if (!candidateSeats || !candidateSeats.length) {
    return seats || [];
  }

  const seatIdSet = new Set(candidateSeats.map((item) => item.seatId));
  const rankMap = buildAssistantSeatRankMap(candidateSeats);
  return (seats || [])
    .filter((seat) => seatIdSet.has(seat.seatId))
    .sort((left, right) => {
      const leftRank = rankMap.has(left.seatId) ? rankMap.get(left.seatId) : Number.MAX_SAFE_INTEGER;
      const rightRank = rankMap.has(right.seatId) ? rankMap.get(right.seatId) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || compareCodeWithNumber(left.seatId, right.seatId);
    });
}

function scopeZonesByAssistantCandidates(zones, candidateSeats) {
  if (!candidateSeats || !candidateSeats.length) {
    return zones || [];
  }

  const countMap = new Map();
  candidateSeats.forEach((seat) => {
    if (!seat || !seat.zoneCode) {
      return;
    }
    countMap.set(seat.zoneCode, (countMap.get(seat.zoneCode) || 0) + 1);
  });

  return (zones || []).map((zone) => ({
    ...zone,
    matchedSeatCount: countMap.get(zone.zoneCode) || 0
  }));
}

function buildAssistantMapPreferenceSummary(candidateSeats) {
  const count = (candidateSeats || []).length;
  if (!count) {
    return "已进入 AI 推荐地图模式，当前没有可展示的候选座位。";
  }
  return `已同步 AI 推荐结果，地图按本次 ${count} 个候选座位展示，不再显示筛选项。`;
}

function buildAssistantMapRecommendationSummary(seats, context = {}) {
  const topSeat = (seats || [])[0] || null;
  const count = (seats || []).length;
  return {
    title: "AI 推荐座位列表",
    description: count
      ? `当前分区仅展示本次 AI 推荐列表中的候选座位，排序沿用推荐结果顺序。`
      : "当前分区没有落在本次 AI 推荐列表中的候选座位，可以切换其他高亮分区查看。",
    badge: `${count} 个候选`,
    hintTags: [],
    hasHintTags: false,
    focusSeatId: topSeat ? topSeat.seatId : "",
    focusTableGroupCode: topSeat ? topSeat.tableGroupCode : "",
    focusText: topSeat
      ? `建议先查看 AI 首推 ${topSeat.seatId}，再在同桌组里确认最终位置。`
      : "当前分区暂无 AI 候选座位。",
    modelNote: context.message ? `本次需求：${context.message}` : "本次地图结果来自 AI 推荐候选列表。",
    relaxedTagText: "AI候选"
  };
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(decodeRouteValue(value).toLowerCase());
}

function getAssistantResultPlan(result) {
  return (result && result.applyPlan) || {};
}

function buildAssistantMapContext(routeOptions = {}, latestResult = null) {
  const plan = getAssistantResultPlan(latestResult);
  const assistantMapMode =
    parseBooleanFlag(routeOptions.assistantMode) ||
    parseBooleanFlag(routeOptions.softPreferenceMode);
  const candidateSeats = assistantMapMode ? getAssistantCandidateSeats(latestResult) : [];

  return {
    assistantMapMode,
    assistantMapMessage: assistantMapMode
      ? (decodeRouteValue(routeOptions.assistantMessage) || (latestResult && latestResult.queryText) || "")
      : "",
    assistantMapSeatId: decodeRouteValue(routeOptions.seatId) || plan.seatId || "",
    assistantMapSceneKey: decodeRouteValue(routeOptions.sceneKey) || plan.sceneKey || ((latestResult && latestResult.scene && latestResult.scene.key) || ""),
    assistantMapCandidateSeats: candidateSeats,
    assistantMapSeatIds: candidateSeats.map((item) => item.seatId)
  };
}

function buildBookingUrl(options = {}) {
  const query = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== null && options[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`);

  return query.length
    ? `/pages/booking/index?${query.join("&")}`
    : "/pages/booking/index";
}

function buildZoneUrl(options = {}) {
  const query = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== null && options[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`);

  return query.length
    ? `/pages/zone/index?${query.join("&")}`
    : "/pages/zone/index";
}

function showReservationValidationModal(response) {
  const failedSummary = buildReservationCheckSummary(response.checks || [], true);
  wx.showModal({
    title: response.valid ? "预约校验通过" : "预约校验未通过",
    content: failedSummary ? `${response.message}\n\n${failedSummary}` : response.message,
    showCancel: false
  });
}

Page({
  data: {
    loading: true,
    serviceMode: "实时连接",
    activeWorkspaceTab: "map",
    workspaceTabs: decorateWorkspaceTabs("map"),
    floorPlanImage: FLOOR_PLAN_IMAGE,
    floorPlanStageStyle: `padding-top:${FLOOR_PLAN_STAGE_RATIO}%;`,
    seatStudioLoading: false,
    seatStudioLoadingText: "",
    filterOptions: [],
    featureGalleryCards: buildFeatureAtlasCards([], []),
    scenePresets: [],
    activeFilterDetails: [],
    filterPanelExpanded: false,
    planLegendItems: PLAN_LEGEND_ITEMS,
    statusGuideItems: STATUS_GUIDE_ITEMS,
    zones: [],
    zoneGroups: [],
    planHotspots: [],
    activeFilters: [],
    activePresetKey: "",
    activePresetLabel: "",
    activeSceneLabel: "综合偏好",
    activePreferenceSummary: "",
    assistantMapMode: false,
    assistantMapMessage: "",
    assistantMapSeatId: "",
    assistantMapSceneKey: "",
    assistantMapCandidateSeats: [],
    assistantMapSeatIds: [],
    activeZone: "",
    activeZoneDetail: null,
    activeZonePreview: null,
    activeZoneStats: [],
    activeTableGroupCode: "",
    activeTableGroupDetail: null,
    zoneWorkbench: null,
    floorMapColumns: [],
    floorMapRows: [],
    floorMapGridStyle: "",
    searchText: "",
    reservationDate: getOffsetDate(1),
    startTime: "09:00",
    endTime: "11:00",
    timeQuickOptions: buildTimeQuickOptions("09:00", "11:00"),
    seats: [],
    recommendedSeats: [],
    recommendedSeatIds: [],
    recommendationSummary: null,
    tableGroups: [],
    total: 0,
    availableCount: 0,
    unavailableCount: 0,
    selectedSeat: null,
    selectedSeatFeatureCards: [],
    selectedSeatFeatureSummary: "",
    seatFeaturePanelExpanded: false,
    seatFeatureToggleText: buildSeatFeatureToggleText(false),
    showFullSeatList: false,
    fullSeatListToggleText: buildFullSeatListToggleText(false),
    reservationActionLabel: buildReservationActionLabel(null),
    reservationActionDisabled: false,
    assistantPrompts,
    assistantInput: "",
    assistantLoading: false,
    assistantResult: null,
    assistantInsightLegend: [],
    assistantInsightStats: [],
    assistantInsightCenterValue: "",
    assistantInsightCenterLabel: "",
    assistantInsightProgressWidth: "0%",
    assistantInsightCanvasSize: getAssistantChartCanvasSize(),
    assistantDetailExpanded: false,
    assistantError: "",
    spaceGuides
  },

  onLoad(options) {
    const routeOptions = normalizeRouteOptions({
      ...(consumeTabRouteOptions("/pages/seat/index") || {}),
      ...(options || {})
    });
    const redirectParams = [];
    if (routeOptions.zoneCode) {
      redirectParams.push(`zoneCode=${encodeURIComponent(routeOptions.zoneCode)}`);
    }
    if (routeOptions.presetKey) {
      redirectParams.push(`presetKey=${encodeURIComponent(routeOptions.presetKey)}`);
    }
    if (routeOptions.filters) {
      redirectParams.push(`filters=${encodeURIComponent(routeOptions.filters)}`);
    }
    if (routeOptions.seatId) {
      redirectParams.push(`seatId=${encodeURIComponent(routeOptions.seatId)}`);
    }
    if (routeOptions.workspace) {
      redirectParams.push(`workspace=${encodeURIComponent(routeOptions.workspace)}`);
    }
    if (routeOptions.assistantMode) {
      redirectParams.push(`assistantMode=${encodeURIComponent(routeOptions.assistantMode)}`);
    }
    if (routeOptions.softPreferenceMode) {
      redirectParams.push(`softPreferenceMode=${encodeURIComponent(routeOptions.softPreferenceMode)}`);
    }
    if (routeOptions.assistantMessage) {
      redirectParams.push(`assistantMessage=${encodeURIComponent(routeOptions.assistantMessage)}`);
    }
    if (routeOptions.sceneKey) {
      redirectParams.push(`sceneKey=${encodeURIComponent(routeOptions.sceneKey)}`);
    }
    if (routeOptions.reservationDate) {
      redirectParams.push(`reservationDate=${encodeURIComponent(routeOptions.reservationDate)}`);
    }
    if (routeOptions.startTime) {
      redirectParams.push(`startTime=${encodeURIComponent(routeOptions.startTime)}`);
    }
    if (routeOptions.endTime) {
      redirectParams.push(`endTime=${encodeURIComponent(routeOptions.endTime)}`);
    }
    const redirectUrl = redirectParams.length
      ? `/pages/seat/index?${redirectParams.join("&")}`
      : "/pages/seat/index";
    const currentUser = ensureLoggedIn(redirectUrl);
    if (!currentUser) {
      return;
    }

    this.hasBootstrapped = false;
    const latestAssistantResult = getLatestAssistantResult();
    const assistantMapContext = buildAssistantMapContext(routeOptions, latestAssistantResult);
    this.initialZoneCode = routeOptions.zoneCode || "";
    this.initialPresetKey = routeOptions.presetKey || "";
    this.initialFilters = assistantMapContext.assistantMapMode ? [] : parseFilterQuery(routeOptions.filters);
    this.pendingSeatIdToSelect = assistantMapContext.assistantMapSeatId || routeOptions.seatId || "";
    this.filterOptionSource = [];
    this.scenePresetSource = [];
    const initialWorkspaceTab = routeOptions.workspace === "smart"
      ? "smart"
      : (routeOptions.presetKey || routeOptions.filters) ? "smart" : "map";
    this.setData({
      activeWorkspaceTab: initialWorkspaceTab,
      workspaceTabs: decorateWorkspaceTabs(initialWorkspaceTab),
      reservationDate: routeOptions.reservationDate || this.data.reservationDate,
      startTime: routeOptions.startTime || this.data.startTime,
      endTime: routeOptions.endTime || this.data.endTime,
      assistantMapMode: assistantMapContext.assistantMapMode,
      assistantMapMessage: assistantMapContext.assistantMapMessage,
      assistantMapSeatId: assistantMapContext.assistantMapSeatId,
      assistantMapSceneKey: assistantMapContext.assistantMapSceneKey,
      assistantMapCandidateSeats: assistantMapContext.assistantMapCandidateSeats,
      assistantMapSeatIds: assistantMapContext.assistantMapSeatIds,
      activePreferenceSummary: assistantMapContext.assistantMapMode
        ? buildAssistantMapPreferenceSummary(assistantMapContext.assistantMapCandidateSeats)
        : this.data.activePreferenceSummary,
      timeQuickOptions: buildTimeQuickOptions(
        routeOptions.startTime || this.data.startTime,
        routeOptions.endTime || this.data.endTime
      )
    });
    this.loadBootstrap();
  },

  onShow() {
    syncTabBar(this);
    const pendingRouteOptions = consumeTabRouteOptions("/pages/seat/index");
    const currentUser = ensureLoggedIn("/pages/seat/index");
    if (!currentUser) {
      return;
    }

    if (pendingRouteOptions && this.hasBootstrapped) {
      this.applyIncomingRouteOptions(pendingRouteOptions);
      return;
    }

    if (!this.hasBootstrapped) {
      return;
    }

    this.refreshZoneAndSeatData(true);
  },

  async applyIncomingRouteOptions(routeOptions = {}) {
    const normalizedRouteOptions = normalizeRouteOptions(routeOptions);
    const nextZoneCode = normalizedRouteOptions.zoneCode || "";
    const nextPresetKey = normalizedRouteOptions.presetKey || "";
    const nextFilters = parseFilterQuery(normalizedRouteOptions.filters);
    const nextReservationDate = normalizedRouteOptions.reservationDate || "";
    const nextStartTime = normalizedRouteOptions.startTime || "";
    const nextEndTime = normalizedRouteOptions.endTime || "";
    const explicitWorkspaceTab = normalizedRouteOptions.workspace === "smart" ? "smart" : (normalizedRouteOptions.workspace === "map" ? "map" : "");
    const assistantMapContext = buildAssistantMapContext(normalizedRouteOptions, getLatestAssistantResult());
    const effectiveFilters = assistantMapContext.assistantMapMode ? [] : nextFilters;

    if (explicitWorkspaceTab) {
      this.setWorkspaceTab(explicitWorkspaceTab);
    } else if (nextZoneCode) {
      this.setWorkspaceTab("map");
    } else if (nextPresetKey || effectiveFilters.length) {
      this.setWorkspaceTab("smart");
    } else {
      this.setWorkspaceTab("map");
    }

    if (nextPresetKey) {
      const matchedPreset = this.scenePresetSource.find((item) => item.key === nextPresetKey);
      if (matchedPreset) {
        await this.syncFilterState(matchedPreset.filters || [], matchedPreset.key);
      }
    } else if (effectiveFilters.length || assistantMapContext.assistantMapMode) {
      await this.syncFilterState(effectiveFilters);
    }

    if (nextZoneCode) {
      this.initialZoneCode = nextZoneCode;
    }

    this.pendingSeatIdToSelect = assistantMapContext.assistantMapSeatId || normalizedRouteOptions.seatId || "";
    await this.setDataAsync({
      assistantMapMode: assistantMapContext.assistantMapMode,
      assistantMapMessage: assistantMapContext.assistantMapMessage,
      assistantMapSeatId: assistantMapContext.assistantMapSeatId,
      assistantMapSceneKey: assistantMapContext.assistantMapSceneKey,
      assistantMapCandidateSeats: assistantMapContext.assistantMapCandidateSeats,
      assistantMapSeatIds: assistantMapContext.assistantMapSeatIds,
      activePreferenceSummary: assistantMapContext.assistantMapMode
        ? buildAssistantMapPreferenceSummary(assistantMapContext.assistantMapCandidateSeats)
        : this.data.activePreferenceSummary
    });

    await this.setReservationWindow({
      reservationDate: nextReservationDate || this.data.reservationDate,
      startTime: nextStartTime || this.data.startTime,
      endTime: nextEndTime || this.data.endTime
    });
    this.refreshZoneAndSeatData(!nextZoneCode);
  },

  setReservationWindow(partial = {}, callback) {
    const nextReservationDate = partial.reservationDate !== undefined
      ? partial.reservationDate
      : this.data.reservationDate;
    const nextStartTime = partial.startTime !== undefined
      ? partial.startTime
      : this.data.startTime;
    const nextEndTime = partial.endTime !== undefined
      ? partial.endTime
      : this.data.endTime;

    return new Promise((resolve) => {
      this.setData({
        reservationDate: nextReservationDate,
        startTime: nextStartTime,
        endTime: nextEndTime,
        timeQuickOptions: buildTimeQuickOptions(nextStartTime, nextEndTime)
      }, () => {
        if (typeof callback === "function") {
          callback();
        }
        resolve();
      });
    });
  },

  setDataAsync(nextData) {
    return new Promise((resolve) => {
      this.setData(nextData, resolve);
    });
  },

  getSeatQueryParams() {
    const useAssistantSeatList = this.data.assistantMapMode && this.data.assistantMapSeatIds.length;
    return {
      filters: useAssistantSeatList ? "" : this.data.activeFilters.join(","),
      search: this.data.searchText,
      reservationDate: this.data.reservationDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      assistantMode: this.data.assistantMapMode && !useAssistantSeatList ? "1" : "",
      softPreferenceMode: this.data.assistantMapMode && !useAssistantSeatList ? "1" : "",
      assistantMessage: this.data.assistantMapMode && !useAssistantSeatList ? this.data.assistantMapMessage : "",
      sceneKey: this.data.assistantMapMode && !useAssistantSeatList ? this.data.assistantMapSceneKey : ""
    };
  },

  async loadBootstrap() {
    try {
      const rulesResponse = await api.getRules();
      this.filterOptionSource = rulesResponse.filters || [];
      this.scenePresetSource = rulesResponse.presets || [];
      const initialPreset =
        this.scenePresetSource.find((item) => item.key === this.initialPresetKey) || null;
      const initialFilters = initialPreset ? initialPreset.filters || [] : this.initialFilters;
      const activePresetKey = initialPreset
        ? initialPreset.key
        : detectPresetKey(this.scenePresetSource, initialFilters);

      this.setData({
        filterOptions: this.getDecoratedFilterOptions(initialFilters),
        featureGalleryCards: buildFeatureAtlasCards(initialFilters, this.filterOptionSource),
        scenePresets: buildScenePresets(this.scenePresetSource, this.filterOptionSource, activePresetKey),
        serviceMode: "实时连接"
      });

      await this.syncFilterState(initialFilters, activePresetKey);
      await this.refreshZoneAndSeatData(true);
      this.hasBootstrapped = true;
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({
        title: "选座页加载失败",
        icon: "none"
      });
    }
  },

  async loadZones(preserveActiveZone) {
    const response = await api.getZones(this.getSeatQueryParams());
    const zones = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
      ? scopeZonesByAssistantCandidates(response.items || [], this.data.assistantMapCandidateSeats)
      : (response.items || []);
    const hasActiveZone = zones.some((item) => item.zoneCode === this.data.activeZone);
    const firstMatchedZone = zones.find((item) => Number(item.matchedSeatCount || 0) > 0);
    const activeZone = preserveActiveZone && hasActiveZone
      ? this.data.activeZone
      : (this.initialZoneCode && zones.some((item) => item.zoneCode === this.initialZoneCode)
          ? this.initialZoneCode
          : ((firstMatchedZone && firstMatchedZone.zoneCode) || ((zones[0] && zones[0].zoneCode) || "")));
    const zoneGroups = buildZoneGroups(zones, activeZone);
    const activeZoneDetail = buildActiveZoneDetail(zones, activeZone);
    const activeZonePreview = buildActiveZonePreview(zones, activeZone);
    const activeZoneStats = buildActiveZoneStats(activeZoneDetail);
    const floorMap = buildFloorMap(zones, activeZone);
    const planHotspots = buildPlanHotspots(zones, activeZone);

    this.setData({
      zones,
      zoneGroups,
      planHotspots,
      activeZone,
      activeZoneDetail,
      activeZonePreview,
      activeZoneStats,
      floorMapColumns: floorMap.columns,
      floorMapRows: floorMap.rows,
      floorMapGridStyle: floorMap.gridStyle,
      serviceMode: "实时连接"
    });
  },

  async loadSeats() {
    const response = await api.getSeats({
      ...this.getSeatQueryParams(),
      zoneCode: this.data.activeZone,
      limit: 100
    });

    const displayFilters = this.data.assistantMapMode ? [] : this.data.activeFilters;
    const rawSeats = decorateSeatCollections(response.items || [], displayFilters);
    const seats = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
      ? scopeSeatsByAssistantCandidates(rawSeats, this.data.assistantMapCandidateSeats)
      : rawSeats;
    const selectedSeat = this.pickSelectedSeat(seats);
    const recommendedSeats = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
      ? seats
      : decorateSeatCollections(response.topRecommendations || [], displayFilters);
    const recommendedSeatIds = this.data.assistantMapMode && this.data.assistantMapSeatIds.length
      ? this.data.assistantMapSeatIds
      : recommendedSeats.map((item) => item.seatId);
    const rawTableGroups = buildTableGroups(seats, selectedSeat ? selectedSeat.seatId : "", recommendedSeatIds);
    const activeTableGroupCode = pickActiveTableGroupCode(
      rawTableGroups,
      this.data.activeTableGroupCode,
      selectedSeat
    );
    const tableGroups = decorateTableGroups(rawTableGroups, activeTableGroupCode);
    const activeTableGroupDetail = buildActiveTableGroupDetail(tableGroups, activeTableGroupCode);
    const zoneWorkbench = buildZoneWorkbench(tableGroups, this.data.activeZoneDetail);
    const recommendationSummary = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
      ? buildAssistantMapRecommendationSummary(seats, {
          message: this.data.assistantMapMessage
        })
      : buildRecommendationSummaryView(
          response,
          this.data.activeFilterDetails,
          this.data.activePresetLabel
        );
    const selectedSeatFeatureCards = this.data.assistantMapMode
      ? []
      : buildSelectedSeatFeatureCards(selectedSeat, this.data.activeFilters);
    const seatFeaturePanelExpanded = false;

    this.setData({
      seats,
      recommendedSeats,
      recommendedSeatIds,
      recommendationSummary,
      tableGroups,
      activeTableGroupCode,
      activeTableGroupDetail,
      zoneWorkbench,
      total: this.data.assistantMapMode ? seats.length : (response.total || 0),
      availableCount: this.data.assistantMapMode ? seats.filter((item) => item.canReserve).length : (response.availableCount || 0),
      unavailableCount: this.data.assistantMapMode ? seats.filter((item) => !item.canReserve).length : (response.unavailableCount || 0),
      selectedSeat,
      selectedSeatFeatureCards,
      selectedSeatFeatureSummary: buildSelectedSeatFeatureSummary(selectedSeatFeatureCards),
      seatFeaturePanelExpanded,
      seatFeatureToggleText: buildSeatFeatureToggleText(seatFeaturePanelExpanded),
      showFullSeatList: false,
      fullSeatListToggleText: buildFullSeatListToggleText(false),
      reservationActionLabel: buildReservationActionLabel(selectedSeat),
      reservationActionDisabled: Boolean(!selectedSeat || !selectedSeat.canReserve),
      seatStudioLoading: false,
      seatStudioLoadingText: "",
      serviceMode: "实时连接"
    });
  },

  async refreshZoneAndSeatData(preserveActiveZone) {
    this.setData({
      loading: true
    });

    try {
      await this.loadZones(preserveActiveZone);
      await this.loadSeats();
      this.setData({ loading: false });
    } catch (error) {
      this.setData({
        loading: false
      });
      wx.showToast({
        title: error.message || "座位数据加载失败",
        icon: "none"
      });
    }
  },

  pickSelectedSeat(seats) {
    if (!seats.length) {
      this.pendingSeatIdToSelect = "";
      return null;
    }

    const pendingSeatId = this.pendingSeatIdToSelect;
    if (pendingSeatId) {
      this.pendingSeatIdToSelect = "";
      const pendingSeat = seats.find((item) => item.seatId === pendingSeatId);
      if (pendingSeat) {
        return pendingSeat;
      }
    }

    const currentId = this.data.selectedSeat && this.data.selectedSeat.seatId;
    if (!currentId) {
      return seats.find((item) => item.canReserve) || seats[0];
    }

    return (
      seats.find((item) => item.seatId === currentId) ||
      seats.find((item) => item.canReserve) ||
      seats[0]
    );
  },

  getDecoratedFilterOptions(activeFilters) {
    return this.filterOptionSource.map((option) => ({
      ...option,
      selected: activeFilters.includes(option.key)
    }));
  },

  getDecoratedScenePresets(activePresetKey) {
    return buildScenePresets(this.scenePresetSource, this.filterOptionSource, activePresetKey);
  },

  getPresetLabel(activePresetKey) {
    const preset = this.scenePresetSource.find((item) => item.key === activePresetKey);
    return preset ? preset.label : "";
  },

  getActiveFilterDetails(activeFilters) {
    return activeFilters.map((key) => {
      const matched = this.filterOptionSource.find((option) => option.key === key);
      return {
        key,
        label: matched ? matched.label : key
      };
    });
  },

  syncFilterState(activeFilters, activePresetKey) {
    const normalizedFilters = normalizeFilterKeys(activeFilters);
    const presetKey =
      activePresetKey === undefined
        ? detectPresetKey(this.scenePresetSource, normalizedFilters)
        : activePresetKey;
    const selectedSeatFeatureCards = buildSelectedSeatFeatureCards(this.data.selectedSeat, normalizedFilters);
    const activePreferenceSummary = this.data.assistantMapMode
      ? buildAssistantMapPreferenceSummary(this.data.assistantMapCandidateSeats)
      : buildActivePreferenceSummary(
          this.getActiveFilterDetails(normalizedFilters),
          this.getPresetLabel(presetKey)
        );

    return new Promise((resolve) => {
      this.setData({
        activeFilters: normalizedFilters,
        activePresetKey: presetKey,
        activePresetLabel: this.getPresetLabel(presetKey),
        activeSceneLabel: this.getPresetLabel(presetKey) || "综合偏好",
        activePreferenceSummary,
        filterOptions: this.getDecoratedFilterOptions(normalizedFilters),
        featureGalleryCards: buildFeatureAtlasCards(normalizedFilters, this.filterOptionSource),
        scenePresets: this.getDecoratedScenePresets(presetKey),
        activeFilterDetails: this.getActiveFilterDetails(normalizedFilters),
        selectedSeatFeatureCards,
        selectedSeatFeatureSummary: buildSelectedSeatFeatureSummary(selectedSeatFeatureCards),
        seatFeaturePanelExpanded: false,
        seatFeatureToggleText: buildSeatFeatureToggleText(false)
      }, resolve);
    });
  },

  async selectPreset(event) {
    const { presetKey } = event.currentTarget.dataset;
    if (!presetKey) {
      return;
    }

    if (presetKey === this.data.activePresetKey) {
      await this.syncFilterState([], "");
      this.refreshZoneAndSeatData(true);
      return;
    }

    const preset = this.scenePresetSource.find((item) => item.key === presetKey);
    if (!preset) {
      return;
    }

    await this.syncFilterState(preset.filters || [], preset.key);
    this.refreshZoneAndSeatData(true);
  },

  async toggleFilter(event) {
    const { filterKey } = event.currentTarget.dataset;
    const nextFilters = this.data.activeFilters.slice();
    const existingIndex = nextFilters.indexOf(filterKey);

    if (existingIndex >= 0) {
      nextFilters.splice(existingIndex, 1);
    } else {
      nextFilters.push(filterKey);
    }

    await this.syncFilterState(nextFilters);
    this.refreshZoneAndSeatData(true);
  },

  async removeActiveFilter(event) {
    const { filterKey } = event.currentTarget.dataset;
    const nextFilters = this.data.activeFilters.filter((item) => item !== filterKey);
    await this.syncFilterState(nextFilters);
    this.refreshZoneAndSeatData(true);
  },

  toggleFilterPanel() {
    this.setData({
      filterPanelExpanded: !this.data.filterPanelExpanded
    });
  },

  async selectZone(event) {
    const { zoneCode } = event.currentTarget.dataset;
    if (!zoneCode) {
      return;
    }

    const shouldOpenDetail = zoneCode === this.data.activeZone;
    const activeZoneDetail = buildActiveZoneDetail(this.data.zones, zoneCode);
    const activeZonePreview = buildActiveZonePreview(this.data.zones, zoneCode);
    const activeZoneStats = buildActiveZoneStats(activeZoneDetail);
    const floorMap = buildFloorMap(this.data.zones, zoneCode);

    await this.setDataAsync({
      activeZone: zoneCode,
      planHotspots: buildPlanHotspots(this.data.zones, zoneCode),
      activeZoneDetail,
      activeZonePreview,
      activeZoneStats,
      floorMapColumns: floorMap.columns,
      floorMapRows: floorMap.rows,
      floorMapGridStyle: floorMap.gridStyle,
      activeTableGroupCode: "",
      activeTableGroupDetail: null,
      selectedSeat: null,
      selectedSeatFeatureCards: [],
      selectedSeatFeatureSummary: "",
      seatFeaturePanelExpanded: false,
      seatFeatureToggleText: buildSeatFeatureToggleText(false),
      seatStudioLoading: !shouldOpenDetail,
      seatStudioLoadingText: "正在切换分区座位"
    });

    if (shouldOpenDetail) {
      this.openActiveZonePage();
      return;
    }

    this.pendingSeatIdToSelect = "";
    try {
      await this.loadSeats();
    } catch (error) {
      this.setData({
        seatStudioLoading: false,
        seatStudioLoadingText: ""
      });
      wx.showToast({
        title: error.message || "分区座位加载失败",
        icon: "none"
      });
    }
  },

  selectTableGroup(event) {
    const { tableGroupCode } = event.currentTarget.dataset;
    const matchedGroup = this.data.tableGroups.find((item) => item.tableGroupCode === tableGroupCode);

    if (!matchedGroup) {
      return;
    }

    const nextSelectedSeat =
      (this.data.selectedSeat && this.data.selectedSeat.tableGroupCode === tableGroupCode)
        ? this.data.selectedSeat
        : (matchedGroup.items.find((item) => item.canReserve) || matchedGroup.items[0] || null);
    const rawTableGroups = buildTableGroups(
      this.data.seats,
      nextSelectedSeat ? nextSelectedSeat.seatId : "",
      this.data.recommendedSeatIds
    );
    const tableGroups = decorateTableGroups(rawTableGroups, tableGroupCode);
    const zoneWorkbench = buildZoneWorkbench(tableGroups, this.data.activeZoneDetail);
    const selectedSeatFeatureCards = buildSelectedSeatFeatureCards(nextSelectedSeat, this.data.activeFilters);
    const seatFeaturePanelExpanded = false;

    this.setData({
      selectedSeat: nextSelectedSeat,
      selectedSeatFeatureCards,
      selectedSeatFeatureSummary: buildSelectedSeatFeatureSummary(selectedSeatFeatureCards),
      seatFeaturePanelExpanded,
      seatFeatureToggleText: buildSeatFeatureToggleText(seatFeaturePanelExpanded),
      activeTableGroupCode: tableGroupCode,
      activeTableGroupDetail: buildActiveTableGroupDetail(tableGroups, tableGroupCode),
      tableGroups,
      zoneWorkbench
    });
  },

  onSearchInput(event) {
    this.setData({
      searchText: event.detail.value
    });
  },

  onAssistantInput(event) {
    this.setData({
      assistantInput: event.detail.value || "",
      assistantError: ""
    });
  },

  useAssistantPrompt(event) {
    const { prompt } = event.currentTarget.dataset;
    if (!prompt) {
      return;
    }

    this.setData({
      assistantInput: prompt,
      assistantError: ""
    });
    this.runAssistant();
  },

  async runAssistant() {
    const message = String(this.data.assistantInput || "").trim();
    if (!message) {
      this.setData({
        assistantError: "请先输入你的选座需求，例如“安静、靠窗、能充电，适合下午自习”"
      });
      return;
    }

    this.setWorkspaceTab("smart");
    this.setData({
      assistantLoading: true,
      assistantError: "",
      assistantResult: null
    });
    this.updateAssistantInsightView(null);

    try {
      const result = await api.getSeatAssistant({
        message,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });
      const decoratedResult = decorateAssistantResult(
        result,
        (result && result.applyPlan && result.applyPlan.filters) || []
      );

      setLatestAssistantResult(result);

      this.setData({
        assistantLoading: false,
        assistantResult: decoratedResult,
        assistantDetailExpanded: false
      }, () => {
        this.updateAssistantInsightView(decoratedResult);
      });

      if (decoratedResult && decoratedResult.topSeats && decoratedResult.topSeats.length) {
        wx.showToast({
          title: "AI 已生成推荐",
          icon: "success"
        });
      }
    } catch (error) {
      clearLatestAssistantResult();
      this.setData({
        assistantLoading: false,
        assistantError: error.message || "AI 需求解析失败，请稍后重试"
      });
      this.updateAssistantInsightView(null);
    }
  },

  async applyAssistantPlan() {
    const assistantResult = this.data.assistantResult;
    const plan = assistantResult && assistantResult.applyPlan;
    if (!plan) {
      return;
    }

    const focusSeatId =
      plan.seatId ||
      ((assistantResult.topSeats && assistantResult.topSeats[0] && assistantResult.topSeats[0].seatId) || "");
    const assistantMapCandidateSeats = getAssistantCandidateSeats(assistantResult);
    const assistantMapSeatIds = assistantMapCandidateSeats.map((item) => item.seatId);
    this.pendingSeatIdToSelect = focusSeatId;
    await this.syncFilterState([]);
    this.initialZoneCode = plan.zoneCode || "";

    await this.setDataAsync({
      assistantMapMode: true,
      assistantMapMessage: assistantResult.queryText || this.data.assistantInput || "",
      assistantMapSeatId: focusSeatId,
      assistantMapSceneKey: plan.sceneKey || ((assistantResult.scene && assistantResult.scene.key) || ""),
      assistantMapCandidateSeats,
      assistantMapSeatIds,
      activePreferenceSummary: buildAssistantMapPreferenceSummary(assistantMapCandidateSeats)
    });

    await this.setReservationWindow({
      reservationDate: plan.reservationDate || this.data.reservationDate,
      startTime: plan.startTime || this.data.startTime,
      endTime: plan.endTime || this.data.endTime
    });

    await this.refreshZoneAndSeatData(!(plan.zoneCode || ""));
    this.setWorkspaceTab("map");

    wx.showToast({
      title: "已同步推荐座位",
      icon: "success"
    });
  },

  async handleAssistantSeatSelect(event) {
    const { seatId, zoneCode } = event.currentTarget.dataset;
    const plan = this.data.assistantResult && this.data.assistantResult.applyPlan;

    if (!seatId) {
      return;
    }

    const nextReservationDate = (plan && plan.reservationDate) || this.data.reservationDate;
    const nextStartTime = (plan && plan.startTime) || this.data.startTime;
    const nextEndTime = (plan && plan.endTime) || this.data.endTime;

    this.setReservationWindow({
      reservationDate: nextReservationDate,
      startTime: nextStartTime,
      endTime: nextEndTime
    }, () => {
      this.openSeatBooking({
        seatId,
        zoneCode: zoneCode || (plan && plan.zoneCode) || "",
        reservationDate: nextReservationDate,
        startTime: nextStartTime,
        endTime: nextEndTime
      });
    });
  },

  openAssistantResults() {
    const result = this.data.assistantResult;
    if (!result || !result.candidateSeats || !result.candidateSeats.length) {
      wx.showToast({
        title: "当前没有更多候选座位",
        icon: "none"
      });
      return;
    }

    setLatestAssistantResult(result);
    openPage("/pages/assistant-results/index");
  },

  async openGuideAction(event) {
    const { actionType, actionValue } = event.currentTarget.dataset;
    if (!actionType || !actionValue) {
      return;
    }

    if (actionType === "filter") {
      const nextFilters = this.data.activeFilters.includes(actionValue)
        ? this.data.activeFilters.filter((item) => item !== actionValue)
        : this.data.activeFilters.concat(actionValue);

      await this.syncFilterState(nextFilters);
      this.refreshZoneAndSeatData(true);
      return;
    }

    if (actionType === "preset") {
      this.setData({
        assistantError: ""
      });
      const preset = this.scenePresetSource.find((item) => item.key === actionValue);
      if (preset) {
        this.initialPresetKey = actionValue;
        await this.syncFilterState(preset.filters || [], preset.key);
        this.refreshZoneAndSeatData(true);
        return;
      }

      openPage(`/pages/seat/index?presetKey=${encodeURIComponent(actionValue)}`);
      return;
    }

    if (actionType === "zone") {
      openPage(buildZoneUrl({
        zoneCode: actionValue,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime,
        filters: this.data.activeFilters.join(",")
      }));
    }
  },

  onReservationDateChange(event) {
    this.setReservationWindow({
      reservationDate: event.detail.value
    }, () => {
      this.refreshZoneAndSeatData(true);
    });
  },

  onStartTimeChange(event) {
    this.setReservationWindow({
      startTime: event.detail.value
    }, () => {
      this.refreshZoneAndSeatData(true);
    });
  },

  onEndTimeChange(event) {
    this.setReservationWindow({
      endTime: event.detail.value
    }, () => {
      this.refreshZoneAndSeatData(true);
    });
  },

  applyQuickTimePreset(event) {
    const { startTime, endTime } = event.currentTarget.dataset;
    if (!startTime || !endTime) {
      return;
    }

    if (startTime === this.data.startTime && endTime === this.data.endTime) {
      return;
    }

    this.setReservationWindow({
      startTime,
      endTime
    }, () => {
      this.refreshZoneAndSeatData(true);
    });
  },

  submitSearch() {
    this.refreshZoneAndSeatData(true);
  },

  async resetFilters() {
    await this.setDataAsync({
      searchText: "",
      assistantMapMode: false,
      assistantMapMessage: "",
      assistantMapSeatId: "",
      assistantMapSceneKey: "",
      assistantMapCandidateSeats: [],
      assistantMapSeatIds: []
    });
    await this.syncFilterState([]);
    this.refreshZoneAndSeatData(true);
  },

  toggleFullSeatList() {
    this.setData({
      showFullSeatList: !this.data.showFullSeatList,
      fullSeatListToggleText: buildFullSeatListToggleText(!this.data.showFullSeatList)
    });
  },

  toggleAssistantDetail() {
    this.setData({
      assistantDetailExpanded: !this.data.assistantDetailExpanded
    });
  },

  noop() {},

  toggleSeatCardFeaturePreview(event) {
    const { seatId, source } = event.currentTarget.dataset;
    if (!seatId) {
      return;
    }

    if (source === "assistant") {
      if (!this.data.assistantResult) {
        return;
      }

      this.setData({
        assistantResult: {
          ...this.data.assistantResult,
          topSeats: toggleSeatFeaturePreviewById(this.data.assistantResult.topSeats, seatId)
        }
      });
      return;
    }

    this.setData({
      recommendedSeats: toggleSeatFeaturePreviewById(this.data.recommendedSeats, seatId)
    });
  },

  toggleSeatFeaturePanel() {
    if (!this.data.selectedSeatFeatureCards.length) {
      return;
    }

    const seatFeaturePanelExpanded = !this.data.seatFeaturePanelExpanded;
    this.setData({
      seatFeaturePanelExpanded,
      seatFeatureToggleText: buildSeatFeatureToggleText(seatFeaturePanelExpanded)
    });
  },

  openSeatBooking(options = {}) {
    openPage(buildBookingUrl(options));
  },

  selectSeat(event) {
    const { seatId } = event.currentTarget.dataset;
    const selectedSeat =
      this.data.seats.find((item) => item.seatId === seatId) ||
      this.data.recommendedSeats.find((item) => item.seatId === seatId) ||
      null;

    if (!selectedSeat) {
      return;
    }

    const activeTableGroupCode = pickActiveTableGroupCode(
      this.data.tableGroups,
      selectedSeat.tableGroupCode,
      selectedSeat
    );
    const rawTableGroups = buildTableGroups(
      this.data.seats,
      selectedSeat.seatId,
      this.data.recommendedSeatIds
    );
    const tableGroups = decorateTableGroups(rawTableGroups, activeTableGroupCode);
    const zoneWorkbench = buildZoneWorkbench(tableGroups, this.data.activeZoneDetail);
    const selectedSeatFeatureCards = buildSelectedSeatFeatureCards(selectedSeat, this.data.activeFilters);
    const seatFeaturePanelExpanded = false;

    this.setData({
      selectedSeat,
      selectedSeatFeatureCards,
      selectedSeatFeatureSummary: buildSelectedSeatFeatureSummary(selectedSeatFeatureCards),
      seatFeaturePanelExpanded,
      seatFeatureToggleText: buildSeatFeatureToggleText(seatFeaturePanelExpanded),
      activeTableGroupCode,
      activeTableGroupDetail: buildActiveTableGroupDetail(tableGroups, activeTableGroupCode),
      tableGroups,
      zoneWorkbench
    }, () => {
      this.openSeatBooking({
        seatId: selectedSeat.seatId,
        zoneCode: selectedSeat.zoneCode,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });
    });
  },

  useTopRecommendation() {
    const topSeat = (this.data.recommendedSeats || [])[0];
    if (!topSeat) {
      return;
    }

    const rawTableGroups = buildTableGroups(
      this.data.seats,
      topSeat.seatId,
      this.data.recommendedSeatIds
    );
    const activeTableGroupCode = pickActiveTableGroupCode(
      rawTableGroups,
      topSeat.tableGroupCode,
      topSeat
    );
    const tableGroups = decorateTableGroups(rawTableGroups, activeTableGroupCode);
    const zoneWorkbench = buildZoneWorkbench(tableGroups, this.data.activeZoneDetail);
    const selectedSeatFeatureCards = buildSelectedSeatFeatureCards(topSeat, this.data.activeFilters);
    const seatFeaturePanelExpanded = false;

    this.setData({
      selectedSeat: topSeat,
      selectedSeatFeatureCards,
      selectedSeatFeatureSummary: buildSelectedSeatFeatureSummary(selectedSeatFeatureCards),
      seatFeaturePanelExpanded,
      seatFeatureToggleText: buildSeatFeatureToggleText(seatFeaturePanelExpanded),
      activeTableGroupCode,
      activeTableGroupDetail: buildActiveTableGroupDetail(tableGroups, activeTableGroupCode),
      tableGroups,
      zoneWorkbench
    }, () => {
      this.openSeatBooking({
        seatId: topSeat.seatId,
        zoneCode: topSeat.zoneCode,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });
    });
  },

  scrollToAnchor(selector, offsetTop) {
    const query = wx.createSelectorQuery();
    query.select(selector).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((result) => {
      const rect = result && result[0];
      const viewport = result && result[1];

      if (!rect || !viewport) {
        return;
      }

      wx.pageScrollTo({
        scrollTop: Math.max(viewport.scrollTop + rect.top - (offsetTop || 0), 0),
        duration: 280
      });
    });
  },

  jumpToSection(event) {
    const { anchor } = event.currentTarget.dataset;
    if (!anchor) {
      return;
    }

    this.scrollToAnchor(anchor, 20);
  },

  setWorkspaceTab(tabKey) {
    const nextTabKey = WORKSPACE_TABS.find((item) => item.key === tabKey) ? tabKey : "map";
    this.setData({
      activeWorkspaceTab: nextTabKey,
      workspaceTabs: decorateWorkspaceTabs(nextTabKey)
    });
  },

  selectWorkspaceTab(event) {
    const { tabKey } = event.currentTarget.dataset;
    if (!tabKey || tabKey === this.data.activeWorkspaceTab) {
      return;
    }

    this.setWorkspaceTab(tabKey);
  },

  updateAssistantInsightView(result) {
    if (!result) {
      this.currentAssistantInsightModel = null;
      this.setData({
        assistantInsightLegend: [],
        assistantInsightStats: [],
        assistantInsightCenterValue: "",
        assistantInsightCenterLabel: "",
        assistantInsightProgressWidth: "0%"
      });
      return;
    }

    const insightModel = buildAssistantInsightModel(result);
    this.currentAssistantInsightModel = insightModel;
    this.setData({
      assistantInsightLegend: insightModel.legend,
      assistantInsightStats: insightModel.stats,
      assistantInsightCenterValue: insightModel.centerValue,
      assistantInsightCenterLabel: insightModel.centerLabel,
      assistantInsightProgressWidth: `${insightModel.progressPercent}%`
    });
  },

  drawAssistantInsightChart(insightModel) {
    if (!insightModel || !insightModel.legend || !insightModel.legend.length) {
      return;
    }

    const ctx = wx.createCanvasContext("assistantInsightChart", this);
    const size = Number(this.data.assistantInsightCanvasSize || getAssistantChartCanvasSize());
    const center = size / 2;
    const radius = size * 0.36;
    const innerRadius = size * 0.23;
    const lineWidth = radius - innerRadius;
    const startAngle = Math.PI * 1.5;
    const progressAngle = Math.PI * 2 * (Math.max(0, Math.min(Number(insightModel.progressPercent || 0), 100)) / 100);
    const safeProgressAngle = progressAngle >= Math.PI * 2 ? (Math.PI * 2 - 0.001) : progressAngle;
    const trackRadius = (radius + innerRadius) / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.setLineWidth(lineWidth);
    ctx.setLineCap("butt");

    ctx.beginPath();
    ctx.setStrokeStyle("#c4d2cb");
    ctx.arc(center, center, trackRadius, 0, Math.PI * 2, false);
    ctx.stroke();

    ctx.setStrokeStyle(insightModel.progressColor || ASSISTANT_CHART_COLORS[0]);

    let remainingAngle = safeProgressAngle;
    let currentStart = startAngle;

    while (remainingAngle > 0) {
      const availableAngle = Math.PI * 2 - currentStart;
      const segmentAngle = Math.min(remainingAngle, availableAngle);

      ctx.beginPath();
      ctx.arc(center, center, trackRadius, currentStart, currentStart + segmentAngle, false);
      ctx.stroke();

      remainingAngle -= segmentAngle;
      currentStart = 0;
    }

    ctx.beginPath();
    ctx.setFillStyle("#ffffff");
    ctx.arc(center, center, innerRadius - 2, 0, Math.PI * 2, false);
    ctx.fill();
    ctx.draw();
  },

  buildValidationSummary(checks, failedOnly = true) {
    return (checks || [])
      .filter((item) => (failedOnly ? !item.passed : true))
      .map((item) => `${item.passed ? "通过" : "未通过"} ${item.label}${item.detail ? `：${item.detail}` : ""}`)
      .join("\n");
  },

  showValidationResult(response) {
    const failedSummary = this.buildValidationSummary(response.checks || [], true);
    wx.showModal({
      title: response.valid ? "预约校验通过" : "预约校验未通过",
      content: failedSummary ? `${response.message}\n\n${failedSummary}` : response.message,
      showCancel: false
    });
  },

  async handlePreviewReservation() {
    if (!this.data.selectedSeat) {
      wx.showToast({
        title: "请先选中一个座位",
        icon: "none"
      });
      return;
    }

    try {
      const response = await api.previewReservation({
        seatId: this.data.selectedSeat.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      this.showValidationResult(response);
    } catch (error) {
      wx.showToast({
        title: error.message || "预约校验失败",
        icon: "none"
      });
    }
  },

  async handleCreateReservation() {
    if (!this.data.selectedSeat) {
      wx.showToast({
        title: "请先选中一个座位",
        icon: "none"
      });
      return;
    }

    if (!this.data.selectedSeat.canReserve) {
      wx.showToast({
        title: this.data.selectedSeat.statusDescription || "该座位当前不可预约",
        icon: "none"
      });
      return;
    }

    try {
      const preview = await api.previewReservation({
        seatId: this.data.selectedSeat.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      if (!preview.valid) {
        this.showValidationResult(preview);
        return;
      }

      const result = await api.createReservation({
        seatId: this.data.selectedSeat.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      await this.refreshZoneAndSeatData(true);

        wx.showModal({
          title: "预约成功",
          content: `${result.seatId} 已预约成功\n${result.reservationDate} ${result.startTime}-${result.endTime}`,
          showCancel: false,
          success: () => {
            openPage("/pages/reservation/index");
          }
        });
    } catch (error) {
      if (error.code === "RESERVATION_VALIDATION_FAILED" && error.payload) {
        this.showValidationResult(error.payload);
      } else {
        wx.showToast({
          title: error.message || "预约失败",
          icon: "none"
        });
      }

      this.refreshZoneAndSeatData(true);
    }
  },

  async previewReservation() {
    return this.handlePreviewReservation();
  },

  async createReservation() {
    return this.handleCreateReservation();
  },

  switchToMap() {
    this.setWorkspaceTab("map");
  },

  switchToSmart() {
    this.setWorkspaceTab("smart");
  },

  openActiveZonePage() {
    if (!this.data.activeZone) {
      wx.showToast({
        title: "请先选择一个分区",
        icon: "none"
      });
      return;
    }

    openPage(buildZoneUrl({
      zoneCode: this.data.activeZone,
      reservationDate: this.data.reservationDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      filters: this.data.assistantMapMode ? "" : this.data.activeFilters.join(","),
      assistantMode: this.data.assistantMapMode ? "1" : "",
      softPreferenceMode: this.data.assistantMapMode ? "1" : "",
      assistantMessage: this.data.assistantMapMode ? this.data.assistantMapMessage : "",
      sceneKey: this.data.assistantMapMode ? this.data.assistantMapSceneKey : ""
    }));
  }
});
