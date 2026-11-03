const { openPage } = require("../../utils/navigation");
const { getLatestAssistantResult } = require("../../utils/assistant-store");
const {
  decorateSeatFeatureCollection,
  toggleSeatFeaturePreviewById
} = require("../../utils/seat-feature");

function buildBookingUrl(options = {}) {
  const query = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== null && options[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`);

  return query.length
    ? `/pages/booking/index?${query.join("&")}`
    : "/pages/booking/index";
}

function buildSeatMapUrl(plan = {}) {
  const query = [];
  if (plan.zoneCode) {
    query.push(`zoneCode=${encodeURIComponent(plan.zoneCode)}`);
  }
  if (plan.seatId) {
    query.push(`seatId=${encodeURIComponent(plan.seatId)}`);
  }
  if (plan.softPreferenceMode) {
    query.push("assistantMode=1");
    query.push("softPreferenceMode=1");
  }
  if (plan.message) {
    query.push(`assistantMessage=${encodeURIComponent(plan.message)}`);
  }
  if (plan.sceneKey) {
    query.push(`sceneKey=${encodeURIComponent(plan.sceneKey)}`);
  }
  if (plan.reservationDate) {
    query.push(`reservationDate=${encodeURIComponent(plan.reservationDate)}`);
  }
  if (plan.startTime) {
    query.push(`startTime=${encodeURIComponent(plan.startTime)}`);
  }
  if (plan.endTime) {
    query.push(`endTime=${encodeURIComponent(plan.endTime)}`);
  }
  query.push("workspace=map");
  return `/pages/seat/index?${query.join("&")}`;
}

Page({
  data: {
    result: null,
    plan: null,
    candidateSeats: [],
    candidateTotal: 0
  },

  onLoad() {
    const result = getLatestAssistantResult();
    const activeFilters = (result && result.applyPlan && result.applyPlan.filters) || [];
    const candidateSeats = decorateSeatFeatureCollection((result && result.candidateSeats) || [], activeFilters);

    this.setData({
      result,
      plan: (result && result.applyPlan) || null,
      candidateSeats,
      candidateTotal: (result && result.candidateTotal) || candidateSeats.length
    });
  },

  openSeatBooking(event) {
    const { seatId, zoneCode } = event.currentTarget.dataset;
    const plan = this.data.plan || {};

    if (!seatId) {
      return;
    }

    openPage(buildBookingUrl({
      seatId,
      zoneCode: zoneCode || plan.zoneCode || "",
      reservationDate: plan.reservationDate || "",
      startTime: plan.startTime || "",
      endTime: plan.endTime || ""
    }));
  },

  openMap() {
    openPage(buildSeatMapUrl(this.data.plan || {}));
  },

  noop() {},

  toggleSeatFeaturePreview(event) {
    const { seatId } = event.currentTarget.dataset;
    if (!seatId) {
      return;
    }

    this.setData({
      candidateSeats: toggleSeatFeaturePreviewById(this.data.candidateSeats, seatId)
    });
  }
});
