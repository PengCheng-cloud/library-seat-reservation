const { compareSeatIds } = require("./data-store");
const { getRecommendationRuntime, getRuntimeSeat } = require("./recommendation-runtime");

const FILTER_WEIGHTS = {
  power_outlet: 8,
  window: 6,
  quiet: 9,
  balanced_temperature: 5,
  quiet_position: 6,
  table_4: 5,
  table_8: 5,
  near_bookshelf: 3,
  near_restroom: 2,
  sunlight_yes: 3
};

const FILTER_LABELS = {
  power_outlet: "有插座",
  window: "靠窗",
  quiet: "安静",
  balanced_temperature: "温度均衡",
  quiet_position: "避开通道",
  table_4: "4人桌",
  table_8: "8人桌",
  near_bookshelf: "靠近书架",
  near_restroom: "靠近卫生间",
  sunlight_yes: "光照充足"
};

const FILTER_REASON_TEXT = {
  power_outlet: "满足设备用电需求",
  window: "命中靠窗偏好",
  quiet: "命中安静偏好",
  balanced_temperature: "避开空调直吹区域",
  quiet_position: "相对远离主通道",
  table_4: "更贴近4人桌学习场景",
  table_8: "更适合多人同桌使用",
  near_bookshelf: "便于顺手取阅纸质资料",
  near_restroom: "适合短时停留需求",
  sunlight_yes: "白天采光更稳定"
};

const SCENE_META = {
  default: {
    key: "default",
    label: "综合优选",
    description: "综合考虑四维评分、偏好命中度和当前时段可用性。",
    profileKey: "default",
    runtimeLabel: "综合优选"
  },
  sprint: {
    key: "sprint",
    label: "冲刺学习",
    description: "更偏向深度专注、避开通道且适合长时间学习的座位。",
    profileKey: "focus",
    runtimeLabel: "深度专注型"
  },
  window: {
    key: "window",
    label: "临窗阅读",
    description: "更偏向采光更好、环境稳定、适合长时间阅读的位置。",
    profileKey: "comfort",
    runtimeLabel: "舒适久学型"
  },
  device: {
    key: "device",
    label: "设备作业",
    description: "更偏向插座便利、设备使用稳定、适合带电脑学习的位置。",
    profileKey: "device",
    runtimeLabel: "设备作业型"
  },
  group: {
    key: "group",
    label: "结伴自习",
    description: "更偏向多人桌、开放度更高、协作更顺手的桌组。",
    profileKey: "collab",
    runtimeLabel: "开放协作型"
  }
};

const RECOMMENDATION_RANK_LABELS = ["首选", "次选", "备选", "补位", "备份", "候补"];

const SCENE_MODEL_META = {
  focus: {
    label: "深度专注型",
    description: "干扰更少，更适合沉浸式学习",
    confidence: 0.88
  },
  comfort: {
    label: "舒适久学型",
    description: "采光与安静度更均衡，适合长时间阅读",
    confidence: 0.91
  },
  device: {
    label: "设备作业型",
    description: "插座与便利性更强，适合带电脑作业",
    confidence: 0.87
  },
  open: {
    label: "开放协作型",
    description: "桌组更开放，更适合结伴自习和讨论",
    confidence: 0.89
  }
};

const PROFILE_LABEL_MAP = {
  focus: "深度专注型",
  comfort: "舒适久学型",
  device: "设备作业型",
  collab: "开放协作型"
};

const LABEL_PROFILE_MAP = Object.entries(PROFILE_LABEL_MAP).reduce((accumulator, [key, label]) => {
  accumulator[label] = key;
  return accumulator;
}, {});

function getDeploymentModel(runtime) {
  const experiment = runtime && runtime.experiment ? runtime.experiment : {};
  return experiment.deploymentModel || experiment.bestModel || {};
}

function getDeepLearningModel(runtime) {
  const experiment = runtime && runtime.experiment ? runtime.experiment : {};
  if (experiment.deepLearningModel && experiment.deepLearningModel.name) {
    return experiment.deepLearningModel;
  }

  const metricRows = Array.isArray(experiment.metricRows) ? experiment.metricRows : [];
  const mlpRow = metricRows.find((item) => {
    const modelName = String(item.model_name || item.model || item.name || "");
    return modelName.includes("MLP") || modelName.includes("神经网络");
  });
  if (!mlpRow) {
    return {};
  }

  return {
    name: mlpRow.model_name || mlpRow.model || mlpRow.name || "神经网络 MLP",
    shortName: "MLP",
    macroF1: mlpRow.macro_f1 || mlpRow.macroF1,
    microF1: mlpRow.micro_f1 || mlpRow.microF1,
    macroPrecision: mlpRow.macro_precision || mlpRow.macroPrecision,
    macroRecall: mlpRow.macro_recall || mlpRow.macroRecall
  };
}

function formatMetricPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "";
  }

  return `${(numericValue * 100).toFixed(2)}%`;
}

function buildLabelScoreItems(seatRuntime) {
  const labelScores = seatRuntime && seatRuntime.labelScores ? seatRuntime.labelScores : {};
  return Object.entries(labelScores)
    .map(([label, score]) => {
      const numericScore = Number(score || 0);
      const percent = Math.max(0, Math.min(100, Math.round(numericScore * 100)));
      return {
        label,
        profileKey: LABEL_PROFILE_MAP[label] || "",
        score: Number(numericScore.toFixed(6)),
        percent,
        percentText: `${percent}%`
      };
    })
    .sort((left, right) => right.score - left.score);
}

