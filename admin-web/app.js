const STORAGE_KEYS = {
  session: "library-seat-admin-session",
  apiBase: "library-seat-admin-api-base",
};

const RUNTIME_CONFIG =
  window.__ADMIN_RUNTIME__ && typeof window.__ADMIN_RUNTIME__ === "object"
    ? window.__ADMIN_RUNTIME__
    : {};

const FALLBACK_PUBLIC_BASE = "https://your-server.example.com";
const DEFAULT_API_BASE = resolveDefaultApiBase();

const STATUS_LABELS = {
  reserved: "已预约",
  checked_in: "已签到",
  temporary_leave: "暂离中",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未签到",
  violation: "违约",
  admin_released: "管理员释放",
  draft: "草稿",
  published: "已发布",
  offline: "已下线",
};

const ROLE_LABELS = {
  reader: "读者",
  admin: "管理员",
  super_admin: "超级管理员",
};

const NOTICE_TYPE_LABELS = {
  system: "系统通知",
  maintenance: "维护通知",
  activity: "活动通知",
  rule: "规则说明",
};

const AUDIENCE_LABELS = {
  all: "全部用户",
  reader: "读者",
  admin: "管理员",
};

const CHART_SEQUENCE = ["#2c8f63", "#4d9e7a", "#5f89cb", "#d4a44a", "#d74b45", "#8c9bb0", "#245b7a"];

const STATUS_CHART_COLORS = {
  reserved: "#2c8f63",
  checked_in: "#1f734f",
  temporary_leave: "#d4a44a",
  completed: "#5f89cb",
  cancelled: "#8c9bb0",
  no_show: "#d74b45",
  violation: "#b53a34",
  admin_released: "#6f7f94",
};

const VIOLATION_CHART_COLORS = {
  no_show: "#d74b45",
  leave_timeout: "#d4a44a",
  manual_penalty: "#5f89cb",
};

const VIEW_META = {
  dashboardSection: {
    title: "数据统计",
    description: "核心指标、预约状态、信用预警与最近动态。",
  },
  reportSection: {
    title: "运营报表",
    description: "使用率、签到率、高峰热度与读者活跃情况。",
  },
  noticeSection: {
    title: "公告管理",
    description: "维护通知内容、发布对象与上下线状态。",
  },
  reservationSection: {
    title: "预约管理",
    description: "检索预约记录，处理代签退、释放预约与异常状态。",
  },
  userSection: {
    title: "用户管理",
    description: "筛选账号，处理信用分、黑名单与人工调整。",
  },
  resourceSection: {
    title: "座位管理",
    description: "维护座位列表、分区信息与静态状态。",
  },
  configSection: {
    title: "规则配置",
    description: "维护预约、签到、暂离和信用策略。",
  },
};

const state = {
  apiBase: loadApiBase(),
  session: loadSession(),
  activeView: "dashboardSection",
  resourceEditorMode: "seat",
  health: null,
  lastSyncedAt: "",
  dashboard: null,
  reports: null,
  notices: [],
  reservations: [],
  reservationSummary: [],
  users: [],
  zones: [],
  seats: [],
  seatSummary: [],
  configGroups: {},
  configItems: [],
  selectedUserNo: "",
  editingNoticeId: null,
  editingZoneCode: "",
  editingSeatCode: "",
  noticeFilters: {
    keyword: "",
    status: "",
    audience: "",
  },
  reservationFilters: {
    keyword: "",
    status: "",
    reservationDate: "",
  },
  userFilters: {
    keyword: "",
    blacklistOnly: false,
  },
  reportFilters: {
    startDate: "",
    endDate: "",
  },
  seatFilters: {
    keyword: "",
    zoneCode: "",
    seatStatus: "",
  },
};

let statusTimer = 0;

