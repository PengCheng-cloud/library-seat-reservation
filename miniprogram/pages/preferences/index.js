const { featureGallery } = require("../../config/showcase");
const { openPage } = require("../../utils/navigation");
const { getOffsetDate } = require("../../utils/date");

const ACTION_TONES = [
  "preference-action-card--green",
  "preference-action-card--cyan",
  "preference-action-card--mint",
  "preference-action-card--lime"
];

function buildZoneUrl(zoneCode) {
  const reservationDate = getOffsetDate(1);
  const startTime = "09:00";
  const endTime = "11:00";
  return `/pages/zone/index?zoneCode=${encodeURIComponent(zoneCode)}&reservationDate=${encodeURIComponent(reservationDate)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
}

function buildActionUrl(actionType, actionValue) {
  if (!actionType || !actionValue) {
    return "";
  }

  if (actionType === "preset") {
    return `/pages/seat/index?presetKey=${encodeURIComponent(actionValue)}`;
  }

  if (actionType === "filter") {
    return `/pages/seat/index?filters=${encodeURIComponent(actionValue)}`;
  }

  if (actionType === "zone") {
    return buildZoneUrl(actionValue);
  }

  return "";
}

function buildActionLabel(actionType) {
  if (actionType === "preset") {
    return "按场景选座";
  }

  if (actionType === "filter") {
    return "立即筛选";
  }

  if (actionType === "zone") {
    return "查看分区";
  }

  return "";
}

function decorateItems(items) {
  return (items || []).map((item, index) => ({
    ...item,
    hasAction: Boolean(buildActionUrl(item.actionType, item.actionValue)),
    actionLabel: buildActionLabel(item.actionType),
    actionUrl: buildActionUrl(item.actionType, item.actionValue),
    toneClass: ACTION_TONES[index % ACTION_TONES.length],
    displayTags: (item.tags || []).slice(0, 2)
  }));
}

Page({
  data: {
    actionableItems: [],
    facilityItems: []
  },

  onLoad() {
    const allItems = decorateItems(featureGallery);

    this.setData({
      actionableItems: allItems.filter((item) => item.hasAction),
      facilityItems: allItems.filter((item) => !item.hasAction)
    });
  },

  openFeatureAction(event) {
    const { actionType, actionValue } = event.currentTarget.dataset;
    const actionUrl = buildActionUrl(actionType, actionValue);
    if (!actionUrl) {
      return;
    }

    openPage(actionUrl);
  },

  openSeatMap() {
    openPage("/pages/seat/index?workspace=map");
  },

  openSeatSmart() {
    openPage("/pages/seat/index?workspace=smart");
  }
});
