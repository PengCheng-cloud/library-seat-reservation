const AUTH_STORAGE_KEY = "library.currentUser";

App({
  onLaunch() {
    const currentUser = wx.getStorageSync(AUTH_STORAGE_KEY) || null;
    this.globalData.currentUser = currentUser;
  },

  globalData: {
    systemName: "图书馆预约占座系统",
    currentUser: null,
    pendingTabTarget: ""
  },

  setCurrentUser(user) {
    this.globalData.currentUser = user;
    wx.setStorageSync(AUTH_STORAGE_KEY, user);
  },

  clearCurrentUser() {
    this.globalData.currentUser = null;
    wx.removeStorageSync(AUTH_STORAGE_KEY);
  }
});
