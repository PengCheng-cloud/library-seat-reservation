const { filterOptions, scenePresets } = require("../config/default-rules");

const FILTER_KEYWORD_MAP = [
  {
    key: "power_outlet",
    keywords: ["插座", "充电", "电脑", "笔记本", "平板", "设备", "写代码", "编程", "作业"],
    reason: "识别到设备用电需求"
  },
  {
    key: "window",
    keywords: ["靠窗", "窗边", "窗户", "临窗"],
    reason: "识别到临窗视野需求"
  },
  {
    key: "quiet",
    keywords: ["安静", "安静点", "专注", "自习", "学习", "考研", "复习", "备考", "沉浸"],
    reason: "识别到安静专注需求"
  },
  {
    key: "balanced_temperature",
    keywords: ["空调别吹", "温度均衡", "不冷", "不热", "温度舒服", "舒适"],
    reason: "识别到温度舒适需求"
  },
  {
    key: "quiet_position",
    keywords: ["避开通道", "不要通道", "少人走动", "不要太吵", "不想被打扰"],
    reason: "识别到避开走动干扰需求"
  },
  {
    key: "table_4",
    keywords: ["4人桌", "四人桌", "小桌", "两三个人", "双人", "小组小桌"],
    reason: "识别到小桌偏好"
  },
  {
    key: "table_8",
    keywords: ["8人桌", "八人桌", "大桌", "多人桌", "结伴", "一起", "讨论", "小组讨论", "协作"],
    reason: "识别到多人桌偏好"
  },
  {
    key: "near_bookshelf",
    keywords: ["书架", "找书", "查资料", "纸质书", "文献"],
    reason: "识别到靠近书架需求"
  },
  {
    key: "near_restroom",
    keywords: ["卫生间", "洗手间", "厕所", "短时间", "临时停留"],
    reason: "识别到短时便利需求"
  },
  {
    key: "sunlight_yes",
    keywords: ["采光", "阳光", "光照", "亮一点", "白天看书"],
    reason: "识别到采光需求"
  }
];

const SCENE_RULES = [
  {
    key: "group",
    keywords: ["结伴", "一起", "讨论", "小组", "协作", "组会", "交流"],
    reason: "识别到协作学习场景"
  },
  {
    key: "window",
    keywords: ["靠窗", "窗边", "阅读", "采光", "阳光", "看书"],
    reason: "识别到临窗阅读场景"
  },
  {
    key: "sprint",
    keywords: ["冲刺", "考研", "复习", "备考", "专注", "安静", "刷题", "长时间学习"],
    reason: "识别到冲刺学习场景"
  }
];

const TIME_RULES = [
  {
    key: "morning",
    keywords: ["早上", "上午", "清晨"],
    startTime: "08:00",
    endTime: "11:00",
    label: "上午时段"
  },
  {
    key: "afternoon",
    keywords: ["下午", "午后"],
    startTime: "14:00",
    endTime: "17:00",
    label: "下午时段"
  },
  {
    key: "night",
    keywords: ["晚上", "夜间", "晚自习"],
    startTime: "18:30",
    endTime: "21:00",
    label: "晚间时段"
  }
];

function uniqueByKey(items, keyName) {
  const used = new Set();
  return (items || []).filter((item) => {
    const value = item && item[keyName];
    if (!value || used.has(value)) {
      return false;
    }
    used.add(value);
    return true;
  });
}