function buildAlgorithmEvidence(runtime) {
  if (!runtime || !runtime.available) {
    return null;
  }

  const experiment = runtime.experiment || {};
  const dataset = runtime.dataset || {};
  const inference = runtime.inference || {};
  const deploymentModel = getDeploymentModel(runtime);
  const deepLearningModel = getDeepLearningModel(runtime);
  const deploymentModelName = deploymentModel.name || "";
  const deploymentModelShortName = deploymentModel.shortName || deploymentModelName || "模型";
  const deepLearningModelName = deepLearningModel.name || "";
  const realtime = Boolean(inference.realtime);

  const taskType = experiment.taskType || "座位级多标签分类";
  const isMatchingTask = taskType.includes("匹配");

  return {
    source: experiment.source || "",
    taskType,
    datasetName: dataset.name || (isMatchingTask ? "需求-座位多标签匹配推荐数据集" : "答辩版多标签座位数据集"),
    datasetDemandCount: Number(dataset.demandCount || 0),
    datasetSeatCount: Number(dataset.seatCount || 0),
    datasetFeatureCount: Number(dataset.featureCount || 0),
    datasetLabelCount: Number(dataset.labelCount || 0),
    deploymentModelName,
    deploymentModelShortName,
    deploymentModelMacroF1Text: formatMetricPercent(deploymentModel.macroF1),
    deploymentModelMicroF1Text: formatMetricPercent(deploymentModel.microF1),
    deepLearningModelName,
    deepLearningModelShortName: deepLearningModel.shortName || deepLearningModelName,
    deepLearningModelMacroF1Text: formatMetricPercent(deepLearningModel.macroF1),
    deepLearningModelMicroF1Text: formatMetricPercent(deepLearningModel.microF1),
    deploymentReason: experiment.deploymentReason || "",
    deepLearningNote: experiment.deepLearningNote || "",
    inferenceMode: inference.mode || (realtime ? "request_time_svm_predict" : "cached_prediction"),
    inferenceModeText: realtime
      ? (isMatchingTask ? "本次请求实时进行需求-座位匹配预测" : `本次请求实时调用 ${deploymentModelShortName} 预测`)
      : `读取已生成的 ${deploymentModelShortName} 预测结果`,
    inferenceStartedAt: inference.startedAt || "",
    inferenceFinishedAt: inference.finishedAt || "",
    inferenceDurationMs: Number(inference.durationMs || 0),
    requestedSeatCount: Number(inference.requestedSeatCount || dataset.seatCount || 0),
    predictedSeatCount: Number(inference.predictedSeatCount || dataset.seatCount || 0),
    missingSeatCount: Number(inference.missingSeatCount || 0),
    neuralModelUsed: false,
    fusionWeights: null,
    processSteps: Array.isArray(inference.processSteps) ? inference.processSteps : [],
    summaryText: deploymentModelName
      ? `${deploymentModelName} 已接入推荐排序。`
      : (isMatchingTask ? "当前推荐已接入需求-座位匹配实验结果。" : "当前推荐已接入多标签分类实验结果。")
  };
}

function buildSeatAlgorithmFields(seat, runtimeOverride) {
  const { runtime, seatRuntime } = resolveSeatRuntime(seat, runtimeOverride);
  const evidence = buildAlgorithmEvidence(runtime);
  const labelScoreItems = buildLabelScoreItems(seatRuntime);
  const predictedLabels = seatRuntime && Array.isArray(seatRuntime.predictedLabels)
    ? seatRuntime.predictedLabels
    : [];
  const actualLabels = seatRuntime && Array.isArray(seatRuntime.actualLabels)
    ? seatRuntime.actualLabels
    : [];
  const predictedLabelSet = new Set(predictedLabels);
  const predictedLabelsForDisplay = labelScoreItems
    .filter((item) => predictedLabelSet.has(item.label))
    .map((item) => item.label)
    .slice(0, 3);

  const matchingProbability = seatRuntime && Number.isFinite(Number(seatRuntime.matchingProbability))
    ? Number(seatRuntime.matchingProbability)
    : null;
  const matchingPercent = matchingProbability === null ? 0 : Math.round(matchingProbability * 100);

  return {
    algorithmTaskType: evidence ? evidence.taskType : "",
    algorithmDatasetName: evidence ? evidence.datasetName : "",
    algorithmModelName: evidence ? evidence.deploymentModelName : "",
    algorithmModelShortName: evidence ? evidence.deploymentModelShortName : "",
    deploymentModelMacroF1Text: evidence ? evidence.deploymentModelMacroF1Text : "",
    deploymentModelMicroF1Text: evidence ? evidence.deploymentModelMicroF1Text : "",
    deepLearningModelName: evidence ? evidence.deepLearningModelName : "",
    deepLearningModelMacroF1Text: evidence ? evidence.deepLearningModelMacroF1Text : "",
    deepLearningModelMicroF1Text: evidence ? evidence.deepLearningModelMicroF1Text : "",
    predictedLabels,
    predictedLabelsText: (predictedLabelsForDisplay.length ? predictedLabelsForDisplay : predictedLabels).join("、"),
    actualLabels,
    actualLabelsText: actualLabels.join("、"),
    labelScoreItems,
    // Features with the largest contribution to the model score of this seat, computed
    // from the SVM weights (see docs/recommendation.md). Not shown in the Mini Program yet.
    modelEvidence: seatRuntime && Array.isArray(seatRuntime.modelEvidence) ? seatRuntime.modelEvidence : [],
    labelScoresText: labelScoreItems
      .slice(0, 3)
      .map((item) => `${item.label}${item.percentText}`)
      .join(" / "),
    primaryLabelScoreText: labelScoreItems[0]
      ? `${labelScoreItems[0].label} ${labelScoreItems[0].percentText}`
      : "",
    matchingProbability,
    matchingPercent,
    matchingPercentText: matchingProbability === null ? "" : `${matchingPercent}%`,
    matchingLabel: seatRuntime && seatRuntime.matchingLabel ? seatRuntime.matchingLabel : ""
  };
}

const FALLBACK_SCENE_PROFILES = {
  default: {
    label: "综合优选",
    weights: {
      focus: 0.35,
      comfort: 0.30,
      device: 0.20,
      collab: 0.15
    }
  },
  focus: {
    label: "深度专注型",
    weights: {
      focus: 0.65,
      comfort: 0.15,
      device: 0.10,
      collab: 0.10
    }
  },
  comfort: {
    label: "舒适久学型",
    weights: {
      focus: 0.20,
      comfort: 0.55,
      device: 0.10,
      collab: 0.15
    }
  },
  device: {
    label: "设备作业型",
    weights: {
      focus: 0.10,
      comfort: 0.15,
      device: 0.60,
      collab: 0.15
    }
  },
  collab: {
    label: "开放协作型",
    weights: {
      focus: 0.10,
      comfort: 0.10,
      device: 0.15,
      collab: 0.65
    }
  }
};

