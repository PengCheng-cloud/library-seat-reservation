const FILTER_OPTIONS = [
  { key: "power_outlet", label: "有插座", description: "适合长时间学习或带电脑使用" },
  { key: "window", label: "靠窗", description: "更适合阅读和白天自习" },
  { key: "quiet", label: "安静", description: "优先推荐干扰更少的位置" },
  { key: "balanced_temperature", label: "温度均衡", description: "避开空调直吹区域" },
  { key: "quiet_position", label: "避开通道", description: "走动干扰相对更少" },
  { key: "table_4", label: "4人桌", description: "适合单人或双人学习" },
  { key: "table_8", label: "8人桌", description: "适合结伴自习或小组使用" },
  { key: "near_bookshelf", label: "靠近书架", description: "适合查阅纸质书" },
  { key: "near_restroom", label: "靠近卫生间", description: "适合短时停留" },
  { key: "sunlight_yes", label: "光照充足", description: "白天临窗区域更明亮" },
];

const PRESETS = {
  sprint: {
    label: "冲刺学习",
    filters: ["power_outlet", "quiet", "quiet_position", "balanced_temperature"],
  },
  window: {
    label: "临窗阅读",
    filters: ["window", "quiet", "sunlight_yes"],
  },
  group: {
    label: "结伴自习",
    filters: ["table_8", "power_outlet", "balanced_temperature"],
  },
};

const state = {
  seats: [],
  zones: [],
  zoneMap: new Map(),
  stats: null,
  activeFilters: new Set(),
  search: "",
  activeZone: null,
  selectedSeatId: null,
  topOnly: false,
  reservedSeatIds: new Set(),
};