function parseMessage(message = "") {
  const text = String(message || "").trim();
  const matchedFilters = [];
  const matchedScenes = [];
  const matchedTimes = [];

  FILTER_KEYWORD_MAP.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      const filterMeta = filterOptions.find((item) => item.key === rule.key) || { key: rule.key, label: rule.key };
      matchedFilters.push({
        key: rule.key,
        label: filterMeta.label,
        keyword,
        reason: rule.reason
      });
    }
  });

  SCENE_RULES.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      const sceneMeta = scenePresets.find((item) => item.key === rule.key) || { key: rule.key, label: rule.key };
      matchedScenes.push({
        key: rule.key,
        label: sceneMeta.label,
        description: sceneMeta.description || "",
        keyword,
        reason: rule.reason
      });
    }
  });

  TIME_RULES.forEach((rule) => {
    const keyword = rule.keywords.find((item) => text.includes(item));
    if (keyword) {
      matchedTimes.push({
        key: rule.key,
        label: rule.label,
        keyword,
        startTime: rule.startTime,
        endTime: rule.endTime
      });
    }
  });

  const filters = uniqueByKey(matchedFilters, "key");
  const scene = uniqueByKey(matchedScenes, "key")[0] || null;
  const timeWindow = uniqueByKey(matchedTimes, "key")[0] || null;

  if (scene) {
    const scenePreset = scenePresets.find((item) => item.key === scene.key);
    (scenePreset && scenePreset.filters || []).forEach((filterKey) => {
      if (!filters.find((item) => item.key === filterKey)) {
        const filterMeta = filterOptions.find((item) => item.key === filterKey) || { key: filterKey, label: filterKey };
        filters.push({
          key: filterKey,
          label: filterMeta.label,
          keyword: scene.label,
          reason: `根据“${scene.label}”场景补充偏好`
        });
      }
    });
  }

  return {
    text,
    filters,
    scene,
    timeWindow
  };
}

function buildAssistantSummary(parsed, result) {
  const topSeat = (result.topRecommendations || [])[0] || null;
  const filterText = parsed.filters.length
    ? `已识别 ${parsed.filters.length} 项偏好`
    : "未识别到明确硬性偏好";
  const sceneText = parsed.scene ? `，场景倾向为“${parsed.scene.label}”` : "";
  const seatText = topSeat ? `，当前首推座位是 ${topSeat.seatId}` : "，当前暂无可直接推荐的首选座位";

  return `${filterText}${sceneText}${seatText}。`;
}

function buildAnalysisSteps(parsed, result) {
  const steps = [];
  const algorithmEvidence = result && (result.algorithmEvidence ||
    (result.recommendationSummary && result.recommendationSummary.algorithmEvidence));

  if (parsed.filters.length) {
    steps.push({
      title: "需求解析",
      content: `从自然语言中识别到 ${parsed.filters.map((item) => item.label).join("、")} 等偏好条件。`
    });
  }

  if (parsed.scene) {
    steps.push({
      title: "场景识别",
      content: `将当前需求归入“${parsed.scene.label}”场景，并补充对应偏好约束。`
    });
  }

  steps.push({
    title: "推荐排序",
    content: algorithmEvidence && algorithmEvidence.deploymentModelName
      ? (String(algorithmEvidence.taskType || "").includes("匹配")
        ? `${algorithmEvidence.inferenceModeText || "接入匹配模型"}；在满足当前时间窗与可预约约束后，将同一条需求与候选座位批量组合，并结合${algorithmEvidence.deploymentModelName}输出的匹配概率、偏好命中和冲突惩罚进行排序。`
        : `${algorithmEvidence.inferenceModeText || "接入模型预测"}；在满足当前时间窗与可预约约束后，结合${algorithmEvidence.deploymentModelName}的多标签预测结果、四类概率折算分和偏好命中情况进行排序。`)
      : "在满足当前时间窗与可预约约束后，将需求与候选座位组合成匹配样本，并结合偏好命中和冲突项进行排序。"
  });

  if (algorithmEvidence && algorithmEvidence.deepLearningModelName) {
    steps.push({
      title: "实验依据",
      content: `${algorithmEvidence.deploymentModelName}作为小程序部署模型；${algorithmEvidence.deepLearningModelName}作为同一数据集下的深度学习对比模型。`
    });
  }

  return steps;
}