const STATIC_STATUS_META = {
  available: {
    statusKey: "available",
    statusLabel: "可预约",
    statusTone: "available",
    statusDescription: "当前时段可直接预约",
    canReserve: true,
    statusRank: 0
  },
  disabled: {
    statusKey: "disabled",
    statusLabel: "已停用",
    statusTone: "disabled",
    statusDescription: "该座位当前不对读者开放",
    canReserve: false,
    statusRank: 5
  },
  maintenance: {
    statusKey: "maintenance",
    statusLabel: "维护中",
    statusTone: "maintenance",
    statusDescription: "该座位当前处于维护状态",
    canReserve: false,
    statusRank: 4
  }
};

const RESERVATION_STATUS_META = {
  reserved: {
    statusKey: "reserved",
    statusLabel: "已预约",
    statusTone: "reserved",
    statusDescription: "该时段已被他人预约",
    canReserve: false,
    statusRank: 1
  },
  checked_in: {
    statusKey: "checked_in",
    statusLabel: "使用中",
    statusTone: "occupied",
    statusDescription: "当前已有读者正在使用",
    canReserve: false,
    statusRank: 2
  },
  temporary_leave: {
    statusKey: "temporary_leave",
    statusLabel: "暂离中",
    statusTone: "leave",
    statusDescription: "当前座位被暂离读者保留",
    canReserve: false,
    statusRank: 3
  }
};

const USER_CONFLICT_STATUS_META = {
  statusKey: "user_conflict",
  statusLabel: "时段冲突",
  statusTone: "reserved",
  statusDescription: "当前账号在这个时间段已经预约了其他位置",
  canReserve: false,
  statusRank: 1
};

function decodeQueryText(value) {
  let decodedText = String(value || "").trim();
  if (!decodedText) {
    return "";
  }

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextText = decodeURIComponent(decodedText);
      if (nextText === decodedText) {
        break;
      }
      decodedText = nextText;
    } catch (error) {
      break;
    }
  }

  return decodedText;
}

function normalizeFilters(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(decodeQueryText).filter(Boolean);
  }

  return decodeQueryText(value)
    .split(",")
    .map((item) => decodeQueryText(item))
    .filter(Boolean);
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(decodeQueryText(value).toLowerCase());
}

function getSceneMeta(filters) {
  const normalizedFilters = normalizeFilters(filters);

  if (normalizedFilters.includes("table_8")) {
    return SCENE_META.group;
  }

  if (normalizedFilters.includes("window") || normalizedFilters.includes("sunlight_yes")) {
    return SCENE_META.window;
  }

  if (
    normalizedFilters.includes("quiet") ||
    normalizedFilters.includes("quiet_position")
  ) {
    return SCENE_META.sprint;
  }

  if (normalizedFilters.includes("power_outlet")) {
    return SCENE_META.device;
  }

  return SCENE_META.default;
}

function getMatchedFilterCount(seat, filters) {
  const tagKeys = seat.tagKeys || [];
  return normalizeFilters(filters).filter((filterKey) => tagKeys.includes(filterKey)).length;
}

function getSceneProfile(sceneMeta, runtime) {
  const profileKey = (sceneMeta && sceneMeta.profileKey) || "default";
  const runtimeProfiles = runtime && runtime.sceneProfiles ? runtime.sceneProfiles : null;
  return (
    (runtimeProfiles && runtimeProfiles[profileKey]) ||
    FALLBACK_SCENE_PROFILES[profileKey] ||
    FALLBACK_SCENE_PROFILES.default
  );
}

function formatModelConfidenceText(confidence, shortName) {
  const modelLabel = shortName || "模型";
  const safeConfidence = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  return `${modelLabel} ${Math.round(safeConfidence * 100)}% 场景置信`;
}

function inferSeatSceneModelFallback(seat) {
  if (
    seat.zoneBand === "south_inner" ||
    (seat.zoneBand === "south_outer" && hasTag(seat, "table_8")) ||
    (seat.nearCorridor && hasTag(seat, "table_8") && (seat.zoneBand === "east" || seat.zoneBand === "south_outer"))
  ) {
    return {
      key: "open",
      ...SCENE_MODEL_META.open,
      confidenceText: `${Math.round(SCENE_MODEL_META.open.confidence * 100)}% 场景置信`
    };
  }

  if (seat.hasPower && (seat.nearCorridor || seat.nearRestroom || seat.nearPantry || seat.nearAC)) {
    return {
      key: "device",
      ...SCENE_MODEL_META.device,
      confidenceText: `${Math.round(SCENE_MODEL_META.device.confidence * 100)}% 场景置信`
    };
  }

  if (seat.nearWindow && seat.quietLevel === "安静" && !seat.nearCorridor) {
    return {
      key: "comfort",
      ...SCENE_MODEL_META.comfort,
      confidenceText: `${Math.round(SCENE_MODEL_META.comfort.confidence * 100)}% 场景置信`
    };
  }

  return {
    key: "focus",
    ...SCENE_MODEL_META.focus,
    confidenceText: `${Math.round(SCENE_MODEL_META.focus.confidence * 100)}% 场景置信`
  };
}

function inferSeatSceneModel(seat, runtimeOverride) {
  const { runtime, seatRuntime } = resolveSeatRuntime(seat, runtimeOverride);

  if (seatRuntime && Number.isFinite(Number(seatRuntime.matchingProbability))) {
    const deploymentModel = getDeploymentModel(runtime);
    const probability = Number(seatRuntime.matchingProbability || 0);
    const label = probability >= 0.5 ? "需求匹配型" : "候选补充型";
    return {
      key: "matching",
      label,
      description: deploymentModel.name
        ? `座位适配度由${deploymentModel.name}需求-座位匹配模型预测`
        : "座位适配度由需求-座位匹配模型预测",
      confidence: probability,
      confidenceText: `${deploymentModel.shortName || deploymentModel.name || "模型"} ${Math.round(probability * 100)}% 匹配置信`,
      secondaryLabel: "",
      secondaryConfidence: 0
    };
  }

  if (seatRuntime && seatRuntime.groupModel && seatRuntime.groupModel.predictedLabel) {
    const deploymentModel = getDeploymentModel(runtime);
    const taskType = runtime.experiment && runtime.experiment.taskType
      ? runtime.experiment.taskType
      : "座位级分类";
    const predictedLabel = seatRuntime.groupModel.predictedLabel;
    const confidence = Number(seatRuntime.groupModel.predictedConfidence || 0);

    return {
      key: LABEL_PROFILE_MAP[predictedLabel] || "focus",
      label: predictedLabel,
      description: deploymentModel.name
        ? `座位场景由${deploymentModel.name}${taskType.includes("多标签") ? "多标签" : ""}模型完成预测`
        : "座位场景由答辩版实验模型完成预测",
      confidence,
      confidenceText: formatModelConfidenceText(confidence, deploymentModel.shortName || deploymentModel.name),
      secondaryLabel: seatRuntime.groupModel.secondaryLabel || "",
      secondaryConfidence: Number(seatRuntime.groupModel.secondaryConfidence || 0)
    };
  }

  return inferSeatSceneModelFallback(seat);
}