const dom = {
  heroStats: document.getElementById("heroStats"),
  appStatus: document.getElementById("appStatus"),
  zoneLayer: document.getElementById("zoneLayer"),
  searchInput: document.getElementById("searchInput"),
  filterChips: document.getElementById("filterChips"),
  activeFilterBar: document.getElementById("activeFilterBar"),
  zoneSummary: document.getElementById("zoneSummary"),
  selectedSeatPanel: document.getElementById("selectedSeatPanel"),
  reserveBtn: document.getElementById("reserveBtn"),
  clearZoneBtn: document.getElementById("clearZoneBtn"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  topToggleBtn: document.getElementById("topToggleBtn"),
  resultMeta: document.getElementById("resultMeta"),
  recommendationStrip: document.getElementById("recommendationStrip"),
  tableGroupStrip: document.getElementById("tableGroupStrip"),
  seatGrid: document.getElementById("seatGrid"),
};

bootstrap();

async function bootstrap() {
  bindStaticEvents();

  if (window.location.protocol === "file:") {
    showStatus("建议使用本地静态服务器打开页面，例如在当前目录运行 `python -m http.server 8000`，再访问 `http://localhost:8000`。");
  }

  try {
    const [seatMaster, zoneTemplate, stats] = await Promise.all([
      fetchJson("./data/seat_master.json"),
      fetchJson("./data/seat_zone_template.json"),
      fetchJson("./data/seat_stats.json"),
    ]);

    hydrateData(seatMaster, zoneTemplate, stats);
    renderAll();
  } catch (error) {
    console.error(error);
    showStatus("页面数据加载失败。请确认你是通过本地服务器访问当前目录，而不是直接双击打开 HTML 文件。");
    dom.resultMeta.innerHTML = "<p class='helper-text'>当前无法读取本地 JSON 数据，请先启动一个本地服务器。</p>";
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function hydrateData(seatMaster, zoneTemplate, stats) {
  const layoutMap = buildZoneLayout(zoneTemplate.zones);
  state.stats = stats;

  state.zones = zoneTemplate.zones
    .map((zone) => ({
      ...zone,
      layout: layoutMap.get(zone.zoneCode),
      seats: [],
    }))
    .sort(compareZones);

  state.zoneMap = new Map(state.zones.map((zone) => [zone.zoneCode, zone]));

  state.seats = seatMaster.seats.map((seat) => {
    const enriched = {
      ...seat,
      searchText: [
        seat.seatId,
        seat.zoneCode,
        seat.zoneDisplayName,
        seat.rawTagsText || "",
        seat.rawTags.join(" "),
      ]
        .join(" ")
        .toLowerCase(),
    };

    const zone = state.zoneMap.get(enriched.zoneCode);
    if (zone) {
      zone.seats.push(enriched);
    }

    return enriched;
  });
}

function buildZoneLayout(zones) {
  const map = new Map();
  const groups = {
    north: zones.filter((zone) => zone.band === "north").sort((a, b) => a.gridNumber - b.gridNumber),
    south_outer: zones.filter((zone) => zone.band === "south_outer").sort((a, b) => a.gridNumber - b.gridNumber),
    south_inner: zones.filter((zone) => zone.band === "south_inner").sort((a, b) => a.gridNumber - b.gridNumber),
    west: zones.filter((zone) => zone.band === "west").sort((a, b) => b.gridLetter.localeCompare(a.gridLetter)),
    east: zones.filter((zone) => zone.band === "east").sort((a, b) => b.gridLetter.localeCompare(a.gridLetter)),
    inner: zones.filter((zone) => zone.band === "inner").sort((a, b) => compareSeatIds(a.zoneCode, b.zoneCode)),
  };

  assignHorizontalLayout(groups.north, { map, xStart: 13, xEnd: 87, y: 8.5, width: 6.5, height: 8.5 });
  assignHorizontalLayout(groups.south_outer, { map, xStart: 13, xEnd: 87, y: 90, width: 6.5, height: 8.2 });
  assignHorizontalLayout(groups.south_inner, { map, xStart: 22, xEnd: 78, y: 77.5, width: 6.2, height: 8.2 });
  assignVerticalLayout(groups.west, { map, yStart: 18, yEnd: 82, x: 8.5, width: 7, height: 8 });
  assignVerticalLayout(groups.east, { map, yStart: 18, yEnd: 82, x: 84.8, width: 7, height: 8 });
  assignHorizontalLayout(groups.inner, { map, xStart: 35, xEnd: 65, y: 50, width: 8, height: 8 });

  return map;
}

function assignHorizontalLayout(zones, options) {
  if (!zones.length) {
    return;
  }

  const step = zones.length === 1 ? 0 : (options.xEnd - options.xStart) / (zones.length - 1);
  zones.forEach((zone, index) => {
    const centerX = options.xStart + step * index;
    options.map.set(zone.zoneCode, {
      left: centerX - options.width / 2,
      top: options.y - options.height / 2,
      width: options.width,
      height: options.height,
    });
  });
}

function assignVerticalLayout(zones, options) {
  if (!zones.length) {
    return;
  }

  const step = zones.length === 1 ? 0 : (options.yEnd - options.yStart) / (zones.length - 1);
  zones.forEach((zone, index) => {
    const centerY = options.yStart + step * index;
    options.map.set(zone.zoneCode, {
      left: options.x - options.width / 2,
      top: centerY - options.height / 2,
      width: options.width,
      height: options.height,
    });
  });
}

function bindStaticEvents() {
  document.addEventListener("click", handleDocumentClick);

  dom.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderAll();
  });

  dom.clearZoneBtn.addEventListener("click", () => {
    state.activeZone = null;
    renderAll();
  });

  dom.resetFiltersBtn.addEventListener("click", resetFilters);

  dom.topToggleBtn.addEventListener("click", () => {
    state.topOnly = !state.topOnly;
    renderAll();
  });

  dom.reserveBtn.addEventListener("click", reserveCurrentSeat);
}

function handleDocumentClick(event) {
  const presetButton = event.target.closest("[data-preset]");
  if (presetButton) {
    applyPreset(presetButton.dataset.preset);
    return;
  }

  const filterButton = event.target.closest("[data-filter-key]");
  if (filterButton) {
    toggleFilter(filterButton.dataset.filterKey);
    return;
  }

  const zoneButton = event.target.closest("[data-zone-code]");
  if (zoneButton) {
    const zoneCode = zoneButton.dataset.zoneCode;
    state.activeZone = state.activeZone === zoneCode ? null : zoneCode;
    renderAll();
    return;
  }

  const seatButton = event.target.closest("[data-seat-id]");
  if (seatButton) {
    const seatId = seatButton.dataset.seatId;
    if (state.reservedSeatIds.has(seatId)) {
      showStatus(`${seatId} 已经加入预定示意，不再重复操作。`);
      return;
    }
    state.selectedSeatId = seatId;
    renderAll();
  }
}

function toggleFilter(filterKey) {
  if (state.activeFilters.has(filterKey)) {
    state.activeFilters.delete(filterKey);
  } else {
    state.activeFilters.add(filterKey);
  }
  renderAll();
}

function resetFilters() {
  state.activeFilters.clear();
  state.search = "";
  state.activeZone = null;
  state.topOnly = false;
  dom.searchInput.value = "";
  renderAll();
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) {
    return;
  }

  state.activeFilters = new Set(preset.filters);
  showStatus(`已应用场景：${preset.label}`);
  renderAll();
}

