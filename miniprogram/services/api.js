const env = require("../config/env");
const { getCurrentStudentNo, clearCurrentUser } = require("../utils/auth");

function toQueryString(params) {
  const pairs = Object.keys(params || {})
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);

  return pairs.length ? `?${pairs.join("&")}` : "";
}

function appendQueryParams(path, params = {}) {
  let nextPath = String(path || "");

  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null || value === "") {
      return;
    }

    const encodedKey = encodeURIComponent(key);
    const queryPattern = new RegExp(`(?:[?&])${encodedKey}=`);
    if (queryPattern.test(nextPath)) {
      return;
    }

    nextPath += `${nextPath.includes("?") ? "&" : "?"}${encodedKey}=${encodeURIComponent(value)}`;
  });

  return nextPath;
}

function appendStudentNoToPath(path) {
  const studentNo = getCurrentStudentNo();
  if (!studentNo) {
    return path;
  }

  return appendQueryParams(path, { studentNo });
}

function appendStudentNoToData(data) {
  const studentNo = getCurrentStudentNo();
  if (!studentNo) {
    return data;
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...data }
    : {};

  if (!payload.studentNo) {
    payload.studentNo = studentNo;
  }

  return payload;
}

function buildRequestError(response) {
  const message =
    (response.data && (response.data.message || response.data.error)) ||
    `Request failed with status ${response.statusCode}`;

  const error = new Error(message);
  error.statusCode = response.statusCode;
  error.payload = response.data || null;

  if (response.data && response.data.code) {
    error.code = response.data.code;
  }

  return error;
}

function buildNetworkError(error) {
  const message =
    (error && error.errMsg && `网络请求失败：${error.errMsg}`) ||
    "网络请求失败，请检查服务端是否已经启动";

  const requestError = new Error(message);
  requestError.code = "NETWORK_ERROR";
  requestError.originalError = error;
  return requestError;
}

function request(options) {
  const {
    path,
    method = "GET",
    data,
    attachStudentNo = false,
    timeout = env.requestTimeout
  } = options;

  const normalizedMethod = String(method || "GET").toUpperCase();
  const finalPath = attachStudentNo && normalizedMethod === "GET"
    ? appendStudentNoToPath(path)
    : path;
  const requestData = attachStudentNo && normalizedMethod !== "GET"
    ? appendStudentNoToData(data)
    : data;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${env.apiBaseUrl}${finalPath}`,
      method: normalizedMethod,
      data: requestData,
      header: {},
      timeout,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }

        if (response.statusCode === 401) {
          clearCurrentUser();
        }

        reject(buildRequestError(response));
      },
      fail: (error) => {
        reject(buildNetworkError(error));
      }
    });
  });
}

function login(data) {
  return request({
    path: "/auth/login",
    method: "POST",
    data
  });
}

function register(data) {
  return request({
    path: "/auth/register",
    method: "POST",
    data
  });
}

function getHomeData() {
  return request({
    path: "/home"
  });
}

function getNotices(params = {}) {
  return request({
    path: `/notices${toQueryString(params)}`
  });
}

function getRules() {
  return request({
    path: "/rules"
  });
}

function getAlgorithmOverview() {
  return request({
    path: "/algorithm/overview"
  });
}

function getZones(params = {}) {
  return request({
    path: `/zones${toQueryString(params)}`,
    attachStudentNo: true
  });
}

function getSeats(params = {}) {
  return request({
    path: `/seats${toQueryString(params)}`,
    attachStudentNo: true
  });
}

function getSeatSchedule(seatId, params = {}) {
  return request({
    path: `/seats/${encodeURIComponent(seatId)}/schedule${toQueryString(params)}`,
    attachStudentNo: true
  });
}

function getSeatAssistant(data = {}) {
  return request({
    path: "/assistant/seat",
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function getReservations() {
  return request({
    path: "/reservations/me",
    attachStudentNo: true
  });
}

function getProfile() {
  return request({
    path: "/profile/me",
    attachStudentNo: true
  });
}

function previewReservation(data) {
  return request({
    path: "/reservations/preview",
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function createReservation(data) {
  return request({
    path: "/reservations",
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function cancelReservation(reservationNo, data = {}) {
  return request({
    path: `/reservations/${encodeURIComponent(reservationNo)}/cancel`,
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function checkinReservation(reservationNo, data = {}) {
  return request({
    path: `/reservations/${encodeURIComponent(reservationNo)}/checkin`,
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function checkoutReservation(reservationNo, data = {}) {
  return request({
    path: `/reservations/${encodeURIComponent(reservationNo)}/checkout`,
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function startLeaveReservation(reservationNo, data = {}) {
  return request({
    path: `/reservations/${encodeURIComponent(reservationNo)}/leave-start`,
    method: "POST",
    data,
    attachStudentNo: true
  });
}

function returnLeaveReservation(reservationNo, data = {}) {
  return request({
    path: `/reservations/${encodeURIComponent(reservationNo)}/return`,
    method: "POST",
    data,
    attachStudentNo: true
  });
}

module.exports = {
  login,
  register,
  getHomeData,
  getNotices,
  getRules,
  getAlgorithmOverview,
  getZones,
  getSeats,
  getSeatSchedule,
  getSeatAssistant,
  getReservations,
  getProfile,
  previewReservation,
  createReservation,
  cancelReservation,
  checkinReservation,
  checkoutReservation,
  startLeaveReservation,
  returnLeaveReservation
};