function buildAssistantSeatItem(item, index) {
  return {
    rank: index + 1,
    seatId: item.seatId,
    zoneCode: item.zoneCode,
    zoneDisplayName: item.zoneDisplayName,
    tableGroupCode: item.tableGroupCode,
    recommendationBadge: item.recommendationBadge,
    fitPercent: item.fitPercent,
    matchedFilterCount: item.matchedFilterCount,
    missingFilters: item.missingFilters || [],
    missingFiltersText: (item.missingFilters || []).join("、"),
    sceneModelLabel: item.sceneModelLabel,
    sceneModelConfidenceText: item.sceneModelConfidenceText,
    matchingPercentText: item.matchingPercentText || "",
    matchingLabel: item.matchingLabel || "",
    algorithmTaskType: item.algorithmTaskType || "",
    algorithmDatasetName: item.algorithmDatasetName || "",
    algorithmModelName: item.algorithmModelName || "",
    algorithmModelShortName: item.algorithmModelShortName || "",
    deploymentModelMacroF1Text: item.deploymentModelMacroF1Text || "",
    deploymentModelMicroF1Text: item.deploymentModelMicroF1Text || "",
    deepLearningModelName: item.deepLearningModelName || "",
    deepLearningModelMacroF1Text: item.deepLearningModelMacroF1Text || "",
    deepLearningModelMicroF1Text: item.deepLearningModelMicroF1Text || "",
    predictedLabels: item.predictedLabels || [],
    predictedLabelsText: item.predictedLabelsText || "",
    actualLabels: item.actualLabels || [],
    actualLabelsText: item.actualLabelsText || "",
    labelScoreItems: item.labelScoreItems || [],
    modelEvidence: item.modelEvidence || [],
    labelScoresText: item.labelScoresText || "",
    primaryLabelScoreText: item.primaryLabelScoreText || "",
    neuralPredictedLabels: item.neuralPredictedLabels || [],
    neuralPredictedLabelsText: item.neuralPredictedLabelsText || "",
    neuralPrimaryLabel: item.neuralPrimaryLabel || "",
    neuralPrimaryConfidence: item.neuralPrimaryConfidence || 0,
    neuralConfidenceText: item.neuralConfidenceText || "",
    neuralScoresText: item.neuralScoresText || "",
    neuralAgreement: Boolean(item.neuralAgreement),
    fusionPrimaryLabel: item.fusionPrimaryLabel || "",
    fusionConfidenceText: item.fusionConfidenceText || "",
    modelFusionText: item.modelFusionText || "",
    reasons: (item.reasons || []).slice(0, 4)
  };
}

function buildSeatAssistantResponse(message, result, options = {}) {
  const parsed = parseMessage(message);
  const candidateSeats = (result.items || [])
    .filter((item) => item.canReserve)
    .map((item, index) => buildAssistantSeatItem(item, index));
  const topSeats = candidateSeats.slice(0, 3);
  const primarySeat = topSeats[0] || null;
  const primaryZone = primarySeat ? primarySeat.zoneCode : "";
  const algorithmEvidence = result.algorithmEvidence ||
    (result.recommendationSummary && result.recommendationSummary.algorithmEvidence) ||
    null;

  return {
    queryText: parsed.text,
    recognizedFilters: parsed.filters,
    recognizedFilterCount: parsed.filters.length,
    scene: parsed.scene,
    timeWindow: parsed.timeWindow || null,
    summaryTitle: parsed.scene ? `${parsed.scene.label} AI 推荐` : "AI 需求解析结果",
    summaryText: buildAssistantSummary(parsed, result),
    analysisSteps: buildAnalysisSteps(parsed, result),
    algorithmEvidence,
    applyPlan: {
      filters: parsed.filters.map((item) => item.key),
      zoneCode: primaryZone,
      seatId: primarySeat ? primarySeat.seatId : "",
      sceneKey: parsed.scene ? parsed.scene.key : "",
      softPreferenceMode: true,
      message: parsed.text,
      reservationDate: options.reservationDate || "",
      startTime: (parsed.timeWindow && parsed.timeWindow.startTime) || options.startTime || "",
      endTime: (parsed.timeWindow && parsed.timeWindow.endTime) || options.endTime || ""
    },
    recommendationSummary: result.recommendationSummary,
    topSeats,
    candidateSeats,
    candidateTotal: candidateSeats.length,
    candidateMoreCount: Math.max(candidateSeats.length - topSeats.length, 0)
  };
}

module.exports = {
  buildSeatAssistantResponse,
  parseMessage
};
