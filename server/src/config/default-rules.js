const defaultRules = {
  openTime: "06:30",
  closeTime: "22:30",
  advanceDays: 3,
  minReservationMinutes: 30,
  maxReservationMinutes: 240,
  maxActiveReservations: 1,
  maxDailyReservations: 2,
  cancelBeforeMinutes: 15,
  checkinAllowBeforeMinutes: 10,
  checkinAllowAfterMinutes: 15,
  checkinLocationLatitude: 25.793041,
  checkinLocationLongitude: 114.763803,
  checkinLocationRadiusMeters: 100,
  maxLeaveTimes: 2,
  maxLeaveMinutesEach: 60,
  maxLeaveMinutesTotal: 60,
  initialCreditScore: 100,
  blacklistCreditThreshold: 60,
  blacklistDays: 7,
  penalties: {
    noShow: 10,
    leaveTimeout: 15,
    severe: 20
  }
};

const filterOptions = [
  { key: "power_outlet", label: "有插座", description: "适合带电脑或平板长时间学习" },
  { key: "window", label: "靠窗", description: "白天采光更好" },
  { key: "quiet", label: "安静", description: "优先筛出更适合专注的座位" },
  { key: "balanced_temperature", label: "温度均衡", description: "避开空调直吹区域" },
  { key: "quiet_position", label: "避开通道", description: "走动干扰相对更少" },
  { key: "table_4", label: "4人桌", description: "适合单人或双人学习" },
  { key: "table_8", label: "8人桌", description: "适合结伴自习或小组使用" },
  { key: "near_bookshelf", label: "靠近书架", description: "适合拿纸质书查阅" },
  { key: "near_restroom", label: "靠近卫生间", description: "适合短时停留" },
  { key: "sunlight_yes", label: "光照充足", description: "白天更明亮" }
];

const scenePresets = [
  {
    key: "sprint",
    label: "冲刺学习",
    description: "优先选有插座、安静、避开通道且温度均衡的位置",
    filters: ["power_outlet", "quiet", "quiet_position", "balanced_temperature"]
  },
  {
    key: "window",
    label: "临窗阅读",
    description: "优先挑选靠窗且采光较好的座位",
    filters: ["window", "quiet", "sunlight_yes"]
  },
  {
    key: "group",
    label: "结伴自习",
    description: "更适合多人同桌和设备使用",
    filters: ["table_8", "power_outlet", "balanced_temperature"]
  }
];

const statusLabels = {
  reserved: "待签到",
  checked_in: "已签到",
  temporary_leave: "暂离中",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未签到违约",
  violation: "违约结束",
  admin_released: "管理员释放"
};

module.exports = {
  defaultRules,
  filterOptions,
  scenePresets,
  statusLabels
};
