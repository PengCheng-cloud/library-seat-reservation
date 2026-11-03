const api = require("../../services/api");
const { ensureLoggedIn } = require("../../utils/auth");
const { openPage } = require("../../utils/navigation");
const { getLatestAssistantResult } = require("../../utils/assistant-store");
const {
  decorateSeatFeaturePreview,
  toggleSeatFeaturePreviewById
} = require("../../utils/seat-feature");

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

function parseFilterQuery(value) {
  return decodeRouteValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(decodeRouteValue(value).toLowerCase());
}

function getAssistantCandidateSeats(result) {
  const items = []
    .concat((result && result.candidateSeats) || [])
    .concat((result && result.topSeats) || []);
  const plan = (result && result.applyPlan) || {};
  if (plan.seatId) {
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

function scopeSeatsByAssistantCandidates(seats, candidateSeats) {
  if (!candidateSeats || !candidateSeats.length) {
    return seats || [];
  }

  const seatIdSet = new Set(candidateSeats.map((item) => item.seatId));
  const rankMap = new Map(candidateSeats.map((item, index) => [item.seatId, index]));
  return (seats || [])
    .filter((seat) => seatIdSet.has(seat.seatId))
    .sort((left, right) => {
      const leftRank = rankMap.has(left.seatId) ? rankMap.get(left.seatId) : Number.MAX_SAFE_INTEGER;
      const rightRank = rankMap.has(right.seatId) ? rankMap.get(right.seatId) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || compareCodeWithNumber(left.seatId, right.seatId);
    });
}

function buildAssistantZoneSummary(seats) {
  const topSeat = (seats || [])[0] || null;
  return {
    title: "AI 推荐座位列表",
    description: topSeat
      ? `本区仅展示本次 AI 推荐列表中的候选座位，建议先比较 ${topSeat.seatId}。`
      : "本区没有落在本次 AI 推荐列表中的候选座位。",
    hintTags: [],
    badge: `${(seats || []).length} 个候选`
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

function compareCodeWithNumber(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function getSeatDisplayScore(seat) {
  return seat.recommendationBadge || `${seat.score || 0} 分`;
}

function decorateSeatDisplay(seat, activeFilters) {
  return decorateSeatFeaturePreview({
    ...seat,
    displayScore: getSeatDisplayScore(seat),
    sceneModelText: seat.sceneModelLabel ? `${seat.algorithmModelShortName || "SVM"}预测：${seat.sceneModelLabel}` : "",
    sceneModelMetaText: seat.sceneModelConfidenceText || ""
  }, activeFilters);
}

function decorateSeatCollections(seats, activeFilters) {
  return (seats || []).map((seat) => decorateSeatDisplay(seat, activeFilters));
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

function buildRecommendationSummary(response) {
  const summary = response && response.recommendationSummary ? response.recommendationSummary : null;
  if (!summary) {
    return {
      title: "本区推荐",
      description: "当前分区内没有可直接推荐的座位。",
      hintTags: [],
      badge: "暂无推荐"
    };
  }

  return {
    ...summary,
    hintTags: summary.hintTags || [],
    badge: summary.badge || "本区推荐"
  };
}

Page({
  data: {
    loading: true,
    serviceMode: "实时连接",
    zoneCode: "",
    reservationDate: "",
    startTime: "",
    endTime: "",
    filters: [],
    assistantMapMode: false,
    assistantMapMessage: "",
    assistantMapSceneKey: "",
    assistantMapCandidateSeats: [],
    assistantMapSeatIds: [],
    activeFilterLabels: [],
    zone: null,
    seats: [],
    recommendedSeats: [],
    recommendationSummary: null,
    tableGroups: [],
    activeTableGroupCode: "",
    activeTableGroupDetail: null
  },

  onLoad(options) {
    const zoneCode = decodeRouteValue(options && options.zoneCode);
    const reservationDate = decodeRouteValue(options && options.reservationDate);
    const startTime = decodeRouteValue(options && options.startTime);
    const endTime = decodeRouteValue(options && options.endTime);
    const assistantMapMode = parseBooleanFlag(options && (options.assistantMode || options.softPreferenceMode));
    const filters = assistantMapMode ? [] : parseFilterQuery(options && options.filters);
    const assistantMapMessage = decodeRouteValue(options && options.assistantMessage);
    const assistantMapSceneKey = decodeRouteValue(options && options.sceneKey);
    const assistantMapCandidateSeats = assistantMapMode ? getAssistantCandidateSeats(getLatestAssistantResult()) : [];
    const assistantMapSeatIds = assistantMapCandidateSeats.map((item) => item.seatId);
    const redirectUrl = `/pages/zone/index?zoneCode=${encodeURIComponent(zoneCode)}&reservationDate=${encodeURIComponent(reservationDate)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}${filters.length ? `&filters=${encodeURIComponent(filters.join(","))}` : ""}${assistantMapMode ? "&assistantMode=1&softPreferenceMode=1" : ""}${assistantMapMessage ? `&assistantMessage=${encodeURIComponent(assistantMapMessage)}` : ""}${assistantMapSceneKey ? `&sceneKey=${encodeURIComponent(assistantMapSceneKey)}` : ""}`;
    const currentUser = ensureLoggedIn(redirectUrl);

    if (!currentUser) {
      return;
    }

    if (!zoneCode) {
      wx.showToast({
        title: "未识别到分区",
        icon: "none"
      });
      this.backToMap();
      return;
    }

    this.setData({
      zoneCode,
      reservationDate,
      startTime,
      endTime,
      filters,
      assistantMapMode,
      assistantMapMessage,
      assistantMapSceneKey,
      assistantMapCandidateSeats,
      assistantMapSeatIds
    });

    this.loadPage();
  },

  getSeatQueryParams() {
    const useAssistantSeatList = this.data.assistantMapMode && this.data.assistantMapSeatIds.length;
    return {
      zoneCode: this.data.zoneCode,
      filters: useAssistantSeatList ? "" : this.data.filters.join(","),
      reservationDate: this.data.reservationDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      assistantMode: this.data.assistantMapMode && !useAssistantSeatList ? "1" : "",
      softPreferenceMode: this.data.assistantMapMode && !useAssistantSeatList ? "1" : "",
      assistantMessage: this.data.assistantMapMode && !useAssistantSeatList ? this.data.assistantMapMessage : "",
      sceneKey: this.data.assistantMapMode && !useAssistantSeatList ? this.data.assistantMapSceneKey : "",
      limit: 100
    };
  },

  async loadPage() {
    this.setData({
      loading: true
    });

    try {
      const [rulesResponse, zonesResponse, seatResponse] = await Promise.all([
        api.getRules(),
        api.getZones(this.getSeatQueryParams()),
        api.getSeats(this.getSeatQueryParams())
      ]);

      const filterLabelMap = new Map((rulesResponse.filters || []).map((item) => [item.key, item.label]));
      const zone = (zonesResponse.items || []).find((item) => item.zoneCode === this.data.zoneCode) || null;
      const displayFilters = this.data.assistantMapMode ? [] : this.data.filters;
      const rawSeats = decorateSeatCollections(seatResponse.items || [], displayFilters);
      const seats = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
        ? scopeSeatsByAssistantCandidates(rawSeats, this.data.assistantMapCandidateSeats)
        : rawSeats;
      const recommendedSeats = this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
        ? seats
        : decorateSeatCollections(seatResponse.topRecommendations || [], displayFilters);
      const recommendedSeatIds = this.data.assistantMapMode && this.data.assistantMapSeatIds.length
        ? this.data.assistantMapSeatIds
        : recommendedSeats.map((item) => item.seatId);
      const selectedSeat = recommendedSeats[0] || seats[0] || null;
      const rawTableGroups = buildTableGroups(seats, selectedSeat ? selectedSeat.seatId : "", recommendedSeatIds);
      const activeTableGroupCode = pickActiveTableGroupCode(rawTableGroups, "", selectedSeat);
      const tableGroups = decorateTableGroups(rawTableGroups, activeTableGroupCode);
      const activeTableGroupDetail = buildActiveTableGroupDetail(tableGroups, activeTableGroupCode);
      this.setData({
        loading: false,
        serviceMode: "实时连接",
        activeFilterLabels: this.data.assistantMapMode ? [] : this.data.filters.map((key) => filterLabelMap.get(key) || key),
        zone,
        seats,
        recommendedSeats,
        recommendationSummary: this.data.assistantMapMode && this.data.assistantMapCandidateSeats.length
          ? buildAssistantZoneSummary(seats)
          : buildRecommendationSummary(seatResponse),
        tableGroups,
        activeTableGroupCode,
        activeTableGroupDetail
      });
    } catch (error) {
      this.setData({
        loading: false
      });
      wx.showToast({
        title: error.message || "分区详情加载失败",
        icon: "none"
      });
    }
  },

  backToMap() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    const query = [
      `zoneCode=${encodeURIComponent(this.data.zoneCode)}`,
      `reservationDate=${encodeURIComponent(this.data.reservationDate)}`,
      `startTime=${encodeURIComponent(this.data.startTime)}`,
      `endTime=${encodeURIComponent(this.data.endTime)}`,
      "workspace=map"
    ];
    if (!this.data.assistantMapMode && this.data.filters.length) {
      query.push(`filters=${encodeURIComponent(this.data.filters.join(","))}`);
    }
    if (this.data.assistantMapMode) {
      query.push("assistantMode=1");
      query.push("softPreferenceMode=1");
      if (this.data.assistantMapMessage) {
        query.push(`assistantMessage=${encodeURIComponent(this.data.assistantMapMessage)}`);
      }
      if (this.data.assistantMapSceneKey) {
        query.push(`sceneKey=${encodeURIComponent(this.data.assistantMapSceneKey)}`);
      }
    }
    openPage(`/pages/seat/index?${query.join("&")}`);
  },

  openBooking(seat) {
    if (!seat) {
      return;
    }

    openPage(buildBookingUrl({
      seatId: seat.seatId,
      zoneCode: seat.zoneCode,
      reservationDate: this.data.reservationDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime
    }));
  },

  useTopRecommendation() {
    this.openBooking((this.data.recommendedSeats || [])[0] || null);
  },

  noop() {},

  toggleSeatFeaturePreview(event) {
    const { seatId } = event.currentTarget.dataset;
    if (!seatId) {
      return;
    }

    this.setData({
      recommendedSeats: toggleSeatFeaturePreviewById(this.data.recommendedSeats, seatId)
    });
  },

  selectSeat(event) {
    const { seatId } = event.currentTarget.dataset;
    const seat =
      this.data.seats.find((item) => item.seatId === seatId) ||
      this.data.recommendedSeats.find((item) => item.seatId === seatId) ||
      null;

    this.openBooking(seat);
  },

  selectTableGroup(event) {
    const { tableGroupCode } = event.currentTarget.dataset;
    if (!tableGroupCode) {
      return;
    }

    const tableGroups = decorateTableGroups(this.data.tableGroups, tableGroupCode);
    this.setData({
      tableGroups,
      activeTableGroupCode: tableGroupCode,
      activeTableGroupDetail: buildActiveTableGroupDetail(tableGroups, tableGroupCode)
    });
  }
});
