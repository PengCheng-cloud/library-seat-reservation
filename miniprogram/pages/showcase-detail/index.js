const { getOffsetDate } = require("../../utils/date");
const { openPage } = require("../../utils/navigation");
const { getShowcaseItem } = require("../../config/showcase");

function normalizeType(type) {
  return type === "scene" ? "scene" : "space";
}

function buildZoneUrl(zoneCode) {
  const reservationDate = getOffsetDate(1);
  const startTime = "09:00";
  const endTime = "11:00";
  return `/pages/zone/index?zoneCode=${encodeURIComponent(zoneCode)}&reservationDate=${encodeURIComponent(reservationDate)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
}

function buildActionConfig(item) {
  if (!item || !item.actionType || !item.actionValue) {
    return {
      label: "",
      url: ""
    };
  }

  if (item.actionType === "preset") {
    return {
      label: "查看对应推荐座位",
      url: `/pages/seat/index?presetKey=${encodeURIComponent(item.actionValue)}`
    };
  }

  if (item.actionType === "filter") {
    return {
      label: "按该特征筛选座位",
      url: `/pages/seat/index?filters=${encodeURIComponent(item.actionValue)}`
    };
  }

  if (item.actionType === "zone") {
    return {
      label: "查看该分区座位",
      url: buildZoneUrl(item.actionValue)
    };
  }

  return {
    label: "",
    url: ""
  };
}

Page({
  data: {
    type: "space",
    item: null,
    gallery: [],
    featurePoints: [],
    actionLabel: "",
    hasAction: false,
    typeLabel: ""
  },

  onLoad(options) {
    const type = normalizeType(options && options.type);
    const key = (options && options.key) || "";
    const item = getShowcaseItem(type, key);

    if (!item) {
      wx.showToast({
        title: "未找到对应内容",
        icon: "none"
      });
      setTimeout(() => {
        wx.navigateBack({
          delta: 1
        });
      }, 350);
      return;
    }

    const actionConfig = buildActionConfig(item);

    this.actionUrl = actionConfig.url;
    this.setData({
      type,
      item,
      gallery: item.gallery || [],
      featurePoints: item.featurePoints || [],
      actionLabel: actionConfig.label,
      hasAction: Boolean(actionConfig.url),
      typeLabel: type === "scene" ? "场景特征" : "空间特征"
    });

    wx.setNavigationBarTitle({
      title: item.title || "图集详情"
    });
  },

  openAction() {
    if (!this.actionUrl) {
      return;
    }

    openPage(this.actionUrl);
  }
});
