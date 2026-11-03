const api = require("../../services/api");
const { ensureLoggedIn, getCurrentUser } = require("../../utils/auth");
const { openPage } = require("../../utils/navigation");
const { getOffsetDate } = require("../../utils/date");
const { showcaseHero, featureGallery } = require("../../config/showcase");

const FEATURE_TONES = [
  "home-filter-chip--green",
  "home-filter-chip--cyan",
  "home-filter-chip--mint",
  "home-filter-chip--lime"
];

const ZONE_TONES = [
  "home-zone-tile--green",
  "home-zone-tile--cyan"
];

const BAND_LABELS = {
  north: "北侧静音区",
  west: "西侧学习区",
  east: "东侧常规区",
  south_inner: "南侧内圈",
  south_outer: "南侧外圈"
};

const NOTICE_TYPE_LABELS = {
  system: "系统通知",
  maintenance: "维护通知",
  activity: "活动通知",
  rule: "规则提醒"
};

function syncTabBar(page) {
  const tabBar = page && typeof page.getTabBar === "function" ? page.getTabBar() : null;
  if (tabBar && typeof tabBar.syncSelected === "function") {
    tabBar.syncSelected();
  }
}

function getGreetingText() {
  const hour = new Date().getHours();
  if (hour < 11) {
    return "上午好";
  }

  if (hour < 14) {
    return "中午好";
  }

  if (hour < 18) {
    return "下午好";
  }

  return "晚上好";
}

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

function buildHeroMetrics(summary, rules) {
  return [
    {
      label: "开放分区",
      value: String(summary.zoneCount || 0)
    },
    {
      label: "总座位",
      value: String(summary.seatCount || 0)
    },
    {
      label: "预约时长",
      value: `${rules.minReservationMinutes || 0}-${rules.maxReservationMinutes || 0} 分钟`
    }
  ];
}

function buildFeatureQuickActions(items) {
  return (items || [])
    .map((item, index) => ({
      ...item,
      actionLabel: buildActionLabel(item.actionType),
      hasAction: Boolean(buildActionUrl(item.actionType, item.actionValue)),
      toneClass: FEATURE_TONES[index % FEATURE_TONES.length],
      displayTags: (item.tags || []).slice(0, 2)
    }))
    .filter((item) => item.hasAction)
    .slice(0, 4);
}

function buildHotZoneCards(zones) {
  return (zones || []).map((zone, index) => ({
    ...zone,
    bandLabel: BAND_LABELS[zone.band] || "当前分区",
    badgeText: index === 0 ? "最热入口" : `${zone.tableGroupCount || 0} 个桌组`,
    highlightText: zone.quietSeatCount
      ? `安静座位 ${zone.quietSeatCount} 个`
      : `座位总数 ${zone.seatCount || 0} 个`,
    toneClass: ZONE_TONES[index % ZONE_TONES.length]
  }));
}

function buildNoticeCards(notices) {
  return (notices || []).map((notice) => ({
    ...notice,
    typeLabel: NOTICE_TYPE_LABELS[notice.noticeType] || "通知",
    summary: String(notice.content || "").trim().slice(0, 32)
  }));
}

Page({
  data: {
    loading: true,
    systemName: "图书馆座位预约系统",
    greetingText: getGreetingText(),
    currentUser: null,
    currentUserDisplayName: "同学",
    currentUserInitial: "同",
    heroImage: showcaseHero.image,
    heroSceneTitle: showcaseHero.title || "图书馆主入口",
    heroBadge: showcaseHero.badge || "真实馆景",
    heroDescription: "先看分区状态，再从地图、AI 或偏好速选里直接进入预约。",
    heroMetrics: [
      { label: "开放分区", value: "--" },
      { label: "总座位", value: "--" },
      { label: "预约时长", value: "30-240 分钟" }
    ],
    featureQuickActions: buildFeatureQuickActions(featureGallery),
    hotZones: [],
    topNotice: null,
    noticeCount: 0
  },

  onLoad() {
    const currentUser = ensureLoggedIn("/pages/home/index");
    if (!currentUser) {
      return;
    }

    this.updateCurrentUser(currentUser);
    this.loadPageData();
  },

  onShow() {
    syncTabBar(this);

    const currentUser = getCurrentUser();
    if (currentUser) {
      this.updateCurrentUser(currentUser);
    }

    this.setData({
      greetingText: getGreetingText()
    });
  },

  updateCurrentUser(user) {
    const displayName = (user && (user.realName || user.studentNo)) || "同学";

    this.setData({
      currentUser: user,
      currentUserDisplayName: displayName,
      currentUserInitial: displayName.slice(0, 1)
    });
  },

  async loadPageData() {
    try {
      const response = await api.getHomeData();
      const summary = response.summary || {};
      const rules = response.rules || {};
      const noticeCards = buildNoticeCards(response.notices || []);

      this.setData({
        loading: false,
        systemName: response.systemName || "图书馆座位预约系统",
        heroMetrics: buildHeroMetrics(summary, rules),
        hotZones: buildHotZoneCards(response.hotZones || []).slice(0, 2),
        topNotice: noticeCards[0] || null,
        noticeCount: noticeCards.length
      });
    } catch (error) {
      this.setData({
        loading: false
      });

      wx.showToast({
        title: error.message || "首页数据加载失败",
        icon: "none"
      });
    }
  },

  openSeatMap() {
    openPage("/pages/seat/index?workspace=map");
  },

  openSeatSmart() {
    openPage("/pages/seat/index?workspace=smart");
  },

  openReservations() {
    openPage("/pages/reservation/index");
  },

  openProfile() {
    openPage("/pages/profile/index");
  },

  openNotices() {
    openPage("/pages/notices/index");
  },

  openPreferencesPage() {
    openPage("/pages/preferences/index");
  },

  openShowcaseCollection(event) {
    const { type } = event.currentTarget.dataset;
    openPage(`/pages/showcase/index?type=${encodeURIComponent(type || "space")}`);
  },

  openShowcaseAction(event) {
    const { actionType, actionValue } = event.currentTarget.dataset;
    const actionUrl = buildActionUrl(actionType, actionValue);
    if (!actionUrl) {
      return;
    }

    openPage(actionUrl);
  },

  openZoneSeatPage(event) {
    const { zoneCode } = event.currentTarget.dataset;
    if (!zoneCode) {
      return;
    }

    openPage(buildZoneUrl(zoneCode));
  }
});
