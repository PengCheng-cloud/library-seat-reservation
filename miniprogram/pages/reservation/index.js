const api = require("../../services/api");
const { ensureLoggedIn } = require("../../utils/auth");
const { openPage } = require("../../utils/navigation");

function syncTabBar(page) {
  const tabBar = page && typeof page.getTabBar === "function" ? page.getTabBar() : null;
  if (tabBar && typeof tabBar.syncSelected === "function") {
    tabBar.syncSelected();
  }
}

const STATUS_META = {
  reserved: {
    text: "待签到",
    tone: "reserved"
  },
  checked_in: {
    text: "使用中",
    tone: "occupied"
  },
  temporary_leave: {
    text: "暂离中",
    tone: "leave"
  },
  completed: {
    text: "已完成",
    tone: "available"
  },
  cancelled: {
    text: "已取消",
    tone: "disabled"
  },
  no_show: {
    text: "未签到",
    tone: "maintenance"
  },
  violation: {
    text: "违规结束",
    tone: "maintenance"
  },
  admin_released: {
    text: "管理员释放",
    tone: "disabled"
  }
};

const HISTORY_HINT_MAP = {
  completed: "本次预约已正常完成。",
  cancelled: "本次预约已由你主动取消。",
  no_show: "未在签到窗口内完成签到，系统已按规则记录。",
  violation: "本次预约已按违约规则处理。",
  admin_released: "本次预约已由管理员手动结束。"
};

function isLocationPermissionDenied(error) {
  const errorMessage = String((error && error.errMsg) || "").toLowerCase();
  return /auth deny|auth denied|permission denied|scope unauthorized|system permission denied/.test(errorMessage);
}

function isUserCancelled(error) {
  const errorMessage = String((error && error.errMsg) || "").toLowerCase();
  return /cancel/.test(errorMessage);
}

function parseDateTime(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildEndDateTime(item) {
  if (!item || !item.reservationDate || !item.endTime) {
    return null;
  }

  return parseDateTime(`${item.reservationDate} ${item.endTime}:00`);
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }

  if (minutes > 0) {
    return `${minutes}分钟${seconds}秒`;
  }

  return `${seconds}秒`;
}

function buildCurrentHint(item, now) {
  if (item.status === "reserved") {
    const openAt = parseDateTime(item.checkinOpenAt);
    const deadlineAt = parseDateTime(item.checkinDeadlineAt);

    if (openAt && now < openAt) {
      return `距离可签到还有 ${formatRemaining(openAt.getTime() - now.getTime())}。`;
    }

    if (deadlineAt && now <= deadlineAt) {
      return `请在 ${formatRemaining(deadlineAt.getTime() - now.getTime())} 内到馆完成定位签到。`;
    }

    return "已超过签到窗口，系统会在同步后更新最终状态。";
  }

  if (item.status === "checked_in") {
    const endAt = buildEndDateTime(item);
    if (endAt && now < endAt) {
      return `距离预约结束还有 ${formatRemaining(endAt.getTime() - now.getTime())}，结束后可直接签退。`;
    }

    return "预约时段已结束，如状态未刷新可稍后重新进入页面。";
  }

  if (item.status === "temporary_leave") {
    const deadlineAt = parseDateTime(item.leaveDeadlineAt);
    if (deadlineAt && now <= deadlineAt) {
      return `暂离中，请在 ${formatRemaining(deadlineAt.getTime() - now.getTime())} 内返座。`;
    }

    return "暂离已超过允许时间，系统会在同步后更新最终状态。";
  }

  return "";
}

function isCheckinAvailable(item, now) {
  if (item.status !== "reserved") {
    return false;
  }

  const openAt = parseDateTime(item.checkinOpenAt);
  const deadlineAt = parseDateTime(item.checkinDeadlineAt);

  if (openAt && now < openAt) {
    return false;
  }

  if (deadlineAt && now > deadlineAt) {
    return false;
  }

  return true;
}

function needsReservationSync(item, now) {
  const endAt = buildEndDateTime(item);
  const deadlineAt = parseDateTime(item.checkinDeadlineAt);

  if (item.status === "reserved") {
    return Boolean(deadlineAt && now > deadlineAt);
  }

  if (item.status === "checked_in") {
    return Boolean(endAt && now >= endAt);
  }

  if (item.status === "temporary_leave") {
    const leaveDeadlineAt = parseDateTime(item.leaveDeadlineAt);
    return Boolean(leaveDeadlineAt && now > leaveDeadlineAt);
  }

  return false;
}