const dom = {
  accountMenu: document.querySelector("[data-account-menu]"),
  accountMenuBtn: document.getElementById("accountMenuBtn"),
  accountMenuPanel: document.getElementById("accountMenuPanel"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  saveApiBaseBtn: document.getElementById("saveApiBaseBtn"),
  refreshAllBtn: document.getElementById("refreshAllBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  sessionBadge: document.getElementById("sessionBadge"),
  healthBadge: document.getElementById("healthBadge"),
  healthMeta: document.getElementById("healthMeta"),
  accessModeBadge: document.getElementById("accessModeBadge"),
  adminEntryLink: document.getElementById("adminEntryLink"),
  sidebarAdminLink: document.getElementById("sidebarAdminLink"),
  loginEntryHint: document.getElementById("loginEntryHint"),
  lastSyncTime: document.getElementById("lastSyncTime"),
  appStatus: document.getElementById("appStatus"),
  loginPanel: document.getElementById("loginPanel"),
  loginForm: document.getElementById("loginForm"),
  loginStudentNo: document.getElementById("loginStudentNo"),
  loginPassword: document.getElementById("loginPassword"),
  workspace: document.getElementById("workspace"),
  dashboardScroll: document.querySelector("#dashboardSection .view-scroll"),
  reportScroll: document.querySelector("#reportSection .view-scroll"),
  viewHeading: document.getElementById("viewHeading"),
  guidePanel: document.getElementById("guidePanel"),
  summaryCards: document.getElementById("summaryCards"),
  reportFilterForm: document.getElementById("reportFilterForm"),
  reportStartDate: document.getElementById("reportStartDate"),
  reportEndDate: document.getElementById("reportEndDate"),
  reportStatusStrip: document.getElementById("reportStatusStrip"),
  reportSummaryCards: document.getElementById("reportSummaryCards"),
  reportZoneUsage: document.getElementById("reportZoneUsage"),
  reportTopReaders: document.getElementById("reportTopReaders"),
  reportDailyUsage: document.getElementById("reportDailyUsage"),
  reportViolationStats: document.getElementById("reportViolationStats"),
  reportHourlyHeatmap: document.getElementById("reportHourlyHeatmap"),
  statusDistribution: document.getElementById("statusDistribution"),
  creditWarnings: document.getElementById("creditWarnings"),
  recentReservations: document.getElementById("recentReservations"),
  recentNotices: document.getElementById("recentNotices"),
  resetNoticeFormBtn: document.getElementById("resetNoticeFormBtn"),
  noticeFormTitle: document.getElementById("noticeFormTitle"),
  noticeForm: document.getElementById("noticeForm"),
  noticeTitle: document.getElementById("noticeTitle"),
  noticeContent: document.getElementById("noticeContent"),
  noticeType: document.getElementById("noticeType"),
  noticeAudience: document.getElementById("noticeAudience"),
  noticeStatus: document.getElementById("noticeStatus"),
  noticePublishAt: document.getElementById("noticePublishAt"),
  noticeExpireAt: document.getElementById("noticeExpireAt"),
  clearNoticeBtn: document.getElementById("clearNoticeBtn"),
  noticeFilterForm: document.getElementById("noticeFilterForm"),
  noticeKeyword: document.getElementById("noticeKeyword"),
  noticeFilterStatus: document.getElementById("noticeFilterStatus"),
  noticeFilterAudience: document.getElementById("noticeFilterAudience"),
  noticeList: document.getElementById("noticeList"),
  reservationFilterForm: document.getElementById("reservationFilterForm"),
  reservationKeyword: document.getElementById("reservationKeyword"),
  reservationStatus: document.getElementById("reservationStatus"),
  reservationDate: document.getElementById("reservationDate"),
  reservationSummary: document.getElementById("reservationSummary"),
  reservationTable: document.querySelector("#reservationSection .data-table"),
  reservationTableBody: document.getElementById("reservationTableBody"),
  userFilterForm: document.getElementById("userFilterForm"),
  userKeyword: document.getElementById("userKeyword"),
  blacklistOnly: document.getElementById("blacklistOnly"),
  userTableBody: document.getElementById("userTableBody"),
  selectedUserCard: document.getElementById("selectedUserCard"),
  creditForm: document.getElementById("creditForm"),
  creditDelta: document.getElementById("creditDelta"),
  creditReason: document.getElementById("creditReason"),
  creditPresetPenaltyBtn: document.getElementById("creditPresetPenaltyBtn"),
  zoneForm: document.getElementById("zoneForm"),
  zoneCodeInput: document.getElementById("zoneCodeInput"),
  zoneDisplayNameInput: document.getElementById("zoneDisplayNameInput"),
  zoneFloorNoInput: document.getElementById("zoneFloorNoInput"),
  zoneGridLetterInput: document.getElementById("zoneGridLetterInput"),
  zoneGridNumberInput: document.getElementById("zoneGridNumberInput"),
  zoneBandInput: document.getElementById("zoneBandInput"),
  zoneAnnotationStatusInput: document.getElementById("zoneAnnotationStatusInput"),
  zoneSortOrderInput: document.getElementById("zoneSortOrderInput"),
  zoneIsEnabledInput: document.getElementById("zoneIsEnabledInput"),
  zoneNotesInput: document.getElementById("zoneNotesInput"),
  resetZoneFormBtn: document.getElementById("resetZoneFormBtn"),
  zoneList: document.getElementById("zoneList"),
  seatEditorForm: document.getElementById("seatEditorForm"),
  seatCodeInput: document.getElementById("seatCodeInput"),
  seatEditorZoneCode: document.getElementById("seatEditorZoneCode"),
  seatTableCodeInput: document.getElementById("seatTableCodeInput"),
  seatSeqInput: document.getElementById("seatSeqInput"),
  seatTypeInput: document.getElementById("seatTypeInput"),
  seatCapacityInput: document.getElementById("seatCapacityInput"),
  seatStatusInput: document.getElementById("seatStatusInput"),
  seatQuietLevelInput: document.getElementById("seatQuietLevelInput"),
  seatHasPowerInput: document.getElementById("seatHasPowerInput"),
  seatNearWindowInput: document.getElementById("seatNearWindowInput"),
  seatSortOrderInput: document.getElementById("seatSortOrderInput"),
  seatSpecificLocationInput: document.getElementById("seatSpecificLocationInput"),
  resetSeatEditorBtn: document.getElementById("resetSeatEditorBtn"),
  createSeatBtn: document.getElementById("createSeatBtn"),
  resetSeatFilterBtn: document.getElementById("resetSeatFilterBtn"),
  refreshSeatListBtn: document.getElementById("refreshSeatListBtn"),
  seatFilterForm: document.getElementById("seatFilterForm"),
  seatKeyword: document.getElementById("seatKeyword"),
  seatZoneCode: document.getElementById("seatZoneCode"),
  seatFilterStatus: document.getElementById("seatFilterStatus"),
  seatSummary: document.getElementById("seatSummary"),
  seatTableBody: document.getElementById("seatTableBody"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  applyConfigBtn: document.getElementById("applyConfigBtn"),
  configStatusStrip: document.getElementById("configStatusStrip"),
  configList: document.getElementById("configList"),
  seatEditorPanel: document.getElementById("seatEditorPanel"),
  zoneEditorPanel: document.getElementById("zoneEditorPanel"),
  viewPanels: Array.from(document.querySelectorAll(".view-panel")),
  navLinks: Array.from(document.querySelectorAll(".nav-link[data-nav-target]")),
  resourceEditorTabs: Array.from(document.querySelectorAll(".editor-tab[data-editor-mode]")),
};

initializeSurfaceLayouts();
bootstrap();

function initializeSurfaceLayouts() {
  if (dom.dashboardScroll) {
    dom.dashboardScroll.innerHTML = `
      <section class="panel-hero panel-hero--compact workspace-hero">
        <div class="panel-hero-copy">
          <span class="section-kicker">Overview</span>
          <h3>运行数据总览</h3>
          <p>集中展示座位、预约、公告和信用风险。</p>
        </div>
      </section>

      <div id="summaryCards" class="stats-strip"></div>

      <div class="workspace-grid dashboard-primary-grid">
        <section class="content-block chart-block">
          <div class="block-head">
            <div>
              <h3>预约状态概览</h3>
              <span>实时分布</span>
            </div>
          </div>
          <div id="statusDistribution" class="chart-panel"></div>
        </section>

        <section class="content-block">
          <div class="block-head">
            <div>
              <h3>信用预警</h3>
              <span>低信用分与黑名单</span>
            </div>
          </div>
          <div id="creditWarnings" class="plain-list plain-list--spacious"></div>
        </section>
      </div>

      <div class="workspace-grid dashboard-secondary-grid">
        <section class="content-block">
          <div class="block-head">
            <div>
              <h3>最新预约</h3>
              <span>最近产生的预约记录</span>
            </div>
          </div>
          <div id="recentReservations" class="stack-list stack-list--soft"></div>
        </section>

        <section class="content-block">
          <div class="block-head">
            <div>
              <h3>最新公告</h3>
              <span>最近发布或更新的通知</span>
            </div>
          </div>
          <div id="recentNotices" class="stack-list stack-list--soft"></div>
        </section>
      </div>
    `;
  }

  if (dom.reportScroll) {
    dom.reportScroll.innerHTML = `
      <section class="panel-hero panel-hero--compact workspace-hero">
        <div class="panel-hero-copy">
          <span class="section-kicker">Report</span>
          <h3>运营报表</h3>
          <p>按时间范围统计分区热度、读者活跃和违约结构。</p>
        </div>
      </section>

      <form id="reportFilterForm" class="toolbar-filter report-filter-bar">
        <label class="field">
          <span>开始日期</span>
          <input id="reportStartDate" type="date" />
        </label>

        <label class="field">
          <span>结束日期</span>
          <input id="reportEndDate" type="date" />
        </label>

        <button class="primary-btn compact-btn" type="submit">刷新报表</button>
      </form>

      <div id="reportStatusStrip" class="tag-strip"></div>
      <div id="reportSummaryCards" class="stats-strip report-strip"></div>

      <div class="workspace-grid report-primary-grid">
        <section class="content-block chart-block chart-block--wide">
          <div class="block-head">
            <div>
              <h3>分区使用情况</h3>
              <span>分区负载</span>
            </div>
          </div>
          <div id="reportZoneUsage" class="chart-panel"></div>
        </section>

        <section class="content-block chart-block">
          <div class="block-head">
            <div>
              <h3>活跃读者</h3>
              <span>预约频次</span>
            </div>
          </div>
          <div id="reportTopReaders" class="report-list report-list--rank"></div>
        </section>
      </div>

      <div class="workspace-grid report-secondary-grid">
        <section class="content-block chart-block">
          <div class="block-head">
            <div>
              <h3>每日趋势</h3>
              <span>按天查看预约量、签到率和使用率</span>
            </div>
          </div>
          <div id="reportDailyUsage" class="chart-panel"></div>
        </section>

        <section class="content-block chart-block">
          <div class="block-head">
            <div>
              <h3>违约统计</h3>
              <span>识别主要异常类型和占比</span>
            </div>
          </div>
          <div id="reportViolationStats" class="chart-panel"></div>
        </section>
      </div>

      <section class="content-block">
        <div class="block-head">
          <div>
            <h3>高峰时段</h3>
            <span>按预约开始时间观察全天热度</span>
          </div>
        </div>
        <div id="reportHourlyHeatmap" class="chart-panel"></div>
      </section>
    `;
  }

  refreshSurfaceRefs();
}

function refreshSurfaceRefs() {
  dom.summaryCards = document.getElementById("summaryCards");
  dom.reportFilterForm = document.getElementById("reportFilterForm");
  dom.reportStartDate = document.getElementById("reportStartDate");
  dom.reportEndDate = document.getElementById("reportEndDate");
  dom.reportStatusStrip = document.getElementById("reportStatusStrip");
  dom.reportSummaryCards = document.getElementById("reportSummaryCards");
  dom.reportZoneUsage = document.getElementById("reportZoneUsage");
  dom.reportTopReaders = document.getElementById("reportTopReaders");
  dom.reportDailyUsage = document.getElementById("reportDailyUsage");
  dom.reportViolationStats = document.getElementById("reportViolationStats");
  dom.reportHourlyHeatmap = document.getElementById("reportHourlyHeatmap");
  dom.statusDistribution = document.getElementById("statusDistribution");
  dom.creditWarnings = document.getElementById("creditWarnings");
  dom.recentReservations = document.getElementById("recentReservations");
  dom.recentNotices = document.getElementById("recentNotices");
}

function bootstrap() {
  initializeReportFilters();
  normalizeReservationTableHead();
  bindEvents();
  initializeViewState();
  setResourceEditorMode(state.resourceEditorMode, { focus: false });
  dom.apiBaseInput.value = state.apiBase;
  applyStoredFilters();
  syncSessionUi();
  syncAccessUi();
  renderHealthState();
  renderSyncMeta();

  if (window.location.protocol === "file:") {
    showStatus("请通过后台入口访问。");
  }

  loadHealth({ quiet: true }).catch(() => {});

  if (state.session) {
    refreshAllData({ quiet: true }).catch(handleError);
  } else {
    renderLoggedOutState();
  }
}

function normalizeReservationTableHead() {
  if (!dom.reservationTable || !dom.reservationTable.tHead) {
    return;
  }

  dom.reservationTable.tHead.innerHTML = `
    <tr>
      <th>预约号</th>
      <th>读者</th>
      <th>座位</th>
      <th>日期时段</th>
      <th>状态</th>
      <th>违约类型</th>
      <th>创建时间</th>
      <th>操作</th>
    </tr>
  `;

  const extraHeads = dom.reservationTable.querySelectorAll("thead");
  extraHeads.forEach((head, index) => {
    if (index > 0) {
      head.remove();
    }
  });
}

function initializeReportFilters() {
  if (!state.reportFilters.endDate) {
    state.reportFilters.endDate = formatDateInput(new Date());
  }

  if (!state.reportFilters.startDate) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    state.reportFilters.startDate = formatDateInput(startDate);
  }
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);

  dom.accountMenuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAccountMenuOpen(dom.accountMenuPanel?.classList.contains("hidden"));
  });

  dom.navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      setActiveView(link.dataset.navTarget || "dashboardSection");
    });
  });

  dom.resourceEditorTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setResourceEditorMode(tab.dataset.editorMode || "seat", { focus: false, reveal: false, resetScroll: true });
    });
  });

  dom.saveApiBaseBtn.addEventListener("click", async () => {
    state.apiBase = normalizeApiBase(dom.apiBaseInput.value);
    localStorage.setItem(STORAGE_KEYS.apiBase, state.apiBase);
    dom.apiBaseInput.value = state.apiBase;
    syncAccessUi();
    await loadHealth({ quiet: true });
    showStatus(`后端地址已保存为 ${state.apiBase}`, "success");
  });

  dom.refreshAllBtn.addEventListener("click", async () => {
    try {
      ensureSession();
      await refreshAllData();
    } catch (error) {
      handleError(error);
    }
  });

  dom.logoutBtn.addEventListener("click", () => {
    setAccountMenuOpen(false);
    state.session = null;
    state.dashboard = null;
    state.reports = null;
    state.notices = [];
    state.reservations = [];
    state.reservationSummary = [];
    state.users = [];
    state.zones = [];
    state.seats = [];
    state.seatSummary = [];
    state.selectedUserNo = "";
    state.editingNoticeId = null;
    state.lastSyncedAt = "";
    localStorage.removeItem(STORAGE_KEYS.session);
    syncSessionUi();
    renderSyncMeta();
    renderLoggedOutState();
    showStatus("管理员登录态已清除。");
  });

  dom.reportFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.reportFilters.startDate = dom.reportStartDate.value;
    state.reportFilters.endDate = dom.reportEndDate.value;

    try {
      ensureSession();
      await loadReports();
      renderReports();
      showStatus("报表已刷新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const studentNo = dom.loginStudentNo.value.trim();
      const password = dom.loginPassword.value;
      const result = await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ studentNo, password }),
      });

      state.session = {
        ...(result.user || {}),
        token: result.token || "",
        tokenExpiresAt: result.expiresAt || "",
      };
      localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
      syncSessionUi();
      showStatus(result.message || "登录成功。", "success");
      await refreshAllData({ quiet: true });
    } catch (error) {
      handleError(error);
    }
  });

  dom.noticeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      ensureSession();
      const payload = collectNoticeForm();
      const url = state.editingNoticeId
        ? `/api/admin/notices/${state.editingNoticeId}`
        : "/api/admin/notices";

      const result = await request(url, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          studentNo: state.session.studentNo,
        }),
      });

      resetNoticeEditor();
      await Promise.all([loadDashboard(), loadNotices()]);
      showStatus(result.message || "公告已保存。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.noticeFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.noticeFilters.keyword = dom.noticeKeyword.value.trim();
    state.noticeFilters.status = dom.noticeFilterStatus.value;
    state.noticeFilters.audience = dom.noticeFilterAudience.value;

    try {
      ensureSession();
      await loadNotices();
      showStatus("公告列表已刷新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.reservationFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.reservationFilters.keyword = dom.reservationKeyword.value.trim();
    state.reservationFilters.status = dom.reservationStatus.value;
    state.reservationFilters.reservationDate = dom.reservationDate.value;

    try {
      ensureSession();
      await loadReservations();
      showStatus("预约记录已刷新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.userFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.userFilters.keyword = dom.userKeyword.value.trim();
    state.userFilters.blacklistOnly = dom.blacklistOnly.checked;

    try {
      ensureSession();
      await loadUsers();
      if (state.selectedUserNo && !state.users.some((user) => user.studentNo === state.selectedUserNo)) {
        state.selectedUserNo = "";
      }
      renderUsers();
      renderSelectedUser();
      showStatus(`账号列表已刷新，共 ${state.users.length} 条。`, "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.zoneForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      ensureSession();
      const payload = collectZoneForm();
      const isEditing = Boolean(state.editingZoneCode);
      const url = isEditing
        ? `/api/admin/zones/${encodeURIComponent(state.editingZoneCode)}`
        : "/api/admin/zones";
      const result = await request(url, {
        method: "POST",
        body: JSON.stringify({
          studentNo: state.session.studentNo,
          ...payload,
        }),
      });

      await Promise.all([loadDashboard(), loadReports(), loadZones(), loadSeats()]);
      renderDashboard();
      renderReports();
      renderResources();
      resetZoneEditor();
      showStatus(result.message || (isEditing ? "分区已更新。" : "分区已创建。"), "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.seatEditorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      ensureSession();
      const payload = collectSeatForm();
      const isEditing = Boolean(state.editingSeatCode);
      const url = isEditing
        ? `/api/admin/seats/${encodeURIComponent(state.editingSeatCode)}`
        : "/api/admin/seats";
      const result = await request(url, {
        method: "POST",
        body: JSON.stringify({
          studentNo: state.session.studentNo,
          ...payload,
        }),
      });

      await Promise.all([loadDashboard(), loadReports(), loadZones(), loadSeats()]);
      renderDashboard();
      renderReports();
      renderResources();
      resetSeatEditor();
      showStatus(result.message || (isEditing ? "座位已更新。" : "座位已创建。"), "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.seatFilterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.seatFilters.keyword = dom.seatKeyword.value.trim();
    state.seatFilters.zoneCode = dom.seatZoneCode.value;
    state.seatFilters.seatStatus = dom.seatFilterStatus.value;

    try {
      ensureSession();
      await loadSeats();
      renderResources();
      showStatus("座位资源已刷新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.creditForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      ensureSession();
      if (!state.selectedUserNo) {
        throw new Error("请先选择一个账号，再调整信用分。");
      }

      const delta = Number(dom.creditDelta.value);
      const reason = dom.creditReason.value.trim();
      const result = await request(`/api/admin/users/${encodeURIComponent(state.selectedUserNo)}/credit-adjust`, {
        method: "POST",
        body: JSON.stringify({
          studentNo: state.session.studentNo,
          delta,
          reason,
        }),
      });

      dom.creditDelta.value = "";
      dom.creditReason.value = "";
      await Promise.all([loadDashboard(), loadUsers()]);
      selectUser(result.user.studentNo);
      showStatus(result.message || "信用分已更新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.creditPresetPenaltyBtn.addEventListener("click", () => {
    dom.creditDelta.value = "-10";
    if (!dom.creditReason.value.trim()) {
      dom.creditReason.value = "管理员核验后补扣未签到违约分";
    }
  });

  dom.resetZoneFormBtn.addEventListener("click", () => resetZoneEditor({ focus: true }));
  dom.resetSeatEditorBtn.addEventListener("click", () => resetSeatEditor({ focus: true }));
  dom.createSeatBtn?.addEventListener("click", () => {
    setActiveView("resourceSection");
    resetSeatEditor({ focus: true });
  });
  dom.resetSeatFilterBtn?.addEventListener("click", async () => {
    state.seatFilters.keyword = "";
    state.seatFilters.zoneCode = "";
    state.seatFilters.seatStatus = "";
    dom.seatKeyword.value = "";
    dom.seatZoneCode.value = "";
    dom.seatFilterStatus.value = "";

    try {
      ensureSession();
      await loadSeats();
      renderResources();
      showStatus("座位筛选条件已重置。", "success");
    } catch (error) {
      handleError(error);
    }
  });
  dom.refreshSeatListBtn?.addEventListener("click", async () => {
    try {
      ensureSession();
      await loadSeats();
      renderResources();
      showStatus("座位列表已刷新。", "success");
    } catch (error) {
      handleError(error);
    }
  });

  dom.saveConfigBtn?.addEventListener("click", saveConfigChanges);
  dom.applyConfigBtn?.addEventListener("click", saveConfigChanges);

  dom.clearNoticeBtn.addEventListener("click", resetNoticeEditor);
  dom.resetNoticeFormBtn.addEventListener("click", resetNoticeEditor);
}

async function saveConfigChanges() {
  const buttons = [dom.saveConfigBtn, dom.applyConfigBtn].filter(Boolean);

  try {
    ensureSession();
    buttons.forEach((button) => {
      button.disabled = true;
      button.dataset.originalText = button.dataset.originalText || button.textContent;
      button.textContent = "保存中...";
    });

    const result = await request("/api/admin/configs", {
      method: "POST",
      body: JSON.stringify({
        studentNo: state.session.studentNo,
        configs: collectConfigFormValues(),
      }),
    });

    state.configGroups = result.groups || {};
    state.configItems = result.items || [];
    await Promise.all([loadDashboard(), loadReports()]);
    renderDashboard();
    renderReports();
    renderConfigs();
    showStatus(result.message || "规则配置已保存，小程序端刷新后会读取最新规则。", "success");
  } catch (error) {
    handleError(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = button.dataset.originalText || "保存规则";
    });
  }
}

function setAccountMenuOpen(isOpen) {
  if (!dom.accountMenuBtn || !dom.accountMenuPanel) {
    return;
  }

  const nextState = Boolean(isOpen);
  dom.accountMenuBtn.setAttribute("aria-expanded", String(nextState));
  dom.accountMenuPanel.classList.toggle("hidden", !nextState);
  dom.accountMenuPanel.classList.toggle("is-open", nextState);
  dom.accountMenu?.classList.toggle("is-open", nextState);
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    setAccountMenuOpen(false);
  }
}

function handleDocumentClick(event) {
  if (dom.accountMenu && !dom.accountMenu.contains(event.target)) {
    setAccountMenuOpen(false);
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  if (action === "edit-notice") {
    const noticeId = Number(actionTarget.dataset.noticeId);
    const notice = state.notices.find((item) => item.id === noticeId);
    if (notice) {
      fillNoticeForm(notice);
    }
    return;
  }

  if (action === "change-notice-status") {
    const noticeId = Number(actionTarget.dataset.noticeId);
    const status = actionTarget.dataset.nextStatus;
    updateNoticeStatus(noticeId, status).catch(handleError);
    return;
  }

  if (action === "select-user") {
    const studentNo = actionTarget.dataset.studentNo || "";
    selectUser(studentNo);
    return;
  }

  if (action === "filter-seat-status") {
    state.seatFilters.seatStatus = actionTarget.dataset.seatStatus || "";
    dom.seatFilterStatus.value = state.seatFilters.seatStatus;

    loadSeats()
      .then(() => {
        renderResources();
        showStatus("座位状态筛选已更新。", "success");
      })
      .catch(handleError);
    return;
  }

  if (action === "manual-checkout-reservation") {
    const reservationNo = actionTarget.dataset.reservationNo || "";
    const reservation = state.reservations.find((item) => item.reservationNo === reservationNo);
    const reason = window.prompt(
      `请输入管理员代签退 ${reservationNo} 的原因：`,
      reservation && reservation.status === "temporary_leave"
        ? "管理员巡检后结束暂离中的预约"
        : "管理员巡检后代为签退"
    );

    if (reason && reason.trim()) {
      manualCheckoutReservation(reservationNo, reason.trim()).catch(handleError);
    }
    return;
  }

  if (action === "release-reservation") {
    const reservationNo = actionTarget.dataset.reservationNo || "";
    const reason = window.prompt(
      `请输入释放预约 ${reservationNo} 的原因：`,
      "管理员核验后释放座位"
    );

    if (reason && reason.trim()) {
      releaseReservation(reservationNo, reason.trim()).catch(handleError);
    }
    return;
  }

  if (action === "toggle-zone") {
    const zoneCode = actionTarget.dataset.zoneCode || "";
    const nextEnabled = actionTarget.dataset.nextEnabled === "true";
    const reason = window.prompt(
      `请输入${nextEnabled ? "启用" : "停用"}分区 ${zoneCode} 的原因：`,
      nextEnabled ? "分区重新开放预约" : "分区临时停用"
    );

    if (reason && reason.trim()) {
      updateZoneEnabled(zoneCode, nextEnabled, reason.trim()).catch(handleError);
    }
    return;
  }

  if (action === "edit-zone") {
    const zoneCode = actionTarget.dataset.zoneCode || "";
    const zone = state.zones.find((item) => item.zoneCode === zoneCode);
    if (zone) {
      fillZoneForm(zone);
    }
    return;
  }

  if (action === "delete-zone") {
    const zoneCode = actionTarget.dataset.zoneCode || "";
    const confirmed = window.confirm(`确认删除分区 ${zoneCode} 吗？请先确保该分区下的座位已处理完成。`);
    if (confirmed) {
      deleteZone(zoneCode).catch(handleError);
    }
    return;
  }

  if (action === "change-seat-status") {
    const seatCode = actionTarget.dataset.seatCode || "";
    const nextSeatStatus = actionTarget.dataset.nextSeatStatus || "";
    const reason = window.prompt(
      `请输入将座位 ${seatCode} 调整为“${formatSeatStaticStatus(nextSeatStatus)}”的原因：`,
      nextSeatStatus === "maintenance" ? "座位进入维护状态" : "管理员更新座位状态"
    );

    if (reason && reason.trim()) {
      updateSeatStatus(seatCode, nextSeatStatus, reason.trim()).catch(handleError);
    }
    return;
  }

  if (action === "edit-seat") {
    const seatCode = actionTarget.dataset.seatCode || "";
    const seat = state.seats.find((item) => item.seatCode === seatCode);
    if (seat) {
      fillSeatForm(seat);
    }
    return;
  }

  if (action === "delete-seat") {
    const seatCode = actionTarget.dataset.seatCode || "";
    const confirmed = window.confirm(`确认删除座位 ${seatCode} 吗？已有预约历史的座位不可删除。`);
    if (confirmed) {
      deleteSeat(seatCode).catch(handleError);
    }
  }
}

function syncSessionUi() {
  const loggedIn = Boolean(state.session);
  document.body.dataset.auth = loggedIn ? "in" : "out";
  dom.loginPanel.classList.toggle("hidden", loggedIn);
  dom.workspace.classList.toggle("hidden", !loggedIn);
  dom.logoutBtn.classList.toggle("hidden", !loggedIn);
  dom.refreshAllBtn.disabled = !loggedIn;
  dom.saveConfigBtn.disabled = !loggedIn;
  setAccountMenuOpen(false);

  if (!loggedIn) {
    dom.sessionBadge.textContent = "未登录";
    dom.sessionBadge.title = "未登录";
    renderGuidePanel();
    return;
  }

  dom.sessionBadge.textContent = `${formatRole(state.session.role)} · ${state.session.realName}`;
  dom.sessionBadge.title = `${formatRole(state.session.role)} · ${state.session.realName} (${state.session.studentNo})`;
  renderGuidePanel();
}

function renderLoggedOutState() {
  state.lastSyncedAt = "";
  renderSyncMeta();
  dom.summaryCards.innerHTML = buildPlaceholderCards();
  dom.reportStatusStrip.innerHTML = "<span class='tag-pill'>登录后查看报表</span>";
  dom.reportSummaryCards.innerHTML = buildReportPlaceholderCards();
  dom.reportZoneUsage.innerHTML = "<p class='helper-text'>登录后查看分区使用情况。</p>";
  dom.reportTopReaders.innerHTML = "<p class='helper-text'>登录后查看活跃读者排行。</p>";
  dom.reportDailyUsage.innerHTML = "<p class='helper-text'>登录后查看每日趋势。</p>";
  dom.reportViolationStats.innerHTML = "<p class='helper-text'>登录后查看违约统计。</p>";
  dom.reportHourlyHeatmap.innerHTML = "<p class='helper-text'>登录后查看高峰时段热度。</p>";
  dom.statusDistribution.innerHTML = "<p class='helper-text'>登录后查看预约状态分布。</p>";
  dom.creditWarnings.innerHTML = "<p class='helper-text'>登录后查看信用预警读者。</p>";
  dom.recentReservations.innerHTML = "<p class='helper-text'>登录后查看最近预约。</p>";
  dom.recentNotices.innerHTML = "<p class='helper-text'>登录后查看最近公告。</p>";
  dom.noticeList.innerHTML = "<p class='helper-text'>登录后管理公告内容。</p>";
  dom.reservationSummary.innerHTML = "<span class='tag-pill'>登录后加载预约统计</span>";
  dom.reservationTableBody.innerHTML = buildEmptyTableRow("登录后查看预约记录。", 8);
  dom.userTableBody.innerHTML = buildEmptyTableRow("登录后查看账号记录。", 7);
  dom.zoneList.innerHTML = "<p class='helper-text'>登录后管理分区启停状态。</p>";
  dom.seatSummary.innerHTML = "<span class='tag-pill'>登录后加载座位统计</span>";
  dom.seatTableBody.innerHTML = buildEmptyTableRow("登录后查看座位资源。", 8);
  dom.configStatusStrip.innerHTML = "<span class='tag-pill'>登录后加载规则配置</span>";
  dom.configList.innerHTML = "<p class='helper-text'>登录后配置预约规则、签到规则与信用规则。</p>";
  dom.selectedUserCard.className = "selected-card empty-state";
  dom.selectedUserCard.textContent = "请先登录，再选择一个账号进行信用分调整。";
  resetZoneEditor({ activate: false });
  resetSeatEditor({ activate: false });
  setResourceEditorMode("seat", { focus: false });
  resetNoticeEditor();
  renderGuidePanel();
}

function buildPlaceholderCards() {
  return buildSummaryCardMarkup(
    ["总座位数", "读者总数", "当前有效预约", "今日预约", "违约次数", "已发布公告"].map((label) => ({
      label,
      value: "--",
      note: "等待数据接入",
    }))
  );
}

function buildReportPlaceholderCards() {
  return buildSummaryCardMarkup(
    ["预约量", "签到率", "座位使用率", "违约数", "累计预约时长", "平均时长"].map((label) => ({
      label,
      value: "--",
      note: "等待报表加载",
    }))
  );
}

function getSequenceColor(index) {
  return CHART_SEQUENCE[index % CHART_SEQUENCE.length];
}

function getStatusChartColor(status, index = 0) {
  return STATUS_CHART_COLORS[status] || getSequenceColor(index);
}

function getViolationChartColor(type, index = 0) {
  return VIOLATION_CHART_COLORS[type] || getSequenceColor(index);
}

function buildSummaryCardMarkup(cards) {
  return cards
    .map(
      (card) => `
        <article class="summary-card">
          <span class="summary-label">${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
          <p>${escapeHtml(card.note || " ")}
          </p>
        </article>
      `
    )
    .join("");
}

function buildDonutChartMarkup(items, options = {}) {
  const prepared = (items || [])
    .map((item, index) => ({
      label: item.label || "-",
      value: Number(item.value || 0),
      valueLabel: item.valueLabel,
      meta: item.meta || "",
      color: item.color || getSequenceColor(index),
    }))
    .filter((item) => item.value > 0);

  const total = prepared.reduce((sum, item) => sum + item.value, 0);
  if (!prepared.length || total <= 0) {
    return `<p class="helper-text">${escapeHtml(options.emptyMessage || "暂无数据。")}</p>`;
  }

  let currentAngle = 0;
  const gradient = prepared
    .map((item) => {
      const start = currentAngle;
      currentAngle += (item.value / total) * 360;
      return `${item.color} ${start.toFixed(1)}deg ${currentAngle.toFixed(1)}deg`;
    })
    .join(", ");

  return `
    <div class="donut-layout">
      <div class="donut-stage">
        <div class="donut-chart" style="--donut-gradient: conic-gradient(${gradient});">
          <div class="donut-hole">
            <strong>${escapeHtml(String(options.centerValue ?? total))}</strong>
            <span>${escapeHtml(options.centerLabel || "总量")}</span>
          </div>
        </div>
        ${options.note ? `<p class="chart-note">${escapeHtml(options.note)}</p>` : ""}
      </div>

      <div class="legend-list">
        ${prepared
          .map(
            (item) => `
              <div class="legend-row">
                <div class="legend-copy">
                  <span class="legend-label">
                    <i class="legend-swatch" style="--swatch:${item.color}"></i>
                    ${escapeHtml(item.label)}
                  </span>
                  ${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ""}
                </div>
                <div class="legend-value">
                  <strong>${escapeHtml(String(item.valueLabel || item.value))}</strong>
                  <span>${escapeHtml(formatPercentValue((item.value / total) * 100))}</span>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildColumnChartMarkup(items, options = {}) {
  const prepared = (items || [])
    .map((item, index) => ({
      label: item.label || "-",
      subLabel: item.subLabel || "",
      valueLabel: item.valueLabel ?? item.value ?? 0,
      value: Number(item.value || 0),
      color: item.color || getSequenceColor(index),
    }))
    .filter((item) => item.value >= 0);

  if (!prepared.length) {
    return `<p class="helper-text">${escapeHtml(options.emptyMessage || "暂无数据。")}</p>`;
  }

  const maxValue = Math.max(...prepared.map((item) => item.value), 1);
  return `
    <div class="bar-chart">
      ${prepared
        .map((item) => {
          const height = item.value > 0 ? Math.max((item.value / maxValue) * 100, 10) : 6;
          return `
            <article class="bar-column">
              <span class="bar-value">${escapeHtml(String(item.valueLabel))}</span>
              <div class="bar-track">
                <div class="bar-fill" style="height:${height.toFixed(1)}%; --bar-color:${item.color};"></div>
              </div>
              <strong class="bar-label">${escapeHtml(item.label)}</strong>
              <span class="bar-sub">${escapeHtml(item.subLabel)}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildStatusDistributionMarkup(dashboard) {
  const distribution = dashboard.statusDistribution || [];
  if (!distribution.length) {
    return "<p class='helper-text'>暂无预约状态数据。</p>";
  }

  const total = distribution.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const leadingItem = [...distribution].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
  const activeCount = distribution
    .filter((item) => ["reserved", "checked_in", "temporary_leave"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);

  return `
    <div class="chart-surface">
      <div class="chart-headline">
        <div>
          <span class="section-kicker">Reservation Flow</span>
          <h4>${escapeHtml(formatStatus(leadingItem?.status))} 当前占比最高</h4>
          <p>状态总数 ${escapeHtml(String(total))} 条，进行中预约 ${escapeHtml(String(activeCount))} 条。</p>
        </div>
        <div class="metric-pills">
          <article class="metric-pill">
            <span>进行中预约</span>
            <strong>${escapeHtml(String(activeCount))}</strong>
          </article>
          <article class="metric-pill">
            <span>今日预约</span>
            <strong>${escapeHtml(String(dashboard.summary.todayReservations || 0))}</strong>
          </article>
          <article class="metric-pill">
            <span>今日使用率</span>
            <strong>${escapeHtml(`${dashboard.summary.todaySeatUsageRate || 0}%`)}</strong>
          </article>
        </div>
      </div>
      ${buildDonutChartMarkup(
        distribution.map((item, index) => ({
          label: formatStatus(item.status),
          value: Number(item.count || 0),
          meta: item.status === leadingItem?.status ? "当前最高占比" : "",
          color: getStatusChartColor(item.status, index),
        })),
        {
          centerValue: total,
          centerLabel: "状态总数",
          note: "实时预约状态分布",
        }
      )}
    </div>
  `;
}

function buildZoneUsageMarkup(zoneUsage) {
  const items = [...(zoneUsage || [])].sort((a, b) => Number(b.reservedMinutes || 0) - Number(a.reservedMinutes || 0));
  if (!items.length) {
    return "<p class='helper-text'>当前时间范围内暂无分区使用数据。</p>";
  }

  const peakZone = items[0];
  const averageCheckin =
    items.reduce((sum, item) => sum + Number(item.checkinRate || 0), 0) / Math.max(items.length, 1);

  return `
    <div class="chart-surface">
      <div class="chart-headline">
        <div>
          <span class="section-kicker">Zone Load</span>
          <h4>${escapeHtml(peakZone.displayName)} 当前最繁忙</h4>
          <p>对比各分区预约时长、预约次数、签到率与违约率，方便快速定位高负载区域。</p>
        </div>
        <div class="metric-pills">
          <article class="metric-pill">
            <span>最忙分区</span>
            <strong>${escapeHtml(peakZone.zoneCode || "-")}</strong>
          </article>
          <article class="metric-pill">
            <span>平均签到率</span>
            <strong>${escapeHtml(formatPercentValue(averageCheckin))}</strong>
          </article>
          <article class="metric-pill">
            <span>分区数量</span>
            <strong>${escapeHtml(String(items.length))}</strong>
          </article>
        </div>
      </div>

      ${buildColumnChartMarkup(
        items.slice(0, 6).map((item, index) => ({
          label: item.zoneCode || "-",
          subLabel: formatPercentValue(item.seatUsageRate),
          valueLabel: formatHours(item.reservedHours),
          value: Number(item.reservedMinutes || 0),
          color: getSequenceColor(index),
        }))
      )}

      <div class="detail-list">
        ${items
          .map(
            (item, index) => `
              <article class="detail-row">
                <div class="detail-copy">
                  <strong>${escapeHtml(item.displayName)} <span class="mono">(${escapeHtml(item.zoneCode)})</span></strong>
                  <small>${escapeHtml(String(item.availableSeatCount || 0))} 个可用座位 · ${escapeHtml(
                    formatHours(item.reservedHours)
                  )} 已预约</small>
                </div>
                <div class="detail-metrics">
                  <span>${escapeHtml(String(item.reservationCount || 0))} 次预约</span>
                  <span>签到率 ${escapeHtml(formatPercentValue(item.checkinRate))}</span>
                  <span>违约率 ${escapeHtml(formatPercentValue(item.violationRate))}</span>
                  <span class="status-pill" data-tone="${item.isEnabled ? "completed" : "danger"}">${
                    item.isEnabled ? "已启用" : "已停用"
                  }</span>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildTopReadersMarkup(topReaders) {
  const items = topReaders || [];
  if (!items.length) {
    return "<p class='helper-text'>当前时间范围内暂无活跃读者数据。</p>";
  }

  const maxReservations = Math.max(...items.map((item) => Number(item.reservationCount || 0)), 1);
  return items
    .map(
      (item, index) => `
        <article class="reader-row">
          <div class="reader-row-main">
            <span class="rank-badge">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
            <div class="reader-copy">
              <strong>${escapeHtml(item.realName)} <span class="mono">(${escapeHtml(item.studentNo)})</span></strong>
              <p>${escapeHtml(formatHours(item.reservedHours))} 已预约 · 已签到 ${escapeHtml(
                String(item.checkedInCount || 0)
              )} 次</p>
            </div>
            <span class="tag-pill">${escapeHtml(String(item.reservationCount || 0))} 次预约</span>
          </div>
          <div class="progress-track progress-track--soft">
            <div class="progress-fill" style="width:${((Number(item.reservationCount || 0) / maxReservations) * 100).toFixed(1)}%"></div>
          </div>
          <div class="report-metrics">
            <span>签到率 ${escapeHtml(formatPercentValue(item.checkinRate))}</span>
            <span>违约 ${escapeHtml(String(item.violationCount || 0))}</span>
            <span>违约率 ${escapeHtml(formatPercentValue(item.violationRate))}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function buildDailyUsageMarkup(dailyUsage) {
  const items = dailyUsage || [];
  if (!items.length) {
    return "<p class='helper-text'>当前时间范围内暂无每日趋势数据。</p>";
  }

  const peakDay = [...items].sort((a, b) => Number(b.reservationCount || 0) - Number(a.reservationCount || 0))[0];
  const averageUsage =
    items.reduce((sum, item) => sum + Number(item.seatUsageRate || 0), 0) / Math.max(items.length, 1);
  const averageCheckin =
    items.reduce((sum, item) => sum + Number(item.checkinRate || 0), 0) / Math.max(items.length, 1);

  return `
    <div class="chart-surface">
      <div class="chart-headline">
        <div>
          <span class="section-kicker">Daily Trend</span>
          <h4>${escapeHtml(peakDay.reservationDate)} 是当前峰值日</h4>
          <p>通过每日预约量与使用率柱状图，快速识别高峰日和低谷日。</p>
        </div>
        <div class="metric-pills">
          <article class="metric-pill">
            <span>峰值预约</span>
            <strong>${escapeHtml(String(peakDay.reservationCount || 0))}</strong>
          </article>
          <article class="metric-pill">
            <span>平均使用率</span>
            <strong>${escapeHtml(formatPercentValue(averageUsage))}</strong>
          </article>
          <article class="metric-pill">
            <span>平均签到率</span>
            <strong>${escapeHtml(formatPercentValue(averageCheckin))}</strong>
          </article>
        </div>
      </div>

      ${buildColumnChartMarkup(
        items.map((item, index) => ({
          label: formatDateInput(item.reservationDate).slice(5),
          subLabel: formatPercentValue(item.seatUsageRate),
          valueLabel: `${Number(item.reservationCount || 0)} 次`,
          value: Number(item.reservationCount || 0),
          color: getSequenceColor(index),
        }))
      )}
    </div>
  `;
}

function buildViolationMarkup(violationStats) {
  const items = violationStats || [];
  const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (!items.length || total <= 0) {
    return "<p class='helper-text'>当前时间范围内暂无违约记录。</p>";
  }

  return `
    <div class="chart-surface">
      <div class="chart-headline">
        <div>
          <span class="section-kicker">Violation</span>
          <h4>违约构成一眼可见</h4>
          <p>识别异常主要来源，便于优化规则阈值和管理员巡检策略。</p>
        </div>
      </div>
      ${buildDonutChartMarkup(
        items.map((item, index) => ({
          label: formatViolationType(item.violationType),
          value: Number(item.count || 0),
          color: getViolationChartColor(item.violationType, index),
        })),
        {
          centerValue: total,
          centerLabel: "违约总数",
          note: "统计窗口内异常预约占比",
        }
      )}
    </div>
  `;
}

function buildHourlyHeatmapMarkup(hourlyUsage) {
  const items = hourlyUsage || [];
  if (!items.length) {
    return "<p class='helper-text'>当前时间范围内暂无高峰热度数据。</p>";
  }

  const peakHour = [...items].sort((a, b) => Number(b.reservationCount || 0) - Number(a.reservationCount || 0))[0];
  const heatMax = Math.max(...items.map((item) => Number(item.reservationCount || 0)), 1);

  return `
    <div class="chart-surface">
      <div class="chart-headline">
        <div>
          <span class="section-kicker">Peak Hours</span>
          <h4>${escapeHtml(peakHour.label)} 是最繁忙时段</h4>
          <p>全天预约热度和签到率分布，帮助管理员更直观地识别高峰窗口。</p>
        </div>
        <div class="metric-pills">
          <article class="metric-pill">
            <span>峰值预约</span>
            <strong>${escapeHtml(String(peakHour.reservationCount || 0))}</strong>
          </article>
          <article class="metric-pill">
            <span>峰值签到率</span>
            <strong>${escapeHtml(formatPercentValue(peakHour.checkinRate))}</strong>
          </article>
        </div>
      </div>

      <div class="heatmap-grid heatmap-grid--embedded">
        ${items
          .map(
            (item) => `
              <article class="heat-cell" data-level="${escapeHtml(String(getHeatLevel(item.reservationCount, heatMax)))}">
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(String(item.reservationCount || 0))} 次预约</span>
                <small>签到率 ${escapeHtml(formatPercentValue(item.checkinRate))}</small>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function initializeViewState() {
  const availableIds = new Set(dom.viewPanels.map((panel) => panel.id));
  const initialView = availableIds.has(state.activeView)
    ? state.activeView
    : dom.navLinks[0]?.dataset.navTarget || "dashboardSection";

  setActiveView(initialView, { preserveScroll: true });
}

function setActiveView(viewId, options = {}) {
  const availableIds = new Set(dom.viewPanels.map((panel) => panel.id));
  const nextView = availableIds.has(viewId) ? viewId : "dashboardSection";
  state.activeView = nextView;
  setAccountMenuOpen(false);

  dom.viewPanels.forEach((panel) => {
    const isActive = panel.id === nextView;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("is-active", isActive);

    if (isActive && !options.preserveScroll) {
      const scrollTarget = panel.querySelector(".view-scroll") || panel;
      if (typeof scrollTarget.scrollTo === "function") {
        scrollTarget.scrollTo({ top: 0, behavior: "auto" });
      } else {
        scrollTarget.scrollTop = 0;
      }
    }
  });

  dom.navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.navTarget === nextView);
  });

  renderGuidePanel();
}

function setResourceEditorMode(mode, options = {}) {
  const nextMode = mode === "zone" ? "zone" : "seat";
  const shouldFocus = options.focus === true;
  const shouldReveal = options.reveal === true || shouldFocus;
  const shouldResetScroll = options.resetScroll === true;
  state.resourceEditorMode = nextMode;

  dom.resourceEditorTabs.forEach((tab) => {
    const isActive = tab.dataset.editorMode === nextMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  dom.seatEditorPanel?.classList.toggle("hidden", nextMode !== "seat");
  dom.seatEditorPanel?.classList.toggle("is-active", nextMode === "seat");
  dom.zoneEditorPanel?.classList.toggle("hidden", nextMode !== "zone");
  dom.zoneEditorPanel?.classList.toggle("is-active", nextMode === "zone");

  if (shouldResetScroll) {
    const scrollTarget = dom.seatEditorPanel?.closest(".view-scroll");
    if (scrollTarget && typeof scrollTarget.scrollTo === "function") {
      scrollTarget.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  const targetField = nextMode === "seat" ? dom.seatCodeInput : dom.zoneCodeInput;
  const targetCard = targetField?.closest(".resource-form-card");

  if (shouldReveal && targetCard && typeof targetCard.scrollIntoView === "function") {
    targetCard.scrollIntoView({ block: "start", behavior: "auto" });
  }

  if (!shouldFocus) {
    return;
  }

  targetField?.focus();
}

async function loadHealth(options = {}) {
  try {
    const response = await fetch(`${state.apiBase}/api/health`, {
      headers: {
        Accept: "application/json",
      },
    });

    const rawText = await response.text();
    const payload = rawText ? safeParseJson(rawText) : null;

    if (!response.ok || !payload || typeof payload !== "object") {
      throw new Error(`健康检测失败：${response.status}`);
    }

    state.health = {
      ...payload,
      access: payload.access || {},
    };
  } catch (error) {
    state.health = {
      ok: false,
      message: error.message || "后端不可达",
      serverTime: null,
      access: {
        apiBaseUrl: state.apiBase,
        adminUrl: resolveAdminEntryUrl(state.apiBase),
        mode: isLocalAccess(state.apiBase) ? "local" : "domain",
      },
      database: {
        ok: false,
        error: error.message || "后端不可达",
        dbName: null,
      },
    };
  }

  syncAccessUi();
  renderHealthState();

  if (!options.quiet && state.health && !state.health.ok) {
    showStatus("当前后端地址未通过健康检测，请检查服务与域名配置。", "error");
  }

  return state.health;
}

function renderHealthState() {
  if (!dom.healthBadge || !dom.healthMeta) {
    return;
  }

  const accessInfo = resolveAccessInfo();

  if (!state.health) {
    dom.healthBadge.dataset.state = "pending";
    dom.healthBadge.textContent = "待检测";
    dom.healthMeta.innerHTML = `
      接口：<span class="mono">${escapeHtml(accessInfo.apiBaseUrl)}</span>
    `;
    return;
  }

  if (!state.health.ok) {
    dom.healthBadge.dataset.state = "error";
    dom.healthBadge.textContent = "连接失败";
    dom.healthMeta.innerHTML = `
      接口：<span class="mono">${escapeHtml(accessInfo.apiBaseUrl)}</span><br />
      ${escapeHtml(state.health.message || "后端不可达，请检查服务是否启动。")}
    `;
    return;
  }

  const database = state.health.database || {};
  const databaseOk = Boolean(database.ok);
  const databaseMessage = databaseOk
    ? `数据库 ${database.dbName || "-"} 已连接`
    : `数据库未连接${database.error ? ` · ${truncate(database.error, 42)}` : ""}`;

  dom.healthBadge.dataset.state = databaseOk ? "healthy" : "degraded";
  dom.healthBadge.textContent = databaseOk ? "服务在线" : "接口在线";
  dom.healthMeta.innerHTML = `
    接口：<span class="mono">${escapeHtml(accessInfo.apiBaseUrl)}</span><br />
    ${escapeHtml(databaseMessage)} · ${escapeHtml(formatDateTime(state.health.serverTime) || "-")}
  `;
}

function renderSyncMeta() {
  if (!dom.lastSyncTime) {
    return;
  }

  if (!state.lastSyncedAt) {
    dom.lastSyncTime.dataset.state = "idle";
    dom.lastSyncTime.textContent = "尚未同步";
    return;
  }

  dom.lastSyncTime.dataset.state = "ready";
  dom.lastSyncTime.textContent = `上次同步 ${formatDateTime(state.lastSyncedAt).slice(5, 16)}`;
}

async function refreshAllData(options = {}) {
  ensureSession();

  if (!options.quiet) {
    showStatus("正在同步后台数据，请稍候...");
  }

  await Promise.all([
    loadDashboard(),
    loadReports(),
    loadNotices(),
    loadReservations(),
    loadUsers(),
    loadZones(),
    loadSeats(),
    loadConfigs(),
    loadHealth({ quiet: true }),
  ]);
  state.lastSyncedAt = new Date().toISOString();
  renderAll();
  renderSyncMeta();

  if (!options.quiet) {
    showStatus("后台数据已刷新。", "success");
  }
}

async function loadDashboard() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
  });
  state.dashboard = await request(`/api/admin/dashboard?${params.toString()}`);
}

async function loadReports() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
    startDate: state.reportFilters.startDate,
    endDate: state.reportFilters.endDate,
  });

  state.reports = await request(`/api/admin/reports?${params.toString()}`);
}

async function loadNotices() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
    limit: "40",
  });

  if (state.noticeFilters.keyword) {
    params.set("keyword", state.noticeFilters.keyword);
  }
  if (state.noticeFilters.status) {
    params.set("status", state.noticeFilters.status);
  }
  if (state.noticeFilters.audience) {
    params.set("audience", state.noticeFilters.audience);
  }

  const result = await request(`/api/admin/notices?${params.toString()}`);
  state.notices = result.items || [];
}

async function loadReservations() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
    limit: "100",
  });

  if (state.reservationFilters.keyword) {
    params.set("keyword", state.reservationFilters.keyword);
  }
  if (state.reservationFilters.status) {
    params.set("status", state.reservationFilters.status);
  }
  if (state.reservationFilters.reservationDate) {
    params.set("reservationDate", state.reservationFilters.reservationDate);
  }

  const result = await request(`/api/admin/reservations?${params.toString()}`);
  state.reservations = result.items || [];
  state.reservationSummary = result.summary || [];
}

async function loadUsers() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
    limit: "100",
  });

  if (state.userFilters.keyword) {
    params.set("keyword", state.userFilters.keyword);
  }
  if (state.userFilters.blacklistOnly) {
    params.set("blacklistOnly", "true");
  }

  const result = await request(`/api/admin/users?${params.toString()}`);
  state.users = result.items || [];
}

async function loadZones() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
  });
  const result = await request(`/api/admin/zones?${params.toString()}`);
  state.zones = result.items || [];
}

async function loadSeats() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
    limit: "120",
  });

  if (state.seatFilters.keyword) {
    params.set("keyword", state.seatFilters.keyword);
  }
  if (state.seatFilters.zoneCode) {
    params.set("zoneCode", state.seatFilters.zoneCode);
  }
  if (state.seatFilters.seatStatus) {
    params.set("seatStatus", state.seatFilters.seatStatus);
  }

  const result = await request(`/api/admin/seats?${params.toString()}`);
  state.seats = result.items || [];
  state.seatSummary = result.summary || [];
}

async function loadConfigs() {
  const params = new URLSearchParams({
    studentNo: state.session.studentNo,
  });

  const result = await request(`/api/admin/configs?${params.toString()}`);
  state.configGroups = result.groups || {};
  state.configItems = result.items || [];
}

function renderAll() {
  renderDashboard();
  renderReports();
  renderNotices();
  renderReservations();
  renderUsers();
  renderSelectedUser();
  renderResources();
  renderConfigs();
  renderGuidePanel();
}

function renderReports() {
  const reports = state.reports;
  if (!reports) {
    dom.reportStatusStrip.innerHTML = "<span class='tag-pill'>暂无报表数据</span>";
    dom.reportSummaryCards.innerHTML = buildReportPlaceholderCards();
    dom.reportZoneUsage.innerHTML = "<p class='helper-text'>暂无分区使用数据。</p>";
    dom.reportTopReaders.innerHTML = "<p class='helper-text'>暂无读者活跃数据。</p>";
    dom.reportDailyUsage.innerHTML = "<p class='helper-text'>暂无每日趋势数据。</p>";
    dom.reportViolationStats.innerHTML = "<p class='helper-text'>暂无违约统计数据。</p>";
    dom.reportHourlyHeatmap.innerHTML = "<p class='helper-text'>暂无高峰热度数据。</p>";
    return;
  }

  const overview = reports.overview || {};
  const meta = reports.meta || {};
  const reportCards = [
    { value: overview.totalReservations || 0, label: "预约量", note: "统计窗口内累计预约次数" },
    { value: formatPercentValue(overview.checkinRate), label: "签到率", note: "预约后实际签到完成情况" },
    { value: formatPercentValue(overview.seatUsageRate), label: "座位使用率", note: "按可运营座位计算负载" },
    { value: overview.violationReservations || 0, label: "违约数", note: "包含未签到与暂离超时等异常" },
    { value: formatHours(overview.totalReservedHours), label: "累计预约时长", note: "所有分区预约时长汇总" },
    { value: `${Math.round(Number(overview.avgDurationMinutes || 0))} 分钟`, label: "平均预约时长", note: "单次预约平均持续时长" },
  ];

  dom.reportStatusStrip.innerHTML = [
    `<span class="tag-pill">${escapeHtml(meta.startDate || "-")} 至 ${escapeHtml(meta.endDate || "-")}</span>`,
    `<span class="tag-pill">${escapeHtml(String(meta.daySpan || 0))} 天</span>`,
    `<span class="tag-pill">${escapeHtml(String(meta.operationalSeatCount || 0))} 个可运营座位</span>`,
    `<span class="tag-pill">${escapeHtml(meta.openTime || "--:--")} - ${escapeHtml(meta.closeTime || "--:--")}</span>`,
  ].join("");

  dom.reportSummaryCards.innerHTML = buildSummaryCardMarkup(reportCards);
  dom.reportZoneUsage.innerHTML = buildZoneUsageMarkup(reports.zoneUsage || []);
  dom.reportTopReaders.innerHTML = buildTopReadersMarkup(reports.topReaders || []);
  dom.reportDailyUsage.innerHTML = buildDailyUsageMarkup(reports.dailyUsage || []);
  dom.reportViolationStats.innerHTML = buildViolationMarkup(reports.violationStats || []);
  dom.reportHourlyHeatmap.innerHTML = buildHourlyHeatmapMarkup(reports.hourlyUsage || []);
}

function renderDashboard() {
  const dashboard = state.dashboard;
  if (!dashboard) {
    dom.summaryCards.innerHTML = buildPlaceholderCards();
    dom.statusDistribution.innerHTML = "<p class='helper-text'>暂无预约状态数据。</p>";
    dom.creditWarnings.innerHTML = "<p class='helper-text'>暂无信用预警数据。</p>";
    dom.recentReservations.innerHTML = "<p class='helper-text'>暂无最新预约记录。</p>";
    dom.recentNotices.innerHTML = "<p class='helper-text'>暂无公告记录。</p>";
    return;
  }

  const cards = [
    { value: dashboard.summary.totalSeats, label: "总座位数", note: "座位资源" },
    { value: dashboard.summary.totalReaders, label: "读者总数", note: "注册读者" },
    { value: dashboard.summary.activeReservations, label: "当前有效预约", note: "待签到 / 已签到 / 暂离" },
    { value: dashboard.summary.todayReservations, label: "今日预约", note: "24 小时内" },
    { value: `${dashboard.summary.todaySeatUsageRate}%`, label: "今日座位使用率", note: "实时负载" },
    { value: dashboard.summary.publishedNotices, label: "已发布公告", note: "前台可见" },
  ];

  dom.summaryCards.innerHTML = buildSummaryCardMarkup(cards);
  dom.statusDistribution.innerHTML = buildStatusDistributionMarkup(dashboard);

  dom.creditWarnings.innerHTML = dashboard.creditWarnings.length
    ? dashboard.creditWarnings
        .map(
          (user) => `
            <div class="warning-row">
              <div class="mini-head">
                <strong>${escapeHtml(user.realName)} <span class="mono">(${escapeHtml(user.studentNo)})</span></strong>
                <span class="score-pill" data-tone="${scoreTone(user.creditScore)}">${escapeHtml(String(user.creditScore))} 分</span>
              </div>
              <p>
                违约 ${escapeHtml(String(user.violationCount))} 次，
                ${user.isBlacklisted ? `黑名单截止 ${escapeHtml(formatDateTime(user.blacklistUntil) || "待定")}` : "当前未进入黑名单"}。
              </p>
              <div class="button-row">
                <button class="action-btn" type="button" data-action="select-user" data-student-no="${escapeHtml(user.studentNo)}">处理该读者</button>
              </div>
            </div>
          `
        )
        .join("")
    : "<p class='helper-text'>当前没有信用预警读者。</p>";

  dom.recentReservations.innerHTML = dashboard.recentReservations.length
    ? dashboard.recentReservations
        .map(
          (item) => `
            <div class="mini-item mini-item--surface">
              <div class="mini-head">
                <strong class="mono">${escapeHtml(item.reservationNo)}</strong>
                <span class="status-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(formatStatus(item.status))}</span>
              </div>
              <p>${escapeHtml(item.realName)} · ${escapeHtml(item.studentNo)} · ${escapeHtml(item.seatId)} · ${escapeHtml(item.zoneCode)}</p>
              <p>${escapeHtml(item.reservationDate)} ${escapeHtml(item.startTime)}-${escapeHtml(item.endTime)}</p>
            </div>
          `
        )
        .join("")
    : "<p class='helper-text'>最近暂无预约记录。</p>";

  dom.recentNotices.innerHTML = dashboard.recentNotices.length
    ? dashboard.recentNotices
        .map(
          (notice) => `
            <div class="mini-item mini-item--surface">
              <div class="mini-head">
                <strong>${escapeHtml(notice.title)}</strong>
                <span class="status-pill" data-tone="${escapeHtml(notice.status)}">${escapeHtml(formatStatus(notice.status))}</span>
              </div>
              <p>${escapeHtml(NOTICE_TYPE_LABELS[notice.noticeType] || notice.noticeType)} · ${escapeHtml(AUDIENCE_LABELS[notice.audience] || notice.audience)}</p>
              <p>${escapeHtml(truncate(notice.content, 70))}</p>
            </div>
          `
        )
        .join("")
    : "<p class='helper-text'>暂无公告记录。</p>";
}

function renderGuidePanel() {
  if (!dom.viewHeading || !dom.guidePanel) {
    return;
  }

  const meta = VIEW_META[state.activeView] || VIEW_META.dashboardSection;
  const accessInfo = resolveAccessInfo();
  const reportsMeta = state.reports?.meta || {};
  const publishedNoticeCount = state.notices.filter((item) => item.status === "published").length;
  const enabledZoneCount = state.zones.filter((item) => item.isEnabled).length;

  if (!state.session || !state.dashboard) {
    dom.viewHeading.textContent = "管理员登录";
    dom.guidePanel.innerHTML = `
      连接后端并使用管理员账号进入管理台。
    `;
    return;
  }

  dom.viewHeading.textContent = meta.title;

  let detailLine = "";

  switch (state.activeView) {
    case "reportSection":
      detailLine = `
        当前报表范围 <strong>${escapeHtml(state.reportFilters.startDate || reportsMeta.startDate || "-")}</strong>
        至 <strong>${escapeHtml(state.reportFilters.endDate || reportsMeta.endDate || "-")}</strong>，
        可运营座位 <strong>${escapeHtml(String(reportsMeta.operationalSeatCount || 0))}</strong> 个。
      `;
      break;
    case "noticeSection":
      detailLine = `
        当前公告 <strong>${escapeHtml(String(state.notices.length))}</strong> 条，
        已发布 <strong>${escapeHtml(String(publishedNoticeCount))}</strong> 条。
      `;
      break;
    case "reservationSection":
      detailLine = `
        当前筛选结果 <strong>${escapeHtml(String(state.reservations.length))}</strong> 条，
        表格支持代签退与释放预约。
      `;
      break;
    case "userSection":
      detailLine = `
        当前账号 <strong>${escapeHtml(String(state.users.length))}</strong> 个，
        信用预警 <strong>${escapeHtml(String(state.dashboard.creditWarnings.length))}</strong> 人。
      `;
      break;
    case "resourceSection":
      detailLine = `
        当前分区 <strong>${escapeHtml(String(state.zones.length))}</strong> 个，
        已启用 <strong>${escapeHtml(String(enabledZoneCount))}</strong> 个，
        座位 <strong>${escapeHtml(String(state.seats.length))}</strong> 个。
      `;
      break;
    case "configSection":
      detailLine = `
        当前规则 <strong>${escapeHtml(String(state.configItems.length))}</strong> 项，
        修改后可统一保存生效。
      `;
      break;
    case "dashboardSection":
    default:
      detailLine = `
        今日预约 <strong>${escapeHtml(String(state.dashboard.summary.todayReservations || 0))}</strong> 条，
        当前有效预约 <strong>${escapeHtml(String(state.dashboard.summary.activeReservations || 0))}</strong> 条，
        信用预警 <strong>${escapeHtml(String(state.dashboard.creditWarnings.length))}</strong> 人。
      `;
      break;
  }

  dom.guidePanel.innerHTML = `
    ${meta.description}<br />
    ${detailLine}
  `;
}

function renderNotices() {
  dom.noticeList.innerHTML = state.notices.length
    ? state.notices
        .map(
          (notice) => `
            <article class="notice-item">
              <div class="notice-head">
                <div>
                  <strong>${escapeHtml(notice.title)}</strong>
                  <p>${escapeHtml(NOTICE_TYPE_LABELS[notice.noticeType] || notice.noticeType)} · ${escapeHtml(AUDIENCE_LABELS[notice.audience] || notice.audience)} · ${escapeHtml(formatStatus(notice.status))}</p>
                </div>
                <span class="status-pill" data-tone="${escapeHtml(notice.status)}">${escapeHtml(formatStatus(notice.status))}</span>
              </div>

              <p>${escapeHtml(truncate(notice.content, 140))}</p>
              <p>
                发布时间：${escapeHtml(formatDateTime(notice.publishAt) || "未设置")}
                · 更新时间：${escapeHtml(formatDateTime(notice.updatedAt) || "-")}
              </p>

              <div class="notice-actions">
                <button class="action-btn" type="button" data-action="edit-notice" data-notice-id="${escapeHtml(String(notice.id))}">编辑</button>
                ${buildNoticeStatusButtons(notice)}
              </div>
            </article>
          `
        )
        .join("")
    : "<p class='helper-text'>当前筛选条件下没有公告记录。</p>";
}

function buildReservationActionButtons(item) {
  const actions = [];

  if (item.canAdminCheckout) {
    actions.push(`
      <button
        class="action-btn"
        type="button"
        data-action="manual-checkout-reservation"
        data-reservation-no="${escapeHtml(item.reservationNo)}"
      >
        代为签退
      </button>
    `);
  }

  if (item.canAdminRelease) {
    actions.push(`
      <button
        class="action-btn"
        type="button"
        data-action="release-reservation"
        data-reservation-no="${escapeHtml(item.reservationNo)}"
      >
        释放预约
      </button>
    `);
  }

  if (!actions.length) {
    return "<span class='table-sub'>无可执行操作</span>";
  }

  return `<div class="button-row">${actions.join("")}</div>`;
}

function renderReservations() {
  dom.reservationSummary.innerHTML = state.reservationSummary.length
    ? state.reservationSummary
        .map(
          (item) => `
            <span class="tag-pill">
              ${escapeHtml(formatStatus(item.status))}：${escapeHtml(String(item.count))}
            </span>
          `
        )
        .join("")
    : "<span class='tag-pill'>暂无匹配统计</span>";

  dom.reservationTableBody.innerHTML = state.reservations.length
    ? state.reservations
        .map(
          (item) => `
            <tr>
              <td>
                <span class="table-main mono">${escapeHtml(item.reservationNo)}</span>
                <span class="table-sub">创建于 ${escapeHtml(formatDateTime(item.createdAt) || "-")}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(item.realName)}</span>
                <span class="table-sub mono">${escapeHtml(item.studentNo)}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(item.seatId)}</span>
                <span class="table-sub">${escapeHtml(item.zoneCode)}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(item.reservationDate)}</span>
                <span class="table-sub">${escapeHtml(item.startTime)}-${escapeHtml(item.endTime)}</span>
              </td>
              <td><span class="status-pill" data-tone="${escapeHtml(item.status)}">${escapeHtml(formatStatus(item.status))}</span></td>
              <td><span class="table-sub">${escapeHtml(formatViolationType(item.violationType || ""))}</span></td>
              <td><span class="table-sub">${escapeHtml(formatDateTime(item.createdAt) || "-")}</span></td>
              <td>${buildReservationActionButtons(item)}</td>
            </tr>
          `
        )
        .join("")
    : buildEmptyTableRow("当前筛选条件下没有预约记录。", 8);
}

function renderUsers() {
  dom.userTableBody.innerHTML = state.users.length
    ? state.users
        .map(
          (user) => `
            <tr
              class="${state.selectedUserNo === user.studentNo ? "is-selected" : ""}"
              data-action="select-user"
              data-student-no="${escapeHtml(user.studentNo)}"
            >
              <td>
                <button
                  class="row-select-btn ${state.selectedUserNo === user.studentNo ? "is-selected" : ""}"
                  type="button"
                  data-action="select-user"
                  data-student-no="${escapeHtml(user.studentNo)}"
                  aria-label="选择 ${escapeHtml(user.realName)}"
                >
                  ${state.selectedUserNo === user.studentNo ? "✓" : ""}
                </button>
              </td>
              <td>
                <span class="table-main mono">${escapeHtml(user.studentNo)}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(user.realName)}</span>
              </td>
              <td><span class="tag-pill">${escapeHtml(formatRole(user.role))}</span></td>
              <td><span class="score-pill" data-tone="${scoreTone(user.creditScore)}">${escapeHtml(String(user.creditScore))}</span></td>
              <td><span class="table-sub">${escapeHtml(String(user.violationCount))} 次</span></td>
              <td>${user.isBlacklisted ? `<span class="status-pill" data-tone="danger">截至 ${escapeHtml(formatDateTime(user.blacklistUntil) || "-")}</span>` : "<span class='status-pill' data-tone='completed'>正常</span>"}</td>
            </tr>
          `
        )
        .join("")
    : buildEmptyTableRow("当前筛选条件下没有账号记录。", 7);
}

function renderSelectedUser() {
  const user = getSelectedUser();
  if (!user) {
    dom.selectedUserCard.className = "selected-card empty-state";
    dom.selectedUserCard.textContent = "请先选择一个账号，再填写调整分值和原因。";
    return;
  }

  dom.selectedUserCard.className = "selected-card";
  dom.selectedUserCard.innerHTML = `
    <div class="notice-head">
      <div>
        <strong>${escapeHtml(user.realName)}</strong>
        <p class="mono">${escapeHtml(user.studentNo)} · ${escapeHtml(formatRole(user.role))}</p>
      </div>
      <span class="score-pill" data-tone="${scoreTone(user.creditScore)}">${escapeHtml(String(user.creditScore))} 分</span>
    </div>
    <p>
      累计违约 ${escapeHtml(String(user.violationCount))} 次，
      总预约 ${escapeHtml(String(user.totalReservations || 0))} 次，
      正常完成 ${escapeHtml(String(user.completedReservations || 0))} 次。
    </p>
    <p>
      ${user.isBlacklisted ? `黑名单截止：${escapeHtml(formatDateTime(user.blacklistUntil) || "-")}` : "当前未进入黑名单"}。
    </p>
  `;
}

function renderResources() {
  renderZoneOptions();

  const zoneMetaMap = new Map((state.zones || []).map((zone) => [zone.zoneCode, zone]));

  dom.zoneList.innerHTML = state.zones.length
    ? state.zones
        .map(
          (zone) => `
            <article class="notice-item">
              <div class="notice-head">
                <div>
                  <strong>${escapeHtml(zone.displayName)}</strong>
                  <p>${escapeHtml(zone.zoneCode)} · ${escapeHtml(String(zone.floorNo))} 层 · ${escapeHtml(String(zone.seatCount))} 个座位</p>
                </div>
                <span class="status-pill" data-tone="${zone.isEnabled ? "completed" : "danger"}">${zone.isEnabled ? "已启用" : "已停用"}</span>
              </div>
              <p>桌组数 ${escapeHtml(String(zone.tableGroupCount))} · 标注状态 ${escapeHtml(zone.annotationStatus)} · 更新时间 ${escapeHtml(formatDateTime(zone.updatedAt) || "-")}</p>
              <div class="notice-actions">
                <button
                  class="action-btn"
                  type="button"
                  data-action="edit-zone"
                  data-zone-code="${escapeHtml(zone.zoneCode)}"
                >
                  编辑
                </button>
                <button
                  class="action-btn"
                  type="button"
                  data-action="toggle-zone"
                  data-zone-code="${escapeHtml(zone.zoneCode)}"
                  data-next-enabled="${zone.isEnabled ? "false" : "true"}"
                >
                  ${zone.isEnabled ? "停用分区" : "启用分区"}
                </button>
                <button
                  class="action-btn"
                  type="button"
                  data-action="delete-zone"
                  data-zone-code="${escapeHtml(zone.zoneCode)}"
                  data-danger="true"
                >
                  删除
                </button>
              </div>
            </article>
          `
        )
        .join("")
    : "<p class='helper-text'>暂无分区数据。</p>";

  if (state.seatSummary.length) {
    const totalCount = state.seatSummary.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const summaryTabs = [
      {
        seatStatus: "",
        label: "全部",
        count: totalCount,
      },
      ...state.seatSummary.map((item) => ({
        seatStatus: item.seatStatus,
        label: formatSeatStaticStatus(item.seatStatus),
        count: item.count,
      })),
    ];

    dom.seatSummary.innerHTML = summaryTabs
      .map(
        (item) => `
          <button
            class="summary-tab ${state.seatFilters.seatStatus === item.seatStatus ? "is-active" : ""}"
            type="button"
            data-action="filter-seat-status"
            data-seat-status="${escapeHtml(item.seatStatus)}"
          >
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(String(item.count || 0))}</strong>
          </button>
        `
      )
      .join("");
  } else {
    dom.seatSummary.innerHTML = "<span class='tag-pill'>暂无匹配统计</span>";
  }

  dom.seatTableBody.innerHTML = state.seats.length
    ? state.seats
        .map((seat, index) => {
          const zoneMeta = zoneMetaMap.get(seat.zoneCode) || {};
          const seatTags = [
            seat.quietLevel ? `<span class="inline-tag">${escapeHtml(seat.quietLevel)}</span>` : "",
            seat.hasPower ? `<span class="inline-tag inline-tag--primary">插座</span>` : "",
            seat.nearWindow ? `<span class="inline-tag inline-tag--success">靠窗</span>` : "",
            seat.seatCapacity ? `<span class="inline-tag">${escapeHtml(String(seat.seatCapacity))} 人</span>` : "",
          ]
            .filter(Boolean)
            .join("");

          return `
            <tr>
              <td><span class="table-index">${escapeHtml(String(index + 1))}</span></td>
              <td>
                <span class="table-main mono">${escapeHtml(seat.seatCode)}</span>
                <span class="table-sub">${escapeHtml(seat.specificLocation || "标准座位")}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(String(zoneMeta.floorNo || "-"))} 层</span>
                <span class="table-sub">${escapeHtml(seat.zoneDisplayName || seat.zoneCode)}</span>
              </td>
              <td>
                <span class="table-main">${escapeHtml(seat.tableGroupCode || "-")}</span>
                <span class="table-sub">${escapeHtml(seat.seatType)} · 序号 ${escapeHtml(String(seat.seatSeq || 0))}</span>
              </td>
              <td>
                <div class="tag-group">${seatTags || "<span class='table-sub'>暂无属性</span>"}</div>
              </td>
              <td><span class="status-pill" data-tone="${seatStatusTone(seat.seatStatus)}">${escapeHtml(formatSeatStaticStatus(seat.seatStatus))}</span></td>
              <td>${escapeHtml(formatDateTime(seat.updatedAt) || "-")}</td>
              <td>
                <div class="button-row">
                  <button
                    class="action-btn"
                    type="button"
                    data-action="edit-seat"
                    data-seat-code="${escapeHtml(seat.seatCode)}"
                  >
                    编辑
                  </button>
                  ${buildSeatStatusButtons(seat)}
                  <button
                    class="action-btn"
                    type="button"
                    data-action="delete-seat"
                    data-seat-code="${escapeHtml(seat.seatCode)}"
                    data-danger="true"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : buildEmptyTableRow("当前筛选条件下没有座位记录。", 8);

  setResourceEditorMode(state.resourceEditorMode, { focus: false });
}

function renderConfigs() {
  const items = state.configItems || [];
  const groupedEntries = new Map();

  items.forEach((item) => {
    if (!groupedEntries.has(item.configGroup)) {
      groupedEntries.set(item.configGroup, []);
    }
    groupedEntries.get(item.configGroup).push(item);
  });

  dom.configStatusStrip.innerHTML = items.length
    ? [
        `<span class="tag-pill">共 ${escapeHtml(String(items.length))} 项规则</span>`,
        ...Array.from(groupedEntries.keys()).map((groupKey) => {
          const groupMeta = state.configGroups[groupKey] || {};
          return `<span class="tag-pill">${escapeHtml(groupMeta.label || groupKey)} ${escapeHtml(String(groupedEntries.get(groupKey).length))} 项</span>`;
        }),
      ].join("")
    : "<span class='tag-pill'>暂无规则配置</span>";

  dom.configList.innerHTML = items.length
    ? Array.from(groupedEntries.entries())
        .map(([groupKey, groupItems], index) => {
          const groupMeta = state.configGroups[groupKey] || {};
          return `
            <details class="config-group-card" ${index === 0 ? "open" : ""}>
              <summary class="config-summary">
                <div class="subpanel-head">
                  <div>
                    <h3>${escapeHtml(groupMeta.label || groupKey)}</h3>
                    <span class="subtle-text">${escapeHtml(groupMeta.description || "按需展开维护当前规则组。")}</span>
                  </div>
                  <span class="tag-pill">${escapeHtml(String(groupItems.length))} 项</span>
                </div>
              </summary>
              <div class="config-field-grid">
                ${groupItems
                  .map(
                    (item) => `
                      <label class="field config-field">
                        <span>${escapeHtml(item.label)}</span>
                        <input
                          class="config-input"
                          type="${escapeHtml(item.inputType || "text")}"
                          value="${escapeHtml(String(item.value ?? ""))}"
                          data-config-key="${escapeHtml(item.configKey)}"
                          ${item.min !== undefined ? `min="${escapeHtml(String(item.min))}"` : ""}
                          ${item.max !== undefined ? `max="${escapeHtml(String(item.max))}"` : ""}
                          ${item.step !== undefined ? `step="${escapeHtml(String(item.step))}"` : ""}
                        />
                        <small class="config-helper">${escapeHtml(item.description || "")}</small>
                        <small class="config-meta">默认值：${escapeHtml(String(item.defaultValue ?? "-"))}</small>
                      </label>
                    `
                  )
                  .join("")}
              </div>
            </details>
          `;
        })
        .join("")
    : "<p class='helper-text'>当前没有可配置的系统规则。</p>";
}

function buildNoticeStatusButtons(notice) {
  const options = [
    { key: "published", label: "发布" },
    { key: "offline", label: "下线" },
    { key: "draft", label: "存为草稿" },
  ];

  return options
    .filter((item) => item.key !== notice.status)
    .map(
      (item) => `
        <button
          class="action-btn"
          type="button"
          data-action="change-notice-status"
          data-notice-id="${escapeHtml(String(notice.id))}"
          data-next-status="${escapeHtml(item.key)}"
        >
          ${escapeHtml(item.label)}
        </button>
      `
    )
    .join("");
}

function buildSeatStatusButtons(seat) {
  const options = [
    { key: "available", label: "可用" },
    { key: "maintenance", label: "维护" },
    { key: "disabled", label: "停用" },
  ];

  return options
    .filter((item) => item.key !== seat.seatStatus)
    .map(
      (item) => `
        <button
          class="action-btn"
          type="button"
          data-action="change-seat-status"
          data-seat-code="${escapeHtml(seat.seatCode)}"
          data-next-seat-status="${escapeHtml(item.key)}"
        >
          ${escapeHtml(item.label)}
        </button>
      `
    )
    .join("");
}

function collectZoneForm() {
  return {
    zoneCode: dom.zoneCodeInput.value.trim(),
    displayName: dom.zoneDisplayNameInput.value.trim(),
    floorNo: dom.zoneFloorNoInput.value,
    gridLetter: dom.zoneGridLetterInput.value.trim(),
    gridNumber: dom.zoneGridNumberInput.value,
    band: dom.zoneBandInput.value,
    annotationStatus: dom.zoneAnnotationStatusInput.value,
    sortOrder: dom.zoneSortOrderInput.value,
    isEnabled: dom.zoneIsEnabledInput.checked,
    notes: dom.zoneNotesInput.value.trim(),
  };
}

function fillZoneForm(zone) {
  state.editingZoneCode = zone.zoneCode;
  dom.zoneCodeInput.value = zone.zoneCode || "";
  dom.zoneCodeInput.readOnly = true;
  dom.zoneDisplayNameInput.value = zone.displayName || "";
  dom.zoneFloorNoInput.value = zone.floorNo || "";
  dom.zoneGridLetterInput.value = zone.gridLetter || "";
  dom.zoneGridNumberInput.value = zone.gridNumber || "";
  dom.zoneBandInput.value = zone.band || "north";
  dom.zoneAnnotationStatusInput.value = zone.annotationStatus || "pending";
  dom.zoneSortOrderInput.value = zone.sortOrder || 0;
  dom.zoneIsEnabledInput.checked = Boolean(zone.isEnabled);
  dom.zoneNotesInput.value = zone.notes || "";
  setActiveView("resourceSection");
  setResourceEditorMode("zone", { focus: false, reveal: true });
}

function resetZoneEditor(options = {}) {
  const shouldActivate = options.activate !== false;
  state.editingZoneCode = "";
  dom.zoneForm.reset();
  dom.zoneCodeInput.readOnly = false;
  dom.zoneFloorNoInput.value = "7";
  dom.zoneBandInput.value = "north";
  dom.zoneAnnotationStatusInput.value = "pending";
  dom.zoneSortOrderInput.value = "0";
  dom.zoneIsEnabledInput.checked = true;

  if (shouldActivate) {
    setResourceEditorMode("zone", { focus: options.focus });
  }
}

function collectSeatForm() {
  return {
    seatCode: dom.seatCodeInput.value.trim(),
    zoneCode: dom.seatEditorZoneCode.value,
    tableCode: dom.seatTableCodeInput.value.trim(),
    seatSeq: dom.seatSeqInput.value,
    seatType: dom.seatTypeInput.value.trim(),
    seatCapacity: dom.seatCapacityInput.value,
    seatStatus: dom.seatStatusInput.value,
    quietLevel: dom.seatQuietLevelInput.value,
    hasPower: dom.seatHasPowerInput.checked,
    nearWindow: dom.seatNearWindowInput.checked,
    sortOrder: dom.seatSortOrderInput.value,
    specificLocation: dom.seatSpecificLocationInput.value.trim(),
  };
}

function fillSeatForm(seat) {
  state.editingSeatCode = seat.seatCode;
  dom.seatCodeInput.value = seat.seatCode || "";
  dom.seatCodeInput.readOnly = true;
  dom.seatEditorZoneCode.value = seat.zoneCode || "";
  dom.seatEditorZoneCode.disabled = true;
  dom.seatTableCodeInput.value = seat.tableCode || "";
  dom.seatSeqInput.value = seat.seatSeq || "";
  dom.seatTypeInput.value = seat.seatType || "";
  dom.seatCapacityInput.value = seat.seatCapacity || "";
  dom.seatStatusInput.value = seat.seatStatus || "available";
  dom.seatQuietLevelInput.value = seat.quietLevel || "一般";
  dom.seatHasPowerInput.checked = Boolean(seat.hasPower);
  dom.seatNearWindowInput.checked = Boolean(seat.nearWindow);
  dom.seatSortOrderInput.value = seat.sortOrder || 0;
  dom.seatSpecificLocationInput.value = seat.specificLocation || "";
  setActiveView("resourceSection");
  setResourceEditorMode("seat", { focus: false, reveal: true });
}

function resetSeatEditor(options = {}) {
  const shouldActivate = options.activate !== false;
  state.editingSeatCode = "";
  dom.seatEditorForm.reset();
  dom.seatCodeInput.readOnly = false;
  dom.seatEditorZoneCode.disabled = false;
  dom.seatStatusInput.value = "available";
  dom.seatQuietLevelInput.value = "安静";
  dom.seatSortOrderInput.value = "0";

  if (shouldActivate) {
    setResourceEditorMode("seat", { focus: options.focus });
  }
}

async function deleteZone(zoneCode) {
  ensureSession();

  const result = await request(`/api/admin/zones/${encodeURIComponent(zoneCode)}/delete`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      reason: "admin_delete_zone",
    }),
  });

  await Promise.all([loadDashboard(), loadReports(), loadZones(), loadSeats()]);
  renderDashboard();
  renderReports();
  renderResources();
  if (state.editingZoneCode === zoneCode) {
    resetZoneEditor();
  }
  showStatus(result.message || "分区已删除。", "success");
}

async function deleteSeat(seatCode) {
  ensureSession();

  const result = await request(`/api/admin/seats/${encodeURIComponent(seatCode)}/delete`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      reason: "admin_delete_seat",
    }),
  });

  await Promise.all([loadDashboard(), loadReports(), loadZones(), loadSeats()]);
  renderDashboard();
  renderReports();
  renderResources();
  if (state.editingSeatCode === seatCode) {
    resetSeatEditor();
  }
  showStatus(result.message || "座位已删除。", "success");
}

function renderZoneOptions() {
  const currentFilterValue = state.seatFilters.zoneCode;
  const currentEditorValue = dom.seatEditorZoneCode.value || "";
  const optionMarkup = state.zones
    .map(
      (zone) =>
        `<option value="${escapeHtml(zone.zoneCode)}">${escapeHtml(zone.zoneCode)} · ${escapeHtml(zone.displayName)}</option>`
    )
    .join("");

  dom.seatZoneCode.innerHTML = "<option value=''>全部分区</option>" + optionMarkup;
  dom.seatEditorZoneCode.innerHTML = "<option value=''>选择分区</option>" + optionMarkup;
  dom.seatZoneCode.value = currentFilterValue;
  dom.seatEditorZoneCode.value = currentEditorValue || "";
}

function collectConfigFormValues() {
  return Array.from(dom.configList.querySelectorAll("[data-config-key]")).map((input) => ({
    configKey: input.dataset.configKey,
    value: input.value
  }));
}

function fillNoticeForm(notice) {
  state.editingNoticeId = notice.id;
  dom.noticeFormTitle.textContent = `编辑公告 #${notice.id}`;
  dom.noticeTitle.value = notice.title || "";
  dom.noticeContent.value = notice.content || "";
  dom.noticeType.value = notice.noticeType || "system";
  dom.noticeAudience.value = notice.audience || "all";
  dom.noticeStatus.value = notice.status || "draft";
  dom.noticePublishAt.value = toDateTimeLocal(notice.publishAt);
  dom.noticeExpireAt.value = toDateTimeLocal(notice.expireAt);
  setActiveView("noticeSection");
}

function collectNoticeForm() {
  return {
    title: dom.noticeTitle.value.trim(),
    content: dom.noticeContent.value.trim(),
    noticeType: dom.noticeType.value,
    audience: dom.noticeAudience.value,
    status: dom.noticeStatus.value,
    publishAt: dom.noticePublishAt.value || null,
    expireAt: dom.noticeExpireAt.value || null,
  };
}

function resetNoticeEditor() {
  state.editingNoticeId = null;
  dom.noticeFormTitle.textContent = "发布新公告";
  dom.noticeForm.reset();
  dom.noticeType.value = "system";
  dom.noticeAudience.value = "all";
  dom.noticeStatus.value = "draft";
}

async function updateNoticeStatus(noticeId, status) {
  ensureSession();

  const result = await request(`/api/admin/notices/${noticeId}/status`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      status,
    }),
  });

  await Promise.all([loadDashboard(), loadNotices()]);
  showStatus(result.message || "公告状态已更新。", "success");
}