function buildRelaxationState(baseSeats, strictSeats, filters) {
  const normalizedFilters = normalizeFilters(filters);
  if (!normalizedFilters.length || strictSeats.length) {
    return {
      relaxed: false,
      items: strictSeats.length ? strictSeats : baseSeats,
      threshold: normalizedFilters.length
    };
  }

  const candidates = baseSeats
    .map((seat) => ({
      seat,
      matchedFilterCount: getMatchedFilterCount(seat, normalizedFilters)
    }))
    .filter((item) => item.matchedFilterCount > 0);

  const threshold = Math.max(
    1,
    Math.min(normalizedFilters.length - 1, Math.ceil(normalizedFilters.length * 0.6))
  );
  const firstPass = candidates.filter((item) => item.matchedFilterCount >= threshold);

  return {
    relaxed: true,
    items: (firstPass.length ? firstPass : candidates).map((item) => item.seat),
    threshold
  };
}

function hasTag(seat, tagKey) {
  return (seat.tagKeys || []).includes(tagKey);
}

function addUniqueReason(reasons, reason, limit = 5) {
  if (!reason || reasons.includes(reason) || reasons.length >= limit) {
    return;
  }

  reasons.push(reason);
}

function getSeatFromRuntime(runtime, seatId) {
  if (!runtime || !runtime.available || !seatId) {
    return null;
  }

  if (runtime.seatMap && typeof runtime.seatMap.get === "function") {
    return runtime.seatMap.get(String(seatId)) || null;
  }

  if (runtime.seats) {
    return runtime.seats[String(seatId)] || null;
  }

  return null;
}

function resolveSeatRuntime(seat, runtimeOverride) {
  const runtime = runtimeOverride || getRecommendationRuntime();
  const seatRuntime = runtimeOverride
    ? getSeatFromRuntime(runtime, seat.seatId)
    : (runtime.available ? getRuntimeSeat(seat.seatId) : null);
  return {
    runtime,
    seatRuntime
  };
}

function getRuntimeSceneScore(seatRuntime, sceneMeta, runtime) {
  if (seatRuntime && Number.isFinite(Number(seatRuntime.matchingProbability))) {
    return Number(seatRuntime.matchingProbability || 0);
  }

  const profile = getSceneProfile(sceneMeta, runtime);
  const weights = profile.weights || {};
  const finalScores = seatRuntime && seatRuntime.finalScores ? seatRuntime.finalScores : {};
  return (
    (Number(finalScores.focus || 0) * Number(weights.focus || 0)) +
    (Number(finalScores.comfort || 0) * Number(weights.comfort || 0)) +
    (Number(finalScores.device || 0) * Number(weights.device || 0)) +
    (Number(finalScores.collab || 0) * Number(weights.collab || 0))
  );
}

function getRuntimeAlignmentBonus(seatRuntime, sceneMeta) {
  if (!seatRuntime) {
    return 0;
  }

  if (Number.isFinite(Number(seatRuntime.matchingProbability))) {
    const probability = Number(seatRuntime.matchingProbability || 0);
    return Math.max(0, (probability - 0.5) * 12);
  }

  const targetLabel = sceneMeta && sceneMeta.runtimeLabel;
  const groupModel = seatRuntime.groupModel || {};
  let bonus = 0;

  if (!targetLabel || sceneMeta.key === "default") {
    bonus += Math.min(Number(seatRuntime.seatLabelGap || 0) * 4, 5);
    bonus += Math.min(Number(groupModel.predictedConfidence || 0) * 4, 4);
    return bonus;
  }

  if (seatRuntime.seatPrimaryLabel === targetLabel) {
    bonus += 8;
  } else if (seatRuntime.seatSecondaryLabel === targetLabel) {
    bonus += 4;
  }

  if (groupModel.predictedLabel === targetLabel) {
    bonus += 6 + Number(groupModel.predictedConfidence || 0) * 6;
  } else if (groupModel.secondaryLabel === targetLabel) {
    bonus += 3 + Number(groupModel.secondaryConfidence || 0) * 3;
  }

  return bonus;
}

function formatRuntimeScoreSummary(seatRuntime) {
  if (seatRuntime && Number.isFinite(Number(seatRuntime.matchingProbability))) {
    const probability = Number(seatRuntime.matchingProbability || 0);
    const detail = seatRuntime.matchingDetails || {};
    const matchRatio = Number(detail.weightedMatchRatio || 0);
    const conflictRatio = Number(detail.weightedConflictRatio || 0);
    return `匹配概率${Math.round(probability * 100)}%，偏好命中率${Math.round(matchRatio * 100)}%，冲突惩罚${Math.round(conflictRatio * 100)}%`;
  }

  if (!seatRuntime || !seatRuntime.finalScores) {
    return "";
  }

  const scores = seatRuntime.finalScores;
  return `四类概率折算分：专注${Number(scores.focus || 0).toFixed(2)} / 舒适${Number(scores.comfort || 0).toFixed(2)} / 设备${Number(scores.device || 0).toFixed(2)} / 协作${Number(scores.collab || 0).toFixed(2)}`;
}

