const api = require("../../services/api");
const { ensureLoggedIn, clearCurrentUser } = require("../../utils/auth");
const { openPage } = require("../../utils/navigation");

function syncTabBar(page) {
  const tabBar = page && typeof page.getTabBar === "function" ? page.getTabBar() : null;
  if (tabBar && typeof tabBar.syncSelected === "function") {
    tabBar.syncSelected();
  }
}

function getUserInitial(user) {
  const text = String((user && (user.realName || user.studentNo)) || "我").trim();
  return text.slice(0, 1) || "我";
}

function getCreditStatusText(user, ruleHints) {
  if (user && user.isBlacklisted) {
    return user.blacklistUntil
      ? `当前限制使用至 ${String(user.blacklistUntil).slice(0, 16)}`
      : "当前账号已进入黑名单";
  }

  const score = Number(user && user.creditScore);
  const threshold = Number(ruleHints && ruleHints.blacklistCreditThreshold);

  if (Number.isFinite(score) && score >= 95) {
    return "信用状态优秀";
  }

  if (Number.isFinite(score) && Number.isFinite(threshold) && score > threshold + 10) {
    return "信用状态稳定";
  }

  return "近期请注意按时签到签退";
}

Page({
  data: {
    loading: true,
    user: null,
    creditLogs: [],
    ruleHints: {},
    userInitial: "我",
    creditStatusText: ""
  },

  onLoad() {
    const currentUser = ensureLoggedIn("/pages/profile/index");
    if (!currentUser) {
      return;
    }

    this.hasLoaded = false;
    this.loadProfile();
  },

  onShow() {
    syncTabBar(this);

    const currentUser = ensureLoggedIn("/pages/profile/index");
    if (!currentUser) {
      return;
    }

    if (!this.hasLoaded) {
      return;
    }

    this.loadProfile({
      silent: true
    });
  },

  async loadProfile(options = {}) {
    const { silent = false } = options;

    if (!silent) {
      this.setData({
        loading: true
      });
    }

    try {
      const response = await api.getProfile();

      this.setData({
        loading: false,
        user: response.user,
        creditLogs: response.creditLogs || [],
        ruleHints: response.ruleHints || {},
        userInitial: getUserInitial(response.user),
        creditStatusText: getCreditStatusText(response.user, response.ruleHints || {})
      });
      this.hasLoaded = true;
    } catch (error) {
      if (!silent) {
        this.setData({
          loading: false
        });

        wx.showToast({
          title: error.message || "个人信息加载失败",
          icon: "none"
        });
      }
    }
  },

  openReservations() {
    openPage("/pages/reservation/index");
  },

  openSeatPage() {
    openPage("/pages/seat/index");
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定退出当前账号吗？",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        clearCurrentUser();
        wx.reLaunch({
          url: "/pages/auth/index"
        });
      }
    });
  }
});