async function updateZoneEnabled(zoneCode, isEnabled, reason) {
  ensureSession();

  const result = await request(`/api/admin/zones/${encodeURIComponent(zoneCode)}/status`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      isEnabled,
      reason,
    }),
  });

  await Promise.all([loadZones(), loadSeats()]);
  renderResources();
  showStatus(result.message || "分区状态已更新。", "success");
}

async function updateSeatStatus(seatCode, seatStatus, reason) {
  ensureSession();

  const result = await request(`/api/admin/seats/${encodeURIComponent(seatCode)}/status`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      seatStatus,
      reason,
    }),
  });

  await loadSeats();
  renderResources();
  showStatus(result.message || "座位状态已更新。", "success");
}

async function refreshReservationPanels() {
  await Promise.all([loadDashboard(), loadReports(), loadReservations()]);
  renderDashboard();
  renderReports();
  renderReservations();
}

async function manualCheckoutReservation(reservationNo, reason) {
  ensureSession();

  const result = await request(`/api/admin/reservations/${encodeURIComponent(reservationNo)}/manual-checkout`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      reason,
    }),
  });

  await refreshReservationPanels();
  showStatus(result.message || "预约已完成代签退。", "success");
}

async function releaseReservation(reservationNo, reason) {
  ensureSession();

  const result = await request(`/api/admin/reservations/${encodeURIComponent(reservationNo)}/release`, {
    method: "POST",
    body: JSON.stringify({
      studentNo: state.session.studentNo,
      reason,
    }),
  });

  await refreshReservationPanels();
  showStatus(result.message || "预约已释放。", "success");
}