function reserveCurrentSeat() {
  const seat = getSelectedSeat();
  if (!seat) {
    return;
  }

  state.reservedSeatIds.add(seat.seatId);
  showStatus(`已将 ${seat.seatId} 加入预定草稿。这里先做本地示意，后续可接后端接口落库。`);
  renderAll();
}

function renderAll() {
  renderHeroStats();
  renderFilters();
  renderZoneLayer();
  renderZoneSummary();
  renderSelectedSeat();
  renderResults();
}

function renderHeroStats() {
  if (!state.stats) {
    return;
  }

  const quietCount = state.stats.quietDistribution?.["安静"] || 0;
  const windowCount = state.stats.windowDistribution?.["true"] || 0;

  const cards = [
    { value: formatNumber(state.stats.seatCount), label: "座位总数" },
    { value: formatNumber(state.stats.zoneCount), label: "分区数量" },
    { value: formatNumber(state.stats.tableGroupCount), label: "桌组数量" },
    { value: formatNumber(quietCount), label: "安静座位" },
    { value: formatNumber(windowCount), label: "靠窗座位" },
    { value: formatNumber(state.stats.rawTagPatternCount), label: "标签模式" },
  ];

  dom.heroStats.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <strong>${card.value}</strong>
          <span>${card.label}</span>
        </article>
      `
    )
    .join("");
}

function renderFilters() {
  dom.filterChips.innerHTML = FILTER_OPTIONS.map((option) => {
    const active = state.activeFilters.has(option.key);
    return `
      <button
        class="filter-chip"
        data-filter-key="${option.key}"
        data-active="${active}"
        title="${option.description}"
      >
        ${option.label}
      </button>
    `;
  }).join("");

  if (!state.activeFilters.size) {
    dom.activeFilterBar.innerHTML = "<p class='helper-text'>还没有激活标签，当前会展示所有分区和推荐座位。</p>";
    return;
  }

  dom.activeFilterBar.innerHTML = Array.from(state.activeFilters)
    .map((key) => {
      const option = FILTER_OPTIONS.find((item) => item.key === key);
      return `<span class="tag-pill">${option ? option.label : key}</span>`;
    })
    .join("");
}

function renderZoneLayer() {
  const zoneCounts = getZoneMatchCounts();
  const maxCount = Math.max(...Array.from(zoneCounts.values()), 1);

  dom.zoneLayer.innerHTML = state.zones
    .map((zone) => {
      const matchedSeats = zoneCounts.get(zone.zoneCode) || 0;
      const heat = matchedSeats / maxCount;
      const layout = zone.layout || { left: 0, top: 0, width: 0, height: 0 };
      const displayCount = shouldUseMatchedCount() ? matchedSeats : zone.seatCount;
      const isActive = zone.zoneCode === state.activeZone;
      const isEmpty = shouldUseMatchedCount() && matchedSeats === 0;

      return `
        <button
          class="zone-chip"
          data-zone-code="${zone.zoneCode}"
          data-active="${isActive}"
          data-empty="${isEmpty}"
          title="${escapeHtml(zone.displayName)}：${displayCount} 个可见座位"
          style="
            --heat:${heat.toFixed(3)};
            left:${layout.left}%;
            top:${layout.top}%;
            width:${layout.width}%;
            height:${layout.height}%;
          "
        >
          <span class="zone-code">${zone.zoneCode}</span>
          <span class="zone-count">${displayCount}</span>
        </button>
      `;
    })
    .join("");
}

function renderZoneSummary() {
  const zone = state.activeZone ? state.zoneMap.get(state.activeZone) : null;
  if (!zone) {
    dom.zoneSummary.className = "zone-summary empty-state";
    dom.zoneSummary.innerHTML = "还没有选中分区。你可以先点左侧平面图，也可以直接按标签筛选。";
    return;
  }

  const matchedSeats = getVisibleSeats().filter((seat) => seat.zoneCode === zone.zoneCode);
  const totalTables = new Set(zone.seats.map((seat) => seat.tableGroupCode)).size;
  const quietCount = matchedSeats.filter((seat) => seat.quietLevel === "安静").length;
  const types = countBy(matchedSeats, (seat) => seat.seatType);
  const topTags = pickTopTags(matchedSeats);

  dom.zoneSummary.className = "zone-summary";
  dom.zoneSummary.innerHTML = `
    <article class="zone-summary-card">
      <div class="zone-title-row">
        <div>
          <h3 class="zone-title">${zone.displayName}</h3>
          <p class="zone-subtitle">分区编码 ${zone.zoneCode} · ${describeBand(zone.band)}</p>
        </div>
        <span class="status-badge">${matchedSeats.length} 个匹配座位</span>
      </div>

      <div class="zone-metrics">
        <div class="metric-box">
          <strong>${zone.seatCount}</strong>
          <span>分区总座位</span>
        </div>
        <div class="metric-box">
          <strong>${totalTables}</strong>
          <span>桌组数量</span>
        </div>
        <div class="metric-box">
          <strong>${quietCount}</strong>
          <span>安静座位</span>
        </div>
        <div class="metric-box">
          <strong>${Object.keys(types).join(" / ") || "-"}</strong>
          <span>桌型组合</span>
        </div>
      </div>

      <div class="chip-list">
        ${topTags.length ? topTags.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("") : "<span class='helper-text'>当前筛选下暂无高频标签。</span>"}
      </div>
    </article>
  `;
}

function renderSelectedSeat() {
  const seat = getSelectedSeat();
  if (!seat) {
    dom.selectedSeatPanel.className = "selected-seat empty-state";
    dom.selectedSeatPanel.innerHTML = "选中某个座位后，这里会显示预定信息和推荐理由。";
    dom.reserveBtn.disabled = true;
    return;
  }

  const selected = state.reservedSeatIds.has(seat.seatId);
  const reasons = buildReasonList(seat);

  dom.selectedSeatPanel.className = "selected-seat";
  dom.selectedSeatPanel.innerHTML = `
    <article class="selected-seat-card">
      <div class="seat-head">
        <div>
          <h3 class="seat-title">${seat.seatId}</h3>
          <p class="seat-subtitle">${seat.zoneDisplayName} · ${seat.seatType} · ${seat.tableGroupCode}</p>
        </div>
        <span class="status-badge ${selected ? "status-badge--selected" : ""}">${selected ? "已加入草稿" : "待预定"}</span>
      </div>

      <div class="seat-meta-grid">
        <div class="seat-meta-item">
          <strong>标签匹配</strong>
          <span>${Array.from(state.activeFilters).length || 0} 个主动偏好命中</span>
        </div>
        <div class="seat-meta-item">
          <strong>推荐得分</strong>
          <span>${computeSeatScore(seat)} 分</span>
        </div>
        <div class="seat-meta-item">
          <strong>环境特征</strong>
          <span>${escapeHtml(seat.rawTags.slice(0, 3).join(" / "))}</span>
        </div>
        <div class="seat-meta-item">
          <strong>采光与温度</strong>
          <span>${seat.sunlight === "有" ? "光照较好" : "光线平稳"} · ${seat.nearAC ? "靠近空调" : "温度均衡"}</span>
        </div>
      </div>

      <div class="chip-list">
        ${reasons.map((reason) => `<span class="tag-pill">${escapeHtml(reason)}</span>`).join("")}
      </div>
    </article>
  `;

  dom.reserveBtn.disabled = selected;
  dom.reserveBtn.textContent = selected ? "已加入预定草稿" : "确认预定";
}

function renderResults() {
  const visibleSeats = getVisibleSeats();
  const availableSeats = visibleSeats.filter((seat) => !state.reservedSeatIds.has(seat.seatId));
  const renderedSeats = state.topOnly ? visibleSeats.slice(0, 12) : visibleSeats.slice(0, 80);

  const zoneLabel = state.activeZone ? `${state.activeZone} 分区` : "全部分区";
  const truncationNote = !state.topOnly && visibleSeats.length > 80 ? " 为了页面清晰，列表最多展示前 80 个结果。" : "";

  dom.resultMeta.innerHTML = `
    <p>
      当前范围：<strong>${zoneLabel}</strong>。
      共找到 <strong>${visibleSeats.length}</strong> 个匹配座位，其中 <strong>${availableSeats.length}</strong> 个仍可加入草稿。
      ${truncationNote}
    </p>
  `;

  dom.topToggleBtn.textContent = state.topOnly ? "查看完整结果" : "只看推荐前 12 个";

  renderRecommendationStrip(visibleSeats);
  renderGroupStrip(visibleSeats);
  renderSeatGrid(renderedSeats, visibleSeats.length);
}

function renderRecommendationStrip(seats) {
  const recommended = seats.slice(0, 6);
  if (!recommended.length) {
    dom.recommendationStrip.innerHTML = "<p class='helper-text'>当前筛选下没有匹配座位，可以放宽条件再试试。</p>";
    return;
  }

  dom.recommendationStrip.innerHTML = recommended
    .map((seat, index) => {
      const selected = seat.seatId === state.selectedSeatId;
      return `
        <article class="mini-card">
          <div class="mini-head">
            <div>
              <h3 class="mini-title">推荐 ${index + 1} · ${seat.seatId}</h3>
              <p class="mini-subtitle">${seat.zoneDisplayName} · ${seat.seatType}</p>
            </div>
            <span class="score-badge">${computeSeatScore(seat)} 分</span>
          </div>
          <p class="mini-copy">${escapeHtml(buildReasonList(seat).join("，"))}</p>
          <div class="chip-list">
            ${seat.rawTags.slice(0, 4).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <button class="seat-action" data-seat-id="${seat.seatId}" data-selected="${selected}">
            ${selected ? "已选中当前座位" : "选择这个座位"}
          </button>
        </article>
      `;
    })
    .join("");
}

function renderGroupStrip(seats) {
  if (state.activeZone) {
    const groups = Object.values(groupBy(seats, (seat) => seat.tableGroupCode))
      .slice(0, 10)
      .map((groupSeats) => {
        const sample = groupSeats[0];
        const available = groupSeats.filter((seat) => !state.reservedSeatIds.has(seat.seatId)).length;
        return {
          title: sample.tableGroupCode,
          subtitle: `${sample.seatType} · ${sample.zoneDisplayName}`,
          copy: `桌组内共 ${groupSeats.length} 个座位，当前 ${available} 个还可加入草稿。`,
          badge: `${available}/${groupSeats.length}`,
        };
      });

    dom.tableGroupStrip.innerHTML = groups
      .map(
        (group) => `
          <article class="table-group-card">
            <div class="table-group-head">
              <div>
                <h3 class="mini-title">${group.title}</h3>
                <p class="mini-subtitle">${group.subtitle}</p>
              </div>
              <span class="status-badge">${group.badge}</span>
            </div>
            <p class="table-group-copy">${group.copy}</p>
          </article>
        `
      )
      .join("");
    return;
  }

  const zoneCounts = getZoneMatchCounts();
  const topZones = state.zones
    .map((zone) => ({ zone, count: zoneCounts.get(zone.zoneCode) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || compareZones(a.zone, b.zone))
    .slice(0, 8);

  dom.tableGroupStrip.innerHTML = topZones.length
    ? topZones
        .map(
          (item) => `
            <article class="table-group-card">
              <div class="table-group-head">
                <div>
                  <h3 class="mini-title">${item.zone.zoneCode}</h3>
                  <p class="mini-subtitle">${item.zone.displayName}</p>
                </div>
                <span class="status-badge">${item.count} 个</span>
              </div>
              <p class="table-group-copy">
                当前筛选下，这个区域匹配座位较多，适合作为优先查看的候选分区。
              </p>
            </article>
          `
        )
        .join("")
    : "<p class='helper-text'>暂无可展示的优先分区。</p>";
}

function renderSeatGrid(seats, totalCount) {
  if (!seats.length) {
    dom.seatGrid.innerHTML = "<p class='helper-text'>没有找到符合当前条件的座位，请调整标签或切换分区。</p>";
    return;
  }

  dom.seatGrid.innerHTML = seats
    .map((seat) => {
      const selected = seat.seatId === state.selectedSeatId;
      const reserved = state.reservedSeatIds.has(seat.seatId);
      const actionLabel = reserved ? "已加入草稿" : selected ? "保持当前选择" : "选中座位";

      return `
        <article class="seat-card" data-selected="${selected}">
          <div class="seat-head">
            <div>
              <h3 class="seat-title">${seat.seatId}</h3>
              <p class="seat-subtitle">${seat.zoneDisplayName} · ${seat.tableGroupCode}</p>
            </div>
            <div class="seat-head-tags">
              <span class="score-badge">${computeSeatScore(seat)} 分</span>
              <span class="status-badge ${selected ? "status-badge--selected" : ""}">${reserved ? "已加入草稿" : "可选"}</span>
            </div>
          </div>

          <p class="seat-info">
            ${seat.seatType} · ${seat.quietLevel} · ${seat.hasPower ? "有插座" : "无插座"} ·
            ${seat.nearWindow ? "靠窗" : "内侧"} · ${seat.nearCorridor ? "靠近通道" : "位置避静"}
          </p>

          <div class="chip-list">
            ${seat.rawTags.slice(0, 5).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("")}
          </div>

          <button class="seat-action" data-seat-id="${seat.seatId}" data-selected="${selected}" ${reserved ? "disabled" : ""}>
            ${actionLabel}
          </button>
        </article>
      `;
    })
    .join("");

  if (state.topOnly && totalCount > seats.length) {
    dom.seatGrid.insertAdjacentHTML(
      "beforeend",
      "<p class='helper-text'>当前只展示推荐前 12 个结果，点击上方按钮可以查看完整列表。</p>"
    );
  }
}

function getVisibleSeats() {
  return state.seats.filter((seat) => {
    if (state.activeZone && seat.zoneCode !== state.activeZone) {
      return false;
    }

    if (state.search && !seat.searchText.includes(state.search)) {
      return false;
    }

    for (const filterKey of state.activeFilters) {
      if (!seat.tagKeys.includes(filterKey)) {
        return false;
      }
    }

    return true;
  }).sort(compareSeatsByScore);
}

function getZoneMatchCounts() {
  const counts = new Map(state.zones.map((zone) => [zone.zoneCode, 0]));

  state.seats.forEach((seat) => {
    if (state.search && !seat.searchText.includes(state.search)) {
      return;
    }

    for (const filterKey of state.activeFilters) {
      if (!seat.tagKeys.includes(filterKey)) {
        return;
      }
    }

    counts.set(seat.zoneCode, (counts.get(seat.zoneCode) || 0) + 1);
  });

  return counts;
}

function shouldUseMatchedCount() {
  return Boolean(state.search) || state.activeFilters.size > 0;
}

function getSelectedSeat() {
  return state.seats.find((seat) => seat.seatId === state.selectedSeatId) || null;
}

function computeSeatScore(seat) {
  let score = 50;

  state.activeFilters.forEach((filterKey) => {
    if (seat.tagKeys.includes(filterKey)) {
      score += 8;
    }
  });

  if (seat.hasPower) {
    score += 7;
  }
  if (seat.nearWindow) {
    score += 5;
  }
  if (seat.quietLevel === "安静") {
    score += 9;
  }
  if (!seat.nearCorridor) {
    score += 6;
  }
  if (!seat.nearRestroom) {
    score += 3;
  }
  if (!seat.nearPantry) {
    score += 2;
  }
  if (!seat.nearAC) {
    score += 4;
  }
  if (state.activeZone && seat.zoneCode === state.activeZone) {
    score += 6;
  }
  if (state.reservedSeatIds.has(seat.seatId)) {
    score -= 20;
  }

  return score;
}

function compareSeatsByScore(a, b) {
  return (
    computeSeatScore(b) - computeSeatScore(a) ||
    compareSeatIds(a.seatId, b.seatId)
  );
}

function compareSeatIds(a, b) {
  return a.localeCompare(b, "zh-CN", { numeric: true });
}

function compareZones(a, b) {
  const bandOrder = ["north", "west", "east", "south_inner", "south_outer", "inner"];
  const bandDiff = bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band);
  if (bandDiff !== 0) {
    return bandDiff;
  }

  if (a.band === "west" || a.band === "east") {
    return b.gridLetter.localeCompare(a.gridLetter);
  }

  return a.gridNumber - b.gridNumber || a.gridLetter.localeCompare(b.gridLetter);
}

function buildReasonList(seat) {
  const reasons = [];

  if (state.activeFilters.size) {
    Array.from(state.activeFilters).forEach((filterKey) => {
      const option = FILTER_OPTIONS.find((item) => item.key === filterKey);
      if (option && seat.tagKeys.includes(filterKey)) {
        reasons.push(`命中“${option.label}”偏好`);
      }
    });
  }

  if (seat.hasPower) {
    reasons.push("支持电脑与平板连续使用");
  }
  if (seat.nearWindow) {
    reasons.push("靠窗采光更好");
  }
  if (seat.quietLevel === "安静") {
    reasons.push("安静区更适合专注");
  }
  if (!seat.nearCorridor) {
    reasons.push("远离主通道干扰较少");
  }
  if (!seat.nearAC) {
    reasons.push("不在空调直吹位");
  }

  return reasons.slice(0, 4);
}

function pickTopTags(seats) {
  const counts = {};
  seats.forEach((seat) => {
    seat.rawTags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 5)
    .map(([tag]) => tag);
}

function countBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function groupBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(item);
    return accumulator;
  }, {});
}

function describeBand(band) {
  const labels = {
    north: "北侧阅读带",
    west: "西侧阅读带",
    east: "东侧阅读带",
    south_inner: "南侧内圈",
    south_outer: "南侧外圈",
    inner: "中部区域",
  };
  return labels[band] || band;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showStatus(message) {
  dom.appStatus.textContent = message;
  dom.appStatus.classList.remove("hidden");
}