function scoreSceneFit(seat, sceneKey) {
  if (sceneKey === "sprint") {
    let score = 0;
    if (seat.quietLevel === "安静") {
      score += 10;
    }
    if (!seat.nearCorridor) {
      score += 8;
    }
    if (!seat.nearRestroom) {
      score += 4;
    }
    if (!seat.nearPantry) {
      score += 3;
    }
    if (!seat.nearAC) {
      score += 3;
    }
    if (seat.hasPower) {
      score += 5;
    }
    if (hasTag(seat, "table_4")) {
      score += 2;
    }
    if (seat.zoneBand === "north" || seat.zoneBand === "west") {
      score += 3;
    }
    return score;
  }

  if (sceneKey === "window") {
    let score = 0;
    if (seat.nearWindow) {
      score += 12;
    }
    if (hasTag(seat, "sunlight_yes")) {
      score += 10;
    }
    if (seat.quietLevel === "安静") {
      score += 4;
    }
    if (!seat.nearCorridor) {
      score += 3;
    }
    if (seat.zoneBand === "north" || seat.zoneBand === "east" || seat.zoneBand === "south_outer") {
      score += 2;
    }
    return score;
  }

  if (sceneKey === "group") {
    let score = 0;
    if (hasTag(seat, "table_8")) {
      score += 12;
    }
    if (seat.hasPower) {
      score += 6;
    }
    if (seat.nearCorridor) {
      score += 4;
    }
    if (seat.zoneBand === "south_inner" || seat.zoneBand === "south_outer" || seat.zoneBand === "east") {
      score += 4;
    }
    if (seat.quietLevel !== "安静") {
      score += 2;
    }
    return score;
  }

  let score = 0;
  if (seat.quietLevel === "安静") {
    score += 7;
  }
  if (seat.hasPower) {
    score += 6;
  }
  if (!seat.nearCorridor) {
    score += 5;
  }
  if (!seat.nearAC) {
    score += 3;
  }
  if (seat.nearWindow) {
    score += 3;
  }
  return score;
}

function buildSeatAvailability(seat, seatUsageMap, userReservationConflict) {
  if (seat.seatStatus !== "available") {
    return STATIC_STATUS_META[seat.seatStatus] || STATIC_STATUS_META.available;
  }

  const usage = seatUsageMap && seatUsageMap.get(seat.seatId);
  if (usage) {
    const meta = RESERVATION_STATUS_META[usage.status] || RESERVATION_STATUS_META.reserved;
    return {
      ...meta,
      conflictReservationNo: usage.reservationNo,
      conflictTimeRange: usage.startTime && usage.endTime ? `${usage.startTime}-${usage.endTime}` : ""
    };
  }

  if (userReservationConflict) {
    return {
      ...USER_CONFLICT_STATUS_META,
      conflictReservationNo: userReservationConflict.reservationNo,
      conflictTimeRange:
        userReservationConflict.startTime && userReservationConflict.endTime
          ? `${userReservationConflict.startTime}-${userReservationConflict.endTime}`
          : "",
      statusDescription: `你在 ${userReservationConflict.startTime}-${userReservationConflict.endTime} 已预约 ${userReservationConflict.seatId}`
    };
  }

  return STATIC_STATUS_META.available;
}