function selectUser(studentNo) {
  state.selectedUserNo = studentNo;
  renderUsers();
  renderSelectedUser();
  setActiveView("userSection");
  dom.creditDelta?.focus();
}

function getSelectedUser() {
  return (
    state.users.find((item) => item.studentNo === state.selectedUserNo) ||
    state.dashboard?.creditWarnings?.find((item) => item.studentNo === state.selectedUserNo) ||
    null
  );
}

function applyStoredFilters() {
  dom.reportStartDate.value = state.reportFilters.startDate;
  dom.reportEndDate.value = state.reportFilters.endDate;
  dom.noticeKeyword.value = state.noticeFilters.keyword;
  dom.noticeFilterStatus.value = state.noticeFilters.status;
  dom.noticeFilterAudience.value = state.noticeFilters.audience;
  dom.reservationKeyword.value = state.reservationFilters.keyword;
  dom.reservationStatus.value = state.reservationFilters.status;
  dom.reservationDate.value = state.reservationFilters.reservationDate;
  dom.userKeyword.value = state.userFilters.keyword;
  dom.blacklistOnly.checked = state.userFilters.blacklistOnly;
  dom.seatKeyword.value = state.seatFilters.keyword;
  dom.seatFilterStatus.value = state.seatFilters.seatStatus;
}

