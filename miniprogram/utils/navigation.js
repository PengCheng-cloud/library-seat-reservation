const TAB_PAGES = new Set([
  "/pages/home/index",
  "/pages/seat/index",
  "/pages/reservation/index",
  "/pages/profile/index"
]);

const PENDING_TAB_TARGET_KEY = "library.pendingTabTarget";

function getAppInstance() {
  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function splitUrl(url = "") {
  const normalized = String(url || "").trim();
  const [pathPart, queryPart = ""] = normalized.split("?");

  return {
    path: pathPart || "/pages/home/index",
    query: queryPart
  };
}

function parseQuery(query = "") {
  return String(query || "")
    .split("&")
    .filter(Boolean)
    .reduce((result, segment) => {
      const [rawKey, rawValue = ""] = segment.split("=");
      const key = decodeURIComponent(rawKey || "").trim();

      if (!key) {
        return result;
      }

      result[key] = decodeURIComponent(rawValue || "");
      return result;
    }, {});
}

function setPendingTabTarget(url) {
  const app = getAppInstance();

  if (app && app.globalData) {
    app.globalData.pendingTabTarget = url;
  }

  wx.setStorageSync(PENDING_TAB_TARGET_KEY, url);
}

function getPendingTabTarget() {
  const app = getAppInstance();
  const appValue = app && app.globalData ? app.globalData.pendingTabTarget : "";

  if (appValue) {
    return appValue;
  }

  const storageValue = wx.getStorageSync(PENDING_TAB_TARGET_KEY) || "";
  if (storageValue && app && app.globalData) {
    app.globalData.pendingTabTarget = storageValue;
  }

  return storageValue;
}

function clearPendingTabTarget() {
  const app = getAppInstance();

  if (app && app.globalData) {
    app.globalData.pendingTabTarget = "";
  }

  wx.removeStorageSync(PENDING_TAB_TARGET_KEY);
}

function isTabPage(urlOrPath = "") {
  const { path } = splitUrl(urlOrPath);
  return TAB_PAGES.has(path);
}

function openPage(url) {
  const { path, query } = splitUrl(url);

  if (TAB_PAGES.has(path)) {
    if (query) {
      setPendingTabTarget(url);
    }

    wx.switchTab({
      url: path
    });
    return;
  }

  wx.navigateTo({
    url
  });
}

function relaunchPage(url) {
  const { path, query } = splitUrl(url);

  if (TAB_PAGES.has(path)) {
    if (query) {
      setPendingTabTarget(url);
    }

    wx.switchTab({
      url: path,
      fail: () => {
        wx.reLaunch({
          url: path,
          fail: () => {
            wx.showToast({
              title: "页面跳转失败",
              icon: "none"
            });
          }
        });
      }
    });
    return;
  }

  wx.reLaunch({
    url
  });
}

function consumeTabRouteOptions(pagePath) {
  const pendingTarget = getPendingTabTarget();
  if (!pendingTarget) {
    return null;
  }

  const { path, query } = splitUrl(pendingTarget);
  if (path !== pagePath) {
    return null;
  }

  clearPendingTabTarget();
  return parseQuery(query);
}

module.exports = {
  TAB_PAGES: Array.from(TAB_PAGES),
  consumeTabRouteOptions,
  isTabPage,
  openPage,
  relaunchPage
};
