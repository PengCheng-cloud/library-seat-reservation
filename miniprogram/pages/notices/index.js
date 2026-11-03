const api = require("../../services/api");
const { ensureLoggedIn } = require("../../utils/auth");

const NOTICE_TYPE_LABELS = {
  system: "系统通知",
  maintenance: "维护通知",
  activity: "活动通知",
  rule: "规则提醒"
};

function buildNoticeCards(notices) {
  return (notices || []).map((notice) => ({
    ...notice,
    typeLabel: NOTICE_TYPE_LABELS[notice.noticeType] || "通知",
    publishText: notice.publishDate || "未设置发布时间"
  }));
}

Page({
  data: {
    loading: true,
    notices: []
  },

  onLoad() {
    const currentUser = ensureLoggedIn("/pages/notices/index");
    if (!currentUser) {
      return;
    }

    this.loadNotices();
  },

  async loadNotices() {
    try {
      let response;

      try {
        response = await api.getNotices({ limit: 30 });
      } catch (noticeError) {
        if (noticeError.statusCode !== 404) {
          throw noticeError;
        }

        const homeData = await api.getHomeData();
        response = {
          items: homeData.notices || []
        };
      }

      this.setData({
        loading: false,
        notices: buildNoticeCards(response.items || [])
      });
    } catch (error) {
      this.setData({
        loading: false
      });

      wx.showToast({
        title: error.message || "公告加载失败",
        icon: "none"
      });
    }
  }
});