async function request(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.session && state.session.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }

  const response = await fetch(`${state.apiBase}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const rawText = await response.text();
  const payload = rawText ? safeParseJson(rawText) : null;

  if (!response.ok) {
    if (response.status === 401) {
      state.session = null;
      localStorage.removeItem(STORAGE_KEYS.session);
      syncSessionUi();
      renderLoggedOutState();
    }
    const message = payload && typeof payload === "object" ? payload.message : "";
    throw new Error(message || `请求失败：${response.status}`);
  }

  return payload;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function ensureSession() {
  if (!state.session) {
    throw new Error("请先使用管理员账号登录。");
  }
}

function showStatus(message, tone = "info") {
  dom.appStatus.textContent = message;
  dom.appStatus.dataset.tone = tone;
  dom.appStatus.classList.remove("hidden");

  if (statusTimer) {
    window.clearTimeout(statusTimer);
    statusTimer = 0;
  }

  if (tone !== "error") {
    statusTimer = window.setTimeout(() => {
      dom.appStatus.classList.add("hidden");
      statusTimer = 0;
    }, 2600);
  }
}

function handleError(error) {
  console.error(error);
  showStatus(error.message || "操作失败，请稍后重试。", "error");
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.session);
    const session = raw ? JSON.parse(raw) : null;
    return session && session.token ? session : null;
  } catch (error) {
    return null;
  }
}

function loadApiBase() {
  const raw = localStorage.getItem(STORAGE_KEYS.apiBase);
  return normalizeApiBase(raw || DEFAULT_API_BASE);
}

function normalizeApiBase(value) {
  return normalizeApiBaseValue(value) || DEFAULT_API_BASE;
}

function resolveDefaultApiBase() {
  const configuredBase =
    normalizeApiBaseValue(RUNTIME_CONFIG.apiBase) ||
    normalizeApiBaseValue(RUNTIME_CONFIG.publicBase);

  if (configuredBase) {
    return configuredBase;
  }

  const currentOrigin = normalizeApiBaseValue(resolveCurrentOrigin());
  if (currentOrigin) {
    return currentOrigin;
  }

  return normalizeApiBaseValue(FALLBACK_PUBLIC_BASE) || "http://127.0.0.1:3000";
}

function resolveCurrentOrigin() {
  return window.location.protocol.startsWith("http") ? window.location.origin : "";
}

function normalizeUrlInput(value) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const currentOrigin = resolveCurrentOrigin();
  if (/^\/admin\/?$/i.test(normalized) && currentOrigin) {
    return `${currentOrigin}/admin`;
  }

  if (/^\//.test(normalized) && currentOrigin) {
    return `${currentOrigin}${normalized}`;
  }

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalized)) {
    if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(:\d+)?(?:\/.*)?$/i.test(normalized)) {
      normalized = `http://${normalized}`;
    } else if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(?:\/.*)?$/i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
  }

  return normalized.replace(/\/+$/, "");
}