function scoreSeat(seat, filters, activeZone, sceneMeta, runtimeOverride) {
  const { runtime, seatRuntime } = resolveSeatRuntime(seat, runtimeOverride);
  if (seatRuntime) {
    if (Number.isFinite(Number(seatRuntime.matchingProbability))) {
      let score = Number(seatRuntime.matchingProbability || 0) * 100;
      filters.forEach((filterKey) => {
        if ((seat.tagKeys || []).includes(filterKey)) {
          score += Math.min(FILTER_WEIGHTS[filterKey] || 4, 4);
        }
      });
      if (activeZone && seat.zoneCode === activeZone) {
        score += 3;
      }
      return Number(score.toFixed(2));
    }

    let score = getRuntimeSceneScore(seatRuntime, sceneMeta, runtime) * 16;

    score += getRuntimeAlignmentBonus(seatRuntime, sceneMeta);

    filters.forEach((filterKey) => {
      if ((seat.tagKeys || []).includes(filterKey)) {
        score += Math.min(FILTER_WEIGHTS[filterKey] || 4, 7);
      }
    });

    if (activeZone && seat.zoneCode === activeZone) {
      score += 3;
    }

    return Number(score.toFixed(2));
  }

  let score = 50;

  filters.forEach((filterKey) => {
    if ((seat.tagKeys || []).includes(filterKey)) {
      score += FILTER_WEIGHTS[filterKey] || 4;
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
  if (activeZone && seat.zoneCode === activeZone) {
    score += 6;
  }

  score += scoreSceneFit(seat, (sceneMeta || SCENE_META.default).key);
  if (runtime.available && !seatRuntime) {
    score -= 30;
  }

  return score;
}

function buildReasonList(seat, filters, sceneMeta, runtimeOverride) {
  const { runtime, seatRuntime } = resolveSeatRuntime(seat, runtimeOverride);
  if (seatRuntime) {
    const reasons = [];
    const tagKeys = seat.tagKeys || [];
    const sceneModel = inferSeatSceneModel(seat, runtime);
    const deploymentModel = getDeploymentModel(runtime);

    filters.forEach((filterKey) => {
      if (tagKeys.includes(filterKey)) {
        addUniqueReason(reasons, FILTER_REASON_TEXT[filterKey] || `命中${FILTER_LABELS[filterKey] || filterKey}`);
      }
    });

    if (seatRuntime.seatReason) {
      addUniqueReason(reasons, seatRuntime.seatReason.replace(/。+$/, ""));
    }

    if (Number.isFinite(Number(seatRuntime.matchingProbability))) {
      addUniqueReason(reasons, `需求匹配概率 ${Math.round(Number(seatRuntime.matchingProbability) * 100)}%`);
      addUniqueReason(reasons, formatRuntimeScoreSummary(seatRuntime));
      return reasons.slice(0, 5);
    }

    if (sceneModel && sceneModel.label) {
      const modelLabel = deploymentModel.shortName || deploymentModel.name || "答辩版模型";
      addUniqueReason(reasons, `座位由${modelLabel}预测为${sceneModel.label}`);
    }

    if (sceneMeta && sceneMeta.runtimeLabel && sceneMeta.key !== "default") {
      if (seatRuntime.seatPrimaryLabel === sceneMeta.runtimeLabel) {
        addUniqueReason(reasons, `座位主标签命中${sceneMeta.runtimeLabel}`);
      } else if (seatRuntime.seatSecondaryLabel === sceneMeta.runtimeLabel) {
        addUniqueReason(reasons, `座位次优标签贴近${sceneMeta.runtimeLabel}`);
      }
    }

    addUniqueReason(reasons, formatRuntimeScoreSummary(seatRuntime));

    return reasons.slice(0, 5);
  }

  const reasons = [];
  const tagKeys = seat.tagKeys || [];

  filters.forEach((filterKey) => {
    if (tagKeys.includes(filterKey)) {
      addUniqueReason(reasons, FILTER_REASON_TEXT[filterKey] || `命中${FILTER_LABELS[filterKey] || filterKey}`);
    }
  });

  if (seat.hasPower) {
    addUniqueReason(reasons, "有插座，设备学习更稳定");
  }
  if (seat.nearWindow) {
    addUniqueReason(reasons, "靠窗位置，白天观感更舒适");
  }
  if (seat.quietLevel === "安静") {
    addUniqueReason(reasons, "整体环境更安静");
  }
  if (!seat.nearCorridor) {
    addUniqueReason(reasons, "相对避开主通道干扰");
  }
  if (!seat.nearAC) {
    addUniqueReason(reasons, "不在空调直吹位");
  }

  if ((sceneMeta || SCENE_META.default).key === "group" && hasTag(seat, "table_8")) {
    addUniqueReason(reasons, "多人桌更适合结伴自习");
  }

  if ((sceneMeta || SCENE_META.default).key === "sprint" && seat.zoneBand === "north") {
    addUniqueReason(reasons, "更接近北侧静学区氛围");
  }

  if ((sceneMeta || SCENE_META.default).key === "window" && hasTag(seat, "sunlight_yes")) {
    addUniqueReason(reasons, "日照更稳定，适合白天阅读");
  }

  const sceneModel = inferSeatSceneModel(seat, runtimeOverride);
  const taskType = runtime && runtime.experiment ? String(runtime.experiment.taskType || "") : "";
  addUniqueReason(reasons, `${taskType.includes("匹配") ? "匹配模型" : "场景模型"}判断为${sceneModel.label}`);

  return reasons.slice(0, 5);
}

function calculateFitPercent(score, filters, seat) {
  if (seat && Number.isFinite(Number(seat.matchingProbability))) {
    return Math.max(58, Math.min(99, Math.round(Number(seat.matchingProbability) * 100)));
  }

  const filterBonus = normalizeFilters(filters).length * 1.5;
  const normalized = 36 + (Number(score || 0) * 0.48) + filterBonus;
  return Math.max(58, Math.min(98, Math.round(normalized)));
}

function pickTopRecommendations(items, limit = 6) {
  const selected = [];
  const usedTableGroups = new Set();

  items.forEach((item) => {
    if (selected.length >= limit) {
      return;
    }

    if (!usedTableGroups.has(item.tableGroupCode)) {
      selected.push(item);
      usedTableGroups.add(item.tableGroupCode);
    }
  });

  if (selected.length < limit) {
    items.forEach((item) => {
      if (selected.length >= limit) {
        return;
      }

      if (!selected.find((selectedItem) => selectedItem.seatId === item.seatId)) {
        selected.push(item);
      }
    });
  }

  return selected;
}

function buildRecommendationSummary(availableSeats, topRecommendations, filters, sceneMeta, activeZone, runtimeOverride) {
  const runtime = runtimeOverride || getRecommendationRuntime();
  const algorithmEvidence = buildAlgorithmEvidence(runtime);
  const deploymentModel = getDeploymentModel(runtime);
  const taskType = runtime && runtime.experiment && runtime.experiment.taskType ? runtime.experiment.taskType : "";
  const isMatchingTask = taskType.includes("匹配");
  const modelLabel = deploymentModel.name
    ? `${isMatchingTask ? "需求-座位匹配部署模型" : "多标签部署模型"}“${deploymentModel.name}”`
    : "多标签实验模型";
  const filterLabels = normalizeFilters(filters).map((key) => FILTER_LABELS[key] || key);

  if (!availableSeats.length) {
    return {
      title: "当前时段暂无推荐座位",
      description: activeZone
        ? `${activeZone} 区在当前时间段没有可预约座位，可以尝试切换分区或放宽偏好。`
        : "当前筛选条件下暂无可预约座位，可以放宽偏好后重新检索。",
      badge: "建议调整偏好",
      hintTags: filterLabels.slice(0, 4),
      focusSeatId: "",
      focusTableGroupCode: "",
      modelNote: `${modelLabel}会继续保留当前偏好上下文，等待你调整时间窗或条件后重新排序。`,
      algorithmEvidence,
      isRelaxed: false
    };
  }

  const bestSeat = topRecommendations[0];
  const hintTags = Array.from(
    new Set([
      ...filterLabels,
      ...((bestSeat && bestSeat.reasons) || []).slice(0, 3)
    ])
  ).slice(0, 4);

  return {
    title: `${sceneMeta.label}推荐`,
    description: activeZone
      ? `已结合 ${activeZone} 区、当前时间窗与偏好条件综合排序，优先推荐更贴合场景的座位。`
      : `已结合当前时间窗与偏好条件综合排序，优先推荐更贴合${sceneMeta.label}场景的座位。`,
    badge: `${availableSeats.length} 个可预约 · 精选 ${topRecommendations.length} 个起点`,
    hintTags,
    focusSeatId: bestSeat ? bestSeat.seatId : "",
    focusTableGroupCode: bestSeat ? bestSeat.tableGroupCode : "",
    modelNote: bestSeat
      ? (isMatchingTask
        ? `当前推荐已接入${modelLabel}，按需求-座位匹配概率、偏好命中和业务规则排序；首推座位匹配度为 ${bestSeat.matchingPercentText || bestSeat.fitPercent + "%"}。`
        : `当前推荐已接入${modelLabel}，按四类标签概率折算分和偏好命中排序；首推座位预测标签为“${bestSeat.sceneModelLabel}”。`)
      : (isMatchingTask
        ? `当前推荐已接入${modelLabel}，按需求-座位匹配概率和业务规则排序。`
        : `当前推荐已接入${modelLabel}，按四类标签概率折算分和偏好命中排序。`),
    algorithmEvidence,
    isRelaxed: false
  };
}

function filterSeats(seats, query = {}) {
  const filters = normalizeFilters(query.filters);
  const zoneCode = query.zoneCode || null;
  const search = decodeQueryText(query.search).toLowerCase();
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const seatUsageMap = query.seatUsageMap || null;
  const userReservationConflict = query.userReservationConflict || null;
  const runtime = query.runtime || getRecommendationRuntime();
  const sceneMeta = getSceneMeta(filters);
  const softPreferenceMode = isTruthyFlag(query.softPreferenceMode);

  const baseMatched = seats.filter((seat) => {
    if (zoneCode && seat.zoneCode !== zoneCode) {
      return false;
    }

    if (search && !seat.searchText.includes(search)) {
      return false;
    }

    return true;
  });

  const strictMatched = softPreferenceMode
    ? []
    : baseMatched.filter((seat) => (
      filters.every((filterKey) => (seat.tagKeys || []).includes(filterKey))
    ));

  const relaxationState = softPreferenceMode
    ? { relaxed: false, items: baseMatched, threshold: filters.length }
    : buildRelaxationState(baseMatched, strictMatched, filters);

  const matched = relaxationState.items
    .map((seat) => {
      const availability = buildSeatAvailability(seat, seatUsageMap, userReservationConflict);
      const matchedFilterCount = getMatchedFilterCount(seat, filters);
      const missingFilters = filters.filter((filterKey) => !(seat.tagKeys || []).includes(filterKey));
      const sceneModel = inferSeatSceneModel(seat, runtime);
      const algorithmFields = buildSeatAlgorithmFields(seat, runtime);

      return {
        ...seat,
        ...availability,
        ...algorithmFields,
        score: scoreSeat(seat, filters, zoneCode, sceneMeta, runtime),
        reasons: buildReasonList(seat, filters, sceneMeta, runtime),
        matchedFilterCount,
        missingFilters,
        sceneModelKey: sceneModel.key,
        sceneModelLabel: sceneModel.label,
        sceneModelDescription: sceneModel.description,
        sceneModelConfidence: sceneModel.confidence,
        sceneModelConfidenceText: sceneModel.confidenceText,
        relaxedMatch: relaxationState.relaxed
      };
    })
    .sort((left, right) => {
      const rankDiff = left.statusRank - right.statusRank;
      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (softPreferenceMode) {
        const scoreDiff = right.score - left.score;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
      } else {
        const filterMatchDiff = right.matchedFilterCount - left.matchedFilterCount;
        if (filterMatchDiff !== 0) {
          return filterMatchDiff;
        }
      }

      return right.score - left.score || compareSeatIds(left.seatId, right.seatId);
    });

  const availableSeats = matched.filter((item) => item.canReserve);
  const topRecommendations = pickTopRecommendations(availableSeats, 6);
  const recommendationRankMap = new Map(
    topRecommendations.map((item, index) => [item.seatId, index + 1])
  );
  const enrichedItems = matched.map((item) => {
    const recommendationRank = recommendationRankMap.get(item.seatId) || 0;
    return {
      ...item,
      sceneLabel: sceneMeta.label,
      fitPercent: calculateFitPercent(item.score, filters, item),
      recommendationRank,
      recommendationLabel: recommendationRank
        ? (RECOMMENDATION_RANK_LABELS[recommendationRank - 1] || `优选 ${recommendationRank}`)
        : "",
      recommendationBadge: recommendationRank
        ? `${RECOMMENDATION_RANK_LABELS[recommendationRank - 1] || "优选"} · ${calculateFitPercent(item.score, filters, item)}%`
        : `${calculateFitPercent(item.score, filters, item)}%匹配`
    };
  });
  const topRecommendationIds = new Set(topRecommendations.map((item) => item.seatId));
  const enrichedTopRecommendations = enrichedItems.filter((item) => topRecommendationIds.has(item.seatId));
  const recommendationSummary = buildRecommendationSummary(
    enrichedItems.filter((item) => item.canReserve),
    enrichedTopRecommendations,
    filters,
    sceneMeta,
    zoneCode,
    runtime
  );
  if (relaxationState.relaxed) {
    const deploymentModel = getDeploymentModel(runtime);
    recommendationSummary.title = `${sceneMeta.label}推荐 · 自动放宽`;
    recommendationSummary.description = "当前没有完全匹配座位，系统已自动展示最接近的结果，并优先保留命中偏好更多的座位。";
    recommendationSummary.modelNote = deploymentModel.name
      ? `当前推荐同时结合${runtime && runtime.experiment && String(runtime.experiment.taskType || "").includes("匹配") ? "需求-座位匹配部署模型" : "多标签部署模型"}“${deploymentModel.name}”与偏好放宽策略进行排序。`
      : "当前推荐同时结合需求-座位匹配逻辑和偏好放宽策略进行排序。";
    recommendationSummary.isRelaxed = true;
  }

  return {
    filters,
    scene: sceneMeta,
    algorithmEvidence: recommendationSummary.algorithmEvidence || buildAlgorithmEvidence(runtime),
    relaxedMatch: relaxationState.relaxed,
    total: enrichedItems.length,
    availableCount: enrichedItems.filter((item) => item.canReserve).length,
    unavailableCount: enrichedItems.filter((item) => !item.canReserve).length,
    recommendationSummary,
    items: enrichedItems.slice(0, limit),
    topRecommendations: enrichedTopRecommendations
  };
}

function buildZoneCounts(zones, seats, query = {}) {
  const normalizedFilters = normalizeFilters(query.filters);
  const keyword = decodeQueryText(query.search).toLowerCase();
  const seatUsageMap = query.seatUsageMap || null;
  const userReservationConflict = query.userReservationConflict || null;
  const softPreferenceMode = isTruthyFlag(query.softPreferenceMode);
  const counts = new Map(zones.map((zone) => [zone.zoneCode, 0]));
  const strictCounts = new Map(zones.map((zone) => [zone.zoneCode, 0]));
  const relaxedCounts = new Map(zones.map((zone) => [zone.zoneCode, 0]));
  const relaxedThreshold = Math.max(
    1,
    Math.min(normalizedFilters.length - 1, Math.ceil(normalizedFilters.length * 0.6))
  );

  seats.forEach((seat) => {
    if (keyword && !seat.searchText.includes(keyword)) {
      return;
    }

    const availability = buildSeatAvailability(seat, seatUsageMap, userReservationConflict);
    if (!availability.canReserve) {
      return;
    }

    if (softPreferenceMode) {
      counts.set(seat.zoneCode, (counts.get(seat.zoneCode) || 0) + 1);
      return;
    }

    const matchedFilterCount = getMatchedFilterCount(seat, normalizedFilters);
    const strictPass = normalizedFilters.every((filterKey) => (seat.tagKeys || []).includes(filterKey));

    if (!normalizedFilters.length) {
      strictCounts.set(seat.zoneCode, (strictCounts.get(seat.zoneCode) || 0) + 1);
      return;
    }

    if (strictPass) {
      strictCounts.set(seat.zoneCode, (strictCounts.get(seat.zoneCode) || 0) + 1);
    }

    if (matchedFilterCount >= relaxedThreshold) {
      relaxedCounts.set(seat.zoneCode, (relaxedCounts.get(seat.zoneCode) || 0) + 1);
    }
  });

  if (softPreferenceMode) {
    return counts;
  }

  const totalStrictCount = Array.from(strictCounts.values()).reduce((sum, value) => sum + value, 0);
  if (!normalizedFilters.length || totalStrictCount > 0) {
    strictCounts.forEach((value, key) => counts.set(key, value));
    return counts;
  }

  relaxedCounts.forEach((value, key) => counts.set(key, value));

  return counts;
}

function timeToMinutes(value) {
  const text = decodeQueryText(value);
  if (!text || !/^\d{2}:\d{2}$/.test(text)) {
    return null;
  }

  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateToMidnight(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function diffDays(left, right) {
  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((left.getTime() - right.getTime()) / millisPerDay);
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function buildReservationPreview(input, options) {
  const {
    seat,
    user,
    rules,
    existingReservations
  } = options;

  const reservationDate = input.reservationDate || input.date;
  const startTime = input.startTime;
  const endTime = input.endTime;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeStatuses = new Set(["reserved", "checked_in", "temporary_leave"]);
  const requestDate = dateToMidnight(reservationDate);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const openMinutes = timeToMinutes(rules.openTime);
  const closeMinutes = timeToMinutes(rules.closeTime);
  const duration = startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null;

  const overlappingUserReservations = existingReservations.filter((item) => {
    if (item.userId !== user.userId || item.reservationDate !== reservationDate) {
      return false;
    }

    if (!activeStatuses.has(item.status)) {
      return false;
    }

    const itemStart = timeToMinutes(item.startTime);
    const itemEnd = timeToMinutes(item.endTime);
    if (itemStart === null || itemEnd === null || startMinutes === null || endMinutes === null) {
      return false;
    }

    return overlaps(startMinutes, endMinutes, itemStart, itemEnd);
  });

  const activeUserReservations = existingReservations.filter((item) => (
    item.userId === user.userId && activeStatuses.has(item.status)
  ));

  const seatConflicts = existingReservations.filter((item) => {
    if (!seat || item.seatId !== seat.seatId || item.reservationDate !== reservationDate) {
      return false;
    }

    if (!activeStatuses.has(item.status)) {
      return false;
    }

    const itemStart = timeToMinutes(item.startTime);
    const itemEnd = timeToMinutes(item.endTime);
    if (itemStart === null || itemEnd === null || startMinutes === null || endMinutes === null) {
      return false;
    }

    return overlaps(startMinutes, endMinutes, itemStart, itemEnd);
  });

  const checks = [
    {
      key: "user_status",
      label: "用户状态可预约",
      passed: user.status === "active" && !user.isBlacklisted,
      detail: user.isBlacklisted ? "用户当前处于黑名单期" : "用户状态正常"
    },
    {
      key: "seat_exists",
      label: "目标座位存在",
      passed: Boolean(seat),
      detail: seat ? `${seat.seatId} 可用于预校验` : "未找到对应座位"
    },
    {
      key: "seat_available",
      label: "目标座位静态状态可用",
      passed: Boolean(seat) && seat.seatStatus === "available",
      detail: seat ? `当前状态：${seat.seatStatus}` : "座位不存在，无法判断"
    },
    {
      key: "date_window",
      label: "预约日期在允许窗口内",
      passed:
        Boolean(requestDate) &&
        diffDays(requestDate, today) >= 0 &&
        diffDays(requestDate, today) <= rules.advanceDays,
      detail: requestDate
        ? `允许预约今天起 ${rules.advanceDays} 天内的座位`
        : "预约日期格式无效"
    },
    {
      key: "time_format",
      label: "开始与结束时间合法",
      passed: startMinutes !== null && endMinutes !== null && endMinutes > startMinutes,
      detail: "结束时间必须晚于开始时间，格式需为 HH:mm"
    },
    {
      key: "open_time",
      label: "预约时间位于开放时段内",
      passed:
        startMinutes !== null &&
        endMinutes !== null &&
        openMinutes !== null &&
        closeMinutes !== null &&
        startMinutes >= openMinutes &&
        endMinutes <= closeMinutes,
      detail: `开放时间 ${rules.openTime} - ${rules.closeTime}`
    },
    {
      key: "duration_limit",
      label: "预约时长符合上下限",
      passed:
        duration !== null &&
        duration >= rules.minReservationMinutes &&
        duration <= rules.maxReservationMinutes,
      detail: `一期默认单次预约 ${rules.minReservationMinutes}-${rules.maxReservationMinutes} 分钟`
    },
    {
      key: "active_reservation_limit",
      label: "用户当前没有超出有效预约上限",
      passed: activeUserReservations.length < rules.maxActiveReservations,
      detail: `当前有效预约 ${activeUserReservations.length} 条，上限 ${rules.maxActiveReservations} 条`
    },
    {
      key: "seat_conflict",
      label: "同座位同时间段不存在冲突",
      passed: seatConflicts.length === 0,
      detail:
        seatConflicts.length === 0
          ? "当前没有命中示例冲突数据"
          : `与 ${seatConflicts[0].reservationNo} 存在时间冲突`
    }
  ];

  const valid = checks.every((item) => item.passed);

  return {
    valid,
    seat: seat
      ? {
          seatId: seat.seatId,
          zoneCode: seat.zoneCode,
          zoneDisplayName: seat.zoneDisplayName,
          seatType: seat.seatType
        }
      : null,
    user: {
      userId: user.userId,
      realName: user.realName,
      creditScore: user.creditScore
    },
    request: {
      reservationDate,
      startTime,
      endTime
    },
    checks,
    conflicts: seatConflicts,
    message: valid ? "当前请求通过默认规则预校验，可以进入创建预约流程。" : "当前请求未通过预校验，请先调整日期、时间或座位。"
  };
}

module.exports = {
  normalizeFilters,
  scoreSeat,
  buildReasonList,
  buildSeatAvailability,
  filterSeats,
  buildZoneCounts,
  buildReservationPreview
};
