const { featureGallery } = require("../config/showcase");

const FEATURE_GALLERY_MAP = new Map(featureGallery.map((item) => [item.key, item]));

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

function buildSeatFeatureCards(seat, activeFilters = [], limit = 4) {
  if (!seat) {
    return [];
  }

  const matchedKeys = (activeFilters || []).filter((key) =>
    FEATURE_GALLERY_MAP.has(key) && seatMatchesFilterFeature(seat, key)
  );
  const seatFeatureKeys = getSelectedSeatFeatureKeys(seat);
  const safeLimit = Math.max(Number(limit || 0), 1);
  const orderedKeys = Array.from(new Set([...matchedKeys, ...seatFeatureKeys])).slice(0, safeLimit);

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

function buildSeatFeatureSummary(featureCards) {
  if (!featureCards.length) {
    return "";
  }

  const highlightedCount = featureCards.filter((item) => item.highlighted).length;

  if (highlightedCount) {
    return `当前座位命中了 ${highlightedCount} 项偏好，可结合实景图快速判断环境。`;
  }

  return "展开后可查看该座位对应的环境实景图和特征说明。";
}

function buildSeatFeatureToggleText(expanded) {
  return expanded ? "收起特征预览" : "展开特征预览";
}

function decorateSeatFeaturePreview(seat, activeFilters = [], options = {}) {
  if (!seat) {
    return null;
  }

  const featurePreviewCards = buildSeatFeatureCards(seat, activeFilters, options.limit);
  const featurePreviewExpanded = Boolean(options.expanded);

  return {
    ...seat,
    featurePreviewCards,
    featurePreviewSummary: buildSeatFeatureSummary(featurePreviewCards),
    featurePreviewExpanded,
    featurePreviewToggleText: buildSeatFeatureToggleText(featurePreviewExpanded)
  };
}

function decorateSeatFeatureCollection(seats, activeFilters = [], options = {}) {
  return (seats || [])
    .map((seat) => decorateSeatFeaturePreview(seat, activeFilters, options))
    .filter(Boolean);
}

function toggleSeatFeaturePreview(item) {
  if (!item || !item.featurePreviewCards || !item.featurePreviewCards.length) {
    return item;
  }

  const featurePreviewExpanded = !item.featurePreviewExpanded;
  return {
    ...item,
    featurePreviewExpanded,
    featurePreviewToggleText: buildSeatFeatureToggleText(featurePreviewExpanded)
  };
}

function toggleSeatFeaturePreviewById(collection, seatId) {
  return (collection || []).map((item) =>
    item && item.seatId === seatId ? toggleSeatFeaturePreview(item) : item
  );
}

module.exports = {
  seatMatchesFilterFeature,
  buildSeatFeatureCards,
  buildSeatFeatureSummary,
  buildSeatFeatureToggleText,
  decorateSeatFeaturePreview,
  decorateSeatFeatureCollection,
  toggleSeatFeaturePreview,
  toggleSeatFeaturePreviewById
};