function normalizeApiBaseValue(value) {
  const normalized = normalizeUrlInput(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/\/admin(?:\/.*)?$/i, "").replace(/\/+$/, "");
}

function normalizeAdminEntryValue(value) {
  const normalized = normalizeUrlInput(value);
  if (!normalized) {
    return "";
  }

  const adminBase = /\/admin(?:\/.*)?$/i.test(normalized)
    ? normalized.replace(/\/admin(?:\/.*)?$/i, "/admin")
    : `${normalizeApiBaseValue(normalized)}/admin`;

  return `${adminBase.replace(/\/+$/, "")}/`;
}

function resolveAdminEntryUrl(preferredValue = "") {
  return (
    normalizeAdminEntryValue(preferredValue) ||
    normalizeAdminEntryValue(state.health?.access?.adminUrl || "") ||
    normalizeAdminEntryValue(RUNTIME_CONFIG.adminBase || "") ||
    normalizeAdminEntryValue(state.apiBase || DEFAULT_API_BASE) ||
    `${DEFAULT_API_BASE}/admin/`
  );
}

function resolveAccessInfo() {
  const healthAccess =
    state.health && typeof state.health === "object" && state.health.access && typeof state.health.access === "object"
      ? state.health.access
      : {};

  const apiBaseUrl = normalizeApiBase(
    healthAccess.apiBaseUrl ||
      healthAccess.publicBaseUrl ||
      state.apiBase ||
      RUNTIME_CONFIG.apiBase ||
      RUNTIME_CONFIG.publicBase ||
      DEFAULT_API_BASE
  );

  const adminUrl = resolveAdminEntryUrl(healthAccess.adminUrl || RUNTIME_CONFIG.adminBase || apiBaseUrl);
  const mode = healthAccess.mode || (isLocalAccess(apiBaseUrl) || isLocalAccess(adminUrl) ? "local" : "domain");

  return {
    apiBaseUrl,
    adminUrl,
    mode,
  };
}

