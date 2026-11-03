const AUTH_STORAGE_KEY = "library.currentUser";

function getAppInstance() {
  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function isValidCurrentUser(user) {
  return Boolean(user && String(user.studentNo || "").trim());
}

function getCurrentUser() {
  const app = getAppInstance();
  const appUser = app && app.globalData ? app.globalData.currentUser : null;

  if (isValidCurrentUser(appUser)) {
    return appUser;
  }

  const storedUser = wx.getStorageSync(AUTH_STORAGE_KEY) || null;
  if (isValidCurrentUser(storedUser) && app && app.globalData) {
    app.globalData.currentUser = storedUser;
    return storedUser;
  }

  if (appUser || storedUser) {
    clearCurrentUser();
  }

  return null;
}

function setCurrentUser(user) {
  const app = getAppInstance();
  if (app && typeof app.setCurrentUser === "function") {
    app.setCurrentUser(user);
    return;
  }

  if (app && app.globalData) {
    app.globalData.currentUser = user;
  }

  wx.setStorageSync(AUTH_STORAGE_KEY, user);
}

function clearCurrentUser() {
  const app = getAppInstance();
  if (app && typeof app.clearCurrentUser === "function") {
    app.clearCurrentUser();
    return;
  }

  if (app && app.globalData) {
    app.globalData.currentUser = null;
  }

  wx.removeStorageSync(AUTH_STORAGE_KEY);
}

function getCurrentStudentNo() {
  const user = getCurrentUser();
  return user && user.studentNo ? user.studentNo : "";
}

function redirectToLogin(redirectUrl) {
  const safeRedirect = encodeURIComponent(redirectUrl || "/pages/home/index");
  wx.reLaunch({
    url: `/pages/auth/index?redirect=${safeRedirect}`
  });
}

function ensureLoggedIn(redirectUrl) {
  const user = getCurrentUser();
  if (user) {
    return user;
  }

  redirectToLogin(redirectUrl);
  return null;
}

module.exports = {
  getCurrentUser,
  setCurrentUser,
  clearCurrentUser,
  getCurrentStudentNo,
  redirectToLogin,
  ensureLoggedIn
};
