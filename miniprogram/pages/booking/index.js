const api = require("../../services/api");
const { getOffsetDate } = require("../../utils/date");
const { ensureLoggedIn } = require("../../utils/auth");
const { openPage } = require("../../utils/navigation");
const {
  decorateSeatFeaturePreview,
  toggleSeatFeaturePreview: toggleSeatFeaturePreviewState
} = require("../../utils/seat-feature");

function parseSeatRouteInfo(seatId = "") {
  const segments = String(seatId || "").split("-").filter(Boolean);
  return {
    zoneCode: segments[0] || ""
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function getWeekdayLabel(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function getRelativeDayLabel(offset) {
  if (offset === 0) {
    return "今天";
  }
  if (offset === 1) {
    return "明天";
  }
  if (offset === 2) {
    return "后天";
  }
  return "";
}

const CALENDAR_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function parseDateValue(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function buildDateOptions(selectedDate, advanceDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: Math.max(Number(advanceDays || 0), 0) + 1 }, (_, index) => {
    const current = new Date(today);
    current.setDate(today.getDate() + index);
    const value = formatDate(current);
    const relativeLabel = getRelativeDayLabel(index);

    return {
      value,
      selected: value === selectedDate,
      dayText: `${current.getMonth() + 1}/${current.getDate()}`,
      weekText: getWeekdayLabel(current),
      relativeLabel: relativeLabel || "可预约"
    };
  });
}

function buildCalendarMonths(dateOptions, selectedDate) {
  if (!dateOptions.length) {
    return [];
  }

  const availableMap = new Map(dateOptions.map((item) => [item.value, item]));
  const firstDate = parseDateValue(dateOptions[0].value);
  const lastDate = parseDateValue(dateOptions[dateOptions.length - 1].value);

  if (!firstDate || !lastDate) {
    return [];
  }

  const months = [];
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  const endCursor = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);

  while (cursor <= endCursor) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const weeks = [];

    for (let start = 0; start < totalCells; start += 7) {
      const days = Array.from({ length: 7 }, (_, offset) => {
        const gridIndex = start + offset;
        const dayNumber = gridIndex - firstWeekday + 1;

        if (dayNumber < 1 || dayNumber > daysInMonth) {
          return {
            key: `${year}-${month + 1}-empty-${gridIndex}`,
            empty: true,
            value: "",
            dayText: "",
            helperText: "",
            isAvailable: false,
            selected: false
          };
        }

        const currentDate = new Date(year, month, dayNumber);
        const value = formatDate(currentDate);
        const matchedOption = availableMap.get(value);

        return {
          key: value,
          empty: false,
          value,
          dayText: String(dayNumber),
          helperText: matchedOption ? matchedOption.relativeLabel : "",
          isAvailable: Boolean(matchedOption),
          selected: value === selectedDate
        };
      });

      weeks.push({
        key: `${year}-${month + 1}-week-${start}`,
        days
      });
    }

    months.push({
      key: `${year}-${month + 1}`,
      title: `${year}年${month + 1}月`,
      weeks
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function buildSelectedDateSummary(dateOptions, selectedDate) {
  const matched = (dateOptions || []).find((item) => item.value === selectedDate);

  if (!matched) {
    return {
      title: selectedDate || "--",
      note: "请选择日期"
    };
  }

  return {
    title: `${matched.dayText} ${matched.weekText}`,
    note: matched.relativeLabel || "可预约"
  };
}

function normalizeTimeText(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hours, minutes] = raw.split(":").map(Number);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${pad(hours)}:${pad(minutes)}`;
    }
    return "";
  }

  if (/^\d{3,4}$/.test(raw)) {
    const normalized = raw.length === 3 ? `0${raw}` : raw;
    const hours = Number(normalized.slice(0, 2));
    const minutes = Number(normalized.slice(2));
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${pad(hours)}:${pad(minutes)}`;
    }
  }

  return "";
}

function timeToMinutes(value) {
  const normalized = normalizeTimeText(value);
  if (!normalized) {
    return null;
  }
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Number(value || 0));
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function getReservationStatusText(status) {
  switch (status) {
    case "checked_in":
      return "使用中";
    case "temporary_leave":
      return "暂离";
    case "reserved":
      return "已预约";
    default:
      return "占用";
  }
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function buildTimelineBarStyle(startMinutes, endMinutes, openMinutes, closeMinutes) {
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return "";
  }

  const totalMinutes = Math.max(closeMinutes - openMinutes, 1);
  const visibleStart = Math.max(openMinutes, Math.min(closeMinutes, startMinutes));
  const visibleEnd = Math.max(openMinutes, Math.min(closeMinutes, endMinutes));

  if (visibleEnd <= visibleStart) {
    return "";
  }

  const left = ((visibleStart - openMinutes) / totalMinutes) * 100;
  const width = ((visibleEnd - visibleStart) / totalMinutes) * 100;
  return `left:${left.toFixed(2)}%;width:${Math.max(3, width).toFixed(2)}%;`;
}

function buildSeatScheduleView(schedule, startTime, endTime) {
  const parsedOpenMinutes = timeToMinutes(schedule && schedule.openTime);
  const parsedCloseMinutes = timeToMinutes(schedule && schedule.closeTime);
  const openMinutes = parsedOpenMinutes !== null ? parsedOpenMinutes : 8 * 60;
  const closeMinutes = parsedCloseMinutes !== null ? parsedCloseMinutes : 22 * 60;
  const slotMinutes = Math.max(Number((schedule && schedule.slotMinutes) || 30), 15);
  const selectedStart = timeToMinutes(startTime);
  const selectedEnd = timeToMinutes(endTime);
  const occupied = (schedule && schedule.occupied || []).map((item) => ({
    ...item,
    statusText: getReservationStatusText(item.status),
    startMinutes: timeToMinutes(item.startTime),
    endMinutes: timeToMinutes(item.endTime)
  })).filter((item) => item.startMinutes !== null && item.endMinutes !== null);
  const totalMinutes = Math.max(closeMinutes - openMinutes, slotMinutes);
  const slots = [];

  for (let cursor = openMinutes; cursor < closeMinutes; cursor += slotMinutes) {
    const slotStart = cursor;
    const slotEnd = Math.min(cursor + slotMinutes, closeMinutes);
    const occupiedItem = occupied.find((item) => overlaps(slotStart, slotEnd, item.startMinutes, item.endMinutes));
    const selected = selectedStart !== null && selectedEnd !== null && overlaps(slotStart, slotEnd, selectedStart, selectedEnd);
    slots.push({
      key: `${slotStart}-${slotEnd}`,
      label: minutesToTime(slotStart),
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      rangeText: `${minutesToTime(slotStart)}-${minutesToTime(slotEnd)}`,
      occupied: Boolean(occupiedItem),
      selected,
      tone: occupiedItem ? "occupied" : (selected ? "selected" : "free"),
      statusText: occupiedItem ? occupiedItem.statusText : (selected ? "待预约" : "空闲")
    });
  }

  const occupiedItems = occupied.map((item) => {
    const barStyle = buildTimelineBarStyle(item.startMinutes, item.endMinutes, openMinutes, closeMinutes);
    return {
      ...item,
      timeText: `${item.startTime}-${item.endTime}`,
      barStyle
    };
  }).filter((item) => item.barStyle);

  const selectedConflicts = selectedStart !== null && selectedEnd !== null && selectedEnd > selectedStart
    ? occupied.some((item) => overlaps(selectedStart, selectedEnd, item.startMinutes, item.endMinutes))
    : false;

  const selectedBarStyle = selectedStart !== null && selectedEnd !== null && selectedEnd > selectedStart
    ? buildTimelineBarStyle(selectedStart, selectedEnd, openMinutes, closeMinutes)
    : "";
  const selectedBar = selectedBarStyle
    ? {
        timeText: `${startTime}-${endTime}`,
        barStyle: selectedBarStyle
      }
    : null;
  const ticks = [
    { key: "open", label: minutesToTime(openMinutes), left: 0, align: "start" },
    { key: "middle", label: minutesToTime(openMinutes + Math.floor(totalMinutes / 2)), left: 50, align: "middle" },
    { key: "close", label: minutesToTime(closeMinutes), left: 100, align: "end" }
  ];

  return {
    slots,
    occupiedItems,
    selectedBar,
    selectedConflicts,
    ticks,
    summary: occupiedItems.length
      ? (selectedConflicts ? "所选时段与已占用区间重叠" : `已占用 ${occupiedItems.length} 段，可避开红色区间。`)
      : "暂无占用，可直接选择。",
    rangeText: `${minutesToTime(openMinutes)}-${minutesToTime(closeMinutes)}`
  };
}

function decorateSeat(seat) {
  if (!seat) {
    return null;
  }

  return decorateSeatFeaturePreview({
    ...seat,
    displayScore: seat.recommendationBadge || (seat.score ? `${seat.score} 分` : ""),
    summaryTags: (seat.reasons && seat.reasons.length ? seat.reasons : seat.rawTags || []).slice(0, 6),
    metaCards: [
      { label: "分区", value: seat.zoneDisplayName || seat.zoneCode || "--" },
      { label: "桌组", value: seat.tableGroupCode || "--" },
      { label: "座位类型", value: seat.seatType || "--" },
      { label: "当前状态", value: seat.statusLabel || "--" }
    ]
  });
}

function decorateValidationChecks(checks) {
  return (checks || []).map((item) => ({
    ...item,
    tone: item.passed ? "passed" : "failed",
    statusText: item.passed ? "通过" : "未通过"
  }));
}

Page({
  data: {
    loading: true,
    validating: false,
    submitting: false,
    serviceMode: "实时连接",
    advanceDays: 3,
    dateOptions: [],
    calendarMonths: [],
    calendarWeekdays: CALENDAR_WEEKDAYS,
    calendarExpanded: false,
    selectedDateTitle: "",
    selectedDateNote: "",
    seatId: "",
    zoneCode: "",
    seat: null,
    reservationDate: getOffsetDate(1),
    startTime: "09:00",
    endTime: "11:00",
    startTimeInput: "09:00",
    endTimeInput: "11:00",
    validationResult: null,
    validationChecks: [],
    seatSchedule: null,
    scheduleSlots: [],
    occupiedTimelineItems: [],
    selectedTimelineBar: null,
    timelineTicks: [],
    scheduleConflict: false,
    scheduleSummary: "",
    scheduleRangeText: ""
  },

  onLoad(options) {
    const seatId = String((options && options.seatId) || "").trim();
    const routeInfo = parseSeatRouteInfo(seatId);
    const zoneCode = String((options && options.zoneCode) || routeInfo.zoneCode || "").trim();
    const reservationDate = String((options && options.reservationDate) || getOffsetDate(1)).trim();
    const startTime = normalizeTimeText((options && options.startTime) || "09:00") || "09:00";
    const endTime = normalizeTimeText((options && options.endTime) || "11:00") || "11:00";
    const redirectUrl = `/pages/booking/index?seatId=${encodeURIComponent(seatId)}&zoneCode=${encodeURIComponent(zoneCode)}&reservationDate=${encodeURIComponent(reservationDate)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
    const currentUser = ensureLoggedIn(redirectUrl);

    if (!currentUser) {
      return;
    }

    if (!seatId) {
      wx.showToast({
        title: "未识别到座位",
        icon: "none"
      });
      this.openSeatPage();
      return;
    }

    this.setData({
      seatId,
      zoneCode,
      reservationDate,
      startTime,
      endTime,
      startTimeInput: startTime,
      endTimeInput: endTime
    });

    this.loadPage();
  },

  getSeatQueryParams() {
    return {
      zoneCode: this.data.zoneCode,
      search: this.data.seatId,
      reservationDate: this.data.reservationDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime,
      limit: 20
    };
  },

  updateDateOptions() {
    const dateOptions = buildDateOptions(this.data.reservationDate, this.data.advanceDays);
    const selectedSummary = buildSelectedDateSummary(dateOptions, this.data.reservationDate);

    this.setData({
      dateOptions,
      calendarMonths: buildCalendarMonths(dateOptions, this.data.reservationDate),
      selectedDateTitle: selectedSummary.title,
      selectedDateNote: selectedSummary.note
    });
  },

  async loadPage() {
    this.setData({
      loading: true
    });

    try {
      const [rulesResponse, seatResponse, scheduleResponse] = await Promise.all([
        api.getRules(),
        api.getSeats(this.getSeatQueryParams()),
        api.getSeatSchedule(this.data.seatId, {
          reservationDate: this.data.reservationDate
        })
      ]);

      const activeRules = rulesResponse.rules || rulesResponse || {};
      const matchedSeat = (seatResponse.items || []).find((item) => item.seatId === this.data.seatId) || null;
      const scheduleView = buildSeatScheduleView(scheduleResponse, this.data.startTime, this.data.endTime);
      this.setData({
        loading: false,
        serviceMode: "实时连接",
        advanceDays: Number(activeRules.advanceDays || 3),
        seat: decorateSeat(matchedSeat),
        seatSchedule: scheduleResponse,
        scheduleSlots: scheduleView.slots,
        occupiedTimelineItems: scheduleView.occupiedItems,
        selectedTimelineBar: scheduleView.selectedBar,
        timelineTicks: scheduleView.ticks,
        scheduleConflict: scheduleView.selectedConflicts,
        scheduleSummary: scheduleView.summary,
        scheduleRangeText: scheduleView.rangeText,
        validationResult: null,
        validationChecks: []
      }, () => {
        this.updateDateOptions();
      });

      if (!matchedSeat) {
        wx.showToast({
          title: "未找到该座位",
          icon: "none"
        });
      }
    } catch (error) {
      this.setData({
        loading: false
      });
      wx.showToast({
        title: error.message || "预约页加载失败",
        icon: "none"
      });
    }
  },

  openSeatPage() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    openPage("/pages/seat/index");
  },

  async refreshSeatAvailability() {
    try {
      const [response, scheduleResponse] = await Promise.all([
        api.getSeats(this.getSeatQueryParams()),
        api.getSeatSchedule(this.data.seatId, {
          reservationDate: this.data.reservationDate
        })
      ]);
      const matchedSeat = (response.items || []).find((item) => item.seatId === this.data.seatId) || null;
      const scheduleView = buildSeatScheduleView(scheduleResponse, this.data.startTime, this.data.endTime);

      this.setData({
        seat: decorateSeat(matchedSeat),
        seatSchedule: scheduleResponse,
        scheduleSlots: scheduleView.slots,
        occupiedTimelineItems: scheduleView.occupiedItems,
        selectedTimelineBar: scheduleView.selectedBar,
        timelineTicks: scheduleView.ticks,
        scheduleConflict: scheduleView.selectedConflicts,
        scheduleSummary: scheduleView.summary,
        scheduleRangeText: scheduleView.rangeText,
        validationResult: null,
        validationChecks: []
      });
    } catch (error) {
      wx.showToast({
        title: error.message || "座位状态刷新失败",
        icon: "none"
      });
    }
  },

  selectDateOption(event) {
    const { value } = event.currentTarget.dataset;
    const selectable = (this.data.dateOptions || []).some((item) => item.value === value);
    if (!value || !selectable || value === this.data.reservationDate) {
      return;
    }

    this.setData({
      reservationDate: value
    }, () => {
      this.updateDateOptions();
      this.refreshSeatAvailability();
    });
  },

  toggleCalendar() {
    this.setData({
      calendarExpanded: !this.data.calendarExpanded
    });
  },

  onStartTimeInput(event) {
    this.setData({
      startTimeInput: event.detail.value || ""
    });
  },

  onEndTimeInput(event) {
    this.setData({
      endTimeInput: event.detail.value || ""
    });
  },

  commitTimeField(fieldKey, inputKey, shouldRefresh = true) {
    const normalized = normalizeTimeText(this.data[inputKey]);
    if (!normalized) {
      wx.showToast({
        title: "时间格式请使用 HH:mm",
        icon: "none"
      });
      this.setData({
        [inputKey]: this.data[fieldKey]
      });
      return false;
    }

    this.setData({
      [fieldKey]: normalized,
      [inputKey]: normalized
    }, () => {
      if (shouldRefresh) {
        this.refreshSeatAvailability();
      } else if (this.data.seatSchedule) {
        const scheduleView = buildSeatScheduleView(this.data.seatSchedule, this.data.startTime, this.data.endTime);
        this.setData({
          scheduleSlots: scheduleView.slots,
          occupiedTimelineItems: scheduleView.occupiedItems,
          selectedTimelineBar: scheduleView.selectedBar,
          timelineTicks: scheduleView.ticks,
          scheduleConflict: scheduleView.selectedConflicts,
          scheduleSummary: scheduleView.summary,
          scheduleRangeText: scheduleView.rangeText
        });
      }
    });

    return true;
  },

  selectScheduleSlot(event) {
    const { startTime, endTime, occupied } = event.currentTarget.dataset;
    if (!startTime || !endTime) {
      return;
    }

    if (occupied === true || occupied === "true") {
      wx.showToast({
        title: "该时间段已被占用",
        icon: "none"
      });
      return;
    }

    this.setData({
      startTime,
      endTime,
      startTimeInput: startTime,
      endTimeInput: endTime
    }, () => {
      this.refreshSeatAvailability();
    });
  },

  onStartTimeBlur() {
    this.commitTimeField("startTime", "startTimeInput");
  },

  onEndTimeBlur() {
    this.commitTimeField("endTime", "endTimeInput");
  },

  toggleSeatFeaturePreview() {
    if (!this.data.seat) {
      return;
    }

    this.setData({
      seat: toggleSeatFeaturePreviewState(this.data.seat)
    });
  },

  async handlePreviewReservation() {
    if (!this.data.seat) {
      wx.showToast({
        title: "请先返回重新选择座位",
        icon: "none"
      });
      return;
    }

    const startValid = this.commitTimeField("startTime", "startTimeInput", false);
    const endValid = this.commitTimeField("endTime", "endTimeInput", false);
    if (!startValid || !endValid) {
      return;
    }

    this.setData({
      validating: true
    });

    try {
      const response = await api.previewReservation({
        seatId: this.data.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      this.setData({
        validating: false,
        validationResult: response,
        validationChecks: decorateValidationChecks(response.checks || [])
      });
    } catch (error) {
      this.setData({
        validating: false
      });
      wx.showToast({
        title: error.message || "预约校验失败",
        icon: "none"
      });
    }
  },

  async handleCreateReservation() {
    if (!this.data.seat) {
      wx.showToast({
        title: "请先返回重新选择座位",
        icon: "none"
      });
      return;
    }

    const startValid = this.commitTimeField("startTime", "startTimeInput", false);
    const endValid = this.commitTimeField("endTime", "endTimeInput", false);
    if (!startValid || !endValid) {
      return;
    }

    if (!this.data.seat.canReserve) {
      wx.showToast({
        title: this.data.seat.statusDescription || "该时段当前不可预约",
        icon: "none"
      });
      return;
    }

    this.setData({
      submitting: true
    });

    try {
      const preview = await api.previewReservation({
        seatId: this.data.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      this.setData({
        validationResult: preview,
        validationChecks: decorateValidationChecks(preview.checks || [])
      });

      if (!preview.valid) {
        this.setData({
          submitting: false
        });
        return;
      }

      const result = await api.createReservation({
        seatId: this.data.seatId,
        reservationDate: this.data.reservationDate,
        startTime: this.data.startTime,
        endTime: this.data.endTime
      });

      this.setData({
        submitting: false
      });

      wx.showModal({
        title: "预约成功",
        content: `${result.seatId} 已预约成功\n${result.reservationDate} ${result.startTime}-${result.endTime}`,
        showCancel: false,
        success: () => {
          openPage("/pages/reservation/index");
        }
      });
    } catch (error) {
      this.setData({
        submitting: false
      });

      if (error.code === "RESERVATION_VALIDATION_FAILED" && error.payload) {
        this.setData({
          validationResult: error.payload,
          validationChecks: decorateValidationChecks(error.payload.checks || [])
        });
      }

      wx.showToast({
        title: error.message || "预约失败",
        icon: "none"
      });
    }
  }
});