function syncAccessUi() {
  const accessInfo = resolveAccessInfo();
  const adminLabel = stripProtocol(accessInfo.adminUrl);
  const isLocalMode = accessInfo.mode === "local";

  if (dom.accessModeBadge) {
    dom.accessModeBadge.dataset.state = isLocalMode ? "local" : "ready";
    dom.accessModeBadge.textContent = isLocalMode ? "本地调试访问" : "正式域名访问";
  }

  if (dom.adminEntryLink) {
    dom.adminEntryLink.href = accessInfo.adminUrl;
    dom.adminEntryLink.title = accessInfo.adminUrl;
  }

  if (dom.sidebarAdminLink) {
    dom.sidebarAdminLink.href = accessInfo.adminUrl;
    dom.sidebarAdminLink.textContent = adminLabel;
    dom.sidebarAdminLink.title = accessInfo.adminUrl;
  }

  if (dom.loginEntryHint) {
    dom.loginEntryHint.textContent = isLocalMode ? "本地调试入口" : adminLabel;
  }

  if (document.activeElement !== dom.apiBaseInput) {
    dom.apiBaseInput.value = state.apiBase;
  }

  renderGuidePanel();
}

function stripProtocol(value) {
  return String(value || "").replace(/^https?:\/\//i, "");
}

function isLocalAccess(value) {
  const normalized = normalizeUrlInput(value);

  if (!normalized) {
    return window.location.protocol === "file:";
  }

  try {
    const hostname = new URL(normalized).hostname;
    return /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\])$/i.test(hostname);
  } catch (error) {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(normalized);
  }
}