function buildSummaryCards(current, history) {
  const pendingCheckinCount = current.filter((item) => item.status === "reserved").length;
  const inUseCount = current.filter((item) => item.status === "checked_in").length;

  return [
    { label: "当前预约", value: current.length },
    { label: "待签到", value: pendingCheckinCount },
    { label: "使用中", value: inUseCount },
    { label: "历史记录", value: history.length }
  ];
}

function decorateReservation(item, now) {
  const meta = STATUS_META[item.status] || {
    text: item.status || "未知状态",
    tone: "disabled"
  };

  return {
    ...item,
    statusText: meta.text,
    statusTone: meta.tone,
    statusHint: item.status === "reserved" || item.status === "checked_in" || item.status === "temporary_leave"
      ? buildCurrentHint(item, now)
      : (HISTORY_HINT_MAP[item.status] || ""),
    canCheckin: isCheckinAvailable(item, now),
    canCancel: item.status === "reserved",
    canStartLeave: item.status === "checked_in",
    canReturnLeave: item.status === "temporary_leave",
    canCheckout: item.status === "checked_in" || item.status === "temporary_leave"
  };
}

Page({
  data: {
    loading: true,
    current: [],
    history: [],
    summaryCards: [],
    actionSubmitting: false
  },

  onLoad() {
    const currentUser = ensureLoggedIn("/pages/reservation/index");
    if (!currentUser) {
      return;
    }

    this.loadReservations();
  },

  onShow() {
    syncTabBar(this);

    const currentUser = ensureLoggedIn("/pages/reservation/index");
    if (!currentUser) {
      return;
    }

    this.loadReservations();
  },

  onHide() {
    this.stopTick();
  },

  onUnload() {
    this.stopTick();
  },

  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  },

  maybeSyncCurrentReservations() {
    if (this.isLoadingReservations) {
      return;
    }

    const now = new Date();
    const shouldSync = (this.rawCurrent || []).some((item) => needsReservationSync(item, now));
    if (!shouldSync) {
      return;
    }

    const currentTime = now.getTime();
    if (this.lastAutoSyncAt && currentTime - this.lastAutoSyncAt < 3000) {
      return;
    }

    this.lastAutoSyncAt = currentTime;
    this.loadReservations({
      silent: true
    });
  },

  startTick() {
    this.stopTick();

    if (!(this.rawCurrent && this.rawCurrent.length)) {
      return;
    }

    this.tickTimer = setInterval(() => {
      this.applyReservationViewModel();
      this.maybeSyncCurrentReservations();
    }, 1000);
  },

  applyReservationViewModel() {
    const now = new Date();
    const current = (this.rawCurrent || []).map((item) => decorateReservation(item, now));
    const history = (this.rawHistory || []).map((item) => decorateReservation(item, now));

    this.setData({
      current,
      history,
      summaryCards: buildSummaryCards(current, history)
    });
  },

  async loadReservations(options = {}) {
    const { silent = false } = options;

    if (this.isLoadingReservations) {
      return;
    }

    this.isLoadingReservations = true;

    if (!silent) {
      this.setData({
        loading: true
      });
    }

    try {
      const response = await api.getReservations();

      this.rawCurrent = response.current || [];
      this.rawHistory = response.history || [];

      this.setData({
        loading: false
      });

      this.applyReservationViewModel();
      this.startTick();
      this.lastAutoSyncAt = Date.now();
    } catch (error) {
      if (!silent) {
        this.setData({
          loading: false
        });

        wx.showToast({
          title: error.message || "预约记录加载失败",
          icon: "none"
        });
      }
    } finally {
      this.isLoadingReservations = false;
    }
  },

  openSeatPage() {
    openPage("/pages/seat/index");
  },

  requestCheckinLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: "gcj02",
        success: (result) => {
          resolve({
            latitude: result.latitude,
            longitude: result.longitude,
            accuracy: result.accuracy || 0,
            coordinateType: "gcj02"
          });
        },
        fail: reject
      });
    });
  },

  openLocationPermissionSetting() {
    return new Promise((resolve) => {
      wx.showModal({
        title: "需要定位权限",
        content: "定位签到需要获取当前位置，请在设置中开启位置信息权限后重试。",
        confirmText: "去设置",
        cancelText: "稍后再说",
        success: (result) => {
          if (!result.confirm) {
            resolve(false);
            return;
          }

          wx.openSetting({
            success: () => resolve(true),
            fail: () => resolve(true)
          });
        },
        fail: () => resolve(false)
      });
    });
  },

  async handleCheckin(event) {
    const { reservationNo } = event.currentTarget.dataset;
    if (!reservationNo || this.data.actionSubmitting) {
      return;
    }

    this.setData({
      actionSubmitting: true
    });
    wx.showLoading({
      title: "获取定位中",
      mask: true
    });

    try {
      const locationPayload = await this.requestCheckinLocation();

      wx.showLoading({
        title: "签到中",
        mask: true
      });

      await api.checkinReservation(reservationNo, locationPayload);

      wx.hideLoading();
      wx.showToast({
        title: "定位签到成功",
        icon: "success"
      });

      this.loadReservations();
    } catch (error) {
      wx.hideLoading();

      if (isUserCancelled(error)) {
        return;
      }

      if (isLocationPermissionDenied(error)) {
        await this.openLocationPermissionSetting();
      } else {
        wx.showToast({
          title: error.message || "定位签到失败",
          icon: "none"
        });
      }
    } finally {
      this.setData({
        actionSubmitting: false
      });
    }
  },

  async handleCheckout(event) {
    const { reservationNo } = event.currentTarget.dataset;
    if (!reservationNo || this.data.actionSubmitting) {
      return;
    }

    this.setData({
      actionSubmitting: true
    });
    wx.showLoading({
      title: "签退中",
      mask: true
    });

    try {
      await api.checkoutReservation(reservationNo);

      wx.hideLoading();
      wx.showToast({
        title: "签退成功",
        icon: "success"
      });

      this.loadReservations();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || "签退失败",
        icon: "none"
      });
    } finally {
      this.setData({
        actionSubmitting: false
      });
    }
  },

  handleStartLeave(event) {
    const { reservationNo } = event.currentTarget.dataset;
    if (!reservationNo || this.data.actionSubmitting) {
      return;
    }

    wx.showModal({
      title: "暂离座位",
      content: "暂离会开始计时，请在规则允许时间内返座。",
      confirmText: "开始暂离",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }

        this.setData({
          actionSubmitting: true
        });
        wx.showLoading({
          title: "提交中",
          mask: true
        });

        try {
          await api.startLeaveReservation(reservationNo);
          wx.hideLoading();
          wx.showToast({
            title: "已开始暂离",
            icon: "success"
          });
          this.loadReservations();
        } catch (error) {
          wx.hideLoading();
          wx.showToast({
            title: error.message || "暂离失败",
            icon: "none"
          });
        } finally {
          this.setData({
            actionSubmitting: false
          });
        }
      }
    });
  },

  async handleReturnLeave(event) {
    const { reservationNo } = event.currentTarget.dataset;
    if (!reservationNo || this.data.actionSubmitting) {
      return;
    }

    this.setData({
      actionSubmitting: true
    });
    wx.showLoading({
      title: "返座中",
      mask: true
    });

    try {
      await api.returnLeaveReservation(reservationNo);

      wx.hideLoading();
      wx.showToast({
        title: "返座成功",
        icon: "success"
      });

      this.loadReservations();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || "返座失败",
        icon: "none"
      });
    } finally {
      this.setData({
        actionSubmitting: false
      });
    }
  },

  cancelReservation(event) {
    const { reservationNo } = event.currentTarget.dataset;
    if (!reservationNo) {
      return;
    }

    wx.showModal({
      title: "取消预约",
      content: "确定取消当前预约吗？",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }

        try {
          await api.cancelReservation(reservationNo);

          wx.showToast({
            title: "已取消预约",
            icon: "success"
          });

          this.loadReservations();
        } catch (error) {
          wx.showToast({
            title: error.message || "取消预约失败",
            icon: "none"
          });
        }
      }
    });
  }
});