function formatRole(role) {
  return ROLE_LABELS[role] || role || "管理员";
}

function formatStatus(status) {
  return STATUS_LABELS[status] || status || "-";
}

function formatSeatStaticStatus(status) {
  switch (status) {
    case "available":
      return "可用";
    case "disabled":
      return "停用";
    case "maintenance":
      return "维护中";
    default:
      return status || "-";
  }
}

function formatViolationType(type) {
  switch (type) {
    case "no_show":
      return "未签到";
    case "leave_timeout":
      return "暂离超时";
    case "manual_penalty":
      return "人工扣分";
    default:
      return type || "无";
  }
}

function formatPercentValue(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatHours(value) {
  return `${Number(value || 0).toFixed(1)} 小时`;
}

function getHeatLevel(value, maxValue) {
  const safeValue = Number(value || 0);
  const safeMax = Math.max(Number(maxValue || 0), 1);
  const ratio = safeValue / safeMax;

  if (ratio <= 0) {
    return 0;
  }
  if (ratio < 0.25) {
    return 1;
  }
  if (ratio < 0.5) {
    return 2;
  }
  if (ratio < 0.75) {
    return 3;
  }
  return 4;
}

function seatStatusTone(status) {
  switch (status) {
    case "available":
      return "completed";
    case "maintenance":
      return "temporary_leave";
    case "disabled":
      return "danger";
    default:
      return "draft";
  }
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return String(value).replace("T", " ").slice(0, 19);
}

function formatDateInput(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeLocal(value) {
  if (!value) {
    return "";
  }

  return formatDateTime(value).slice(0, 16).replace(" ", "T");
}

function scoreTone(score) {
  const value = Number(score || 0);
  if (value < 60) {
    return "danger";
  }
  if (value <= 80) {
    return "warning";
  }
  return "normal";
}

function truncate(text, limit) {
  const raw = String(text || "");
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
}

function buildEmptyTableRow(message, colspan) {
  return `<tr><td colspan="${colspan}" class="helper-text">${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
