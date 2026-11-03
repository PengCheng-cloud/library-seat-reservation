const fs = require("fs/promises");
const path = require("path");
const { getRecommendationRuntime } = require("./recommendation-runtime");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DATA_DIR = path.resolve(ROOT, "data");

const DEFAULT_OVERVIEW = {
  generatedAt: "",
  experiments: []
};

function formatPercent(value) {
  const num = Number(value || 0);
  return `${(num * 100).toFixed(2)}%`;
}

function pickMetricValue(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && item[key] !== "") {
      return item[key];
    }
  }
  return 0;
}

function parseRunTimeFromPath(runDir) {
  const folderName = path.basename(runDir || "");
  const matched = folderName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!matched) {
    return "";
  }

  return `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${matched[6]}`;
}

async function safeReadText(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    return "";
  }
}

async function readLatestMetadata(rootDir) {
  const latestRunFile = path.resolve(DATA_DIR, rootDir, "latest_run.txt");
  const runDir = (await safeReadText(latestRunFile)).trim();
  if (!runDir) {
    return null;
  }

  try {
    const metadataText = await fs.readFile(path.resolve(runDir, "run_metadata.json"), "utf8");
    return {
      runDir,
      metadata: JSON.parse(metadataText)
    };
  } catch (error) {
    return null;
  }
}

function buildExperimentCard(key, title, summary) {
  if (!summary || !summary.metadata || !summary.metadata.metrics || !summary.metadata.metrics.length) {
    return null;
  }

  const bestMetric = summary.metadata.metrics[0];
  const featureCount = Array.isArray(summary.metadata.feature_columns)
    ? summary.metadata.feature_columns.length
    : 0;
  const classCount = Array.isArray(summary.metadata.class_order)
    ? summary.metadata.class_order.length
    : 4;

  return {
    key,
    title,
    generatedAt: parseRunTimeFromPath(summary.runDir),
    bestModel: summary.metadata.best_model || bestMetric["模型"] || "",
    accuracyText: formatPercent(bestMetric["准确率"]),
    macroF1Text: formatPercent(bestMetric["宏平均F1"]),
    precisionText: formatPercent(bestMetric["宏平均精确率"]),
    recallText: formatPercent(bestMetric["宏平均召回率"]),
    featureCount,
    classCount,
    metricRows: summary.metadata.metrics.slice(0, 4).map((item) => ({
      model: item["模型"],
      accuracyText: formatPercent(item["准确率"]),
      macroF1Text: formatPercent(item["宏平均F1"])
    }))
  };
}

function buildRuntimeExperimentCard() {
  const runtime = getRecommendationRuntime();
  if (!runtime.available || !runtime.experiment) {
    return null;
  }

  const experiment = runtime.experiment || {};
  const dataset = runtime.dataset || {};
  const deploymentModel = experiment.deploymentModel || experiment.bestModel || {};
  const metricRows = Array.isArray(experiment.metricRows) ? experiment.metricRows : [];

  return {
    key: "defense-multilabel-seat",
    title: "答辩版座位级多标签分类实验",
    generatedAt: experiment.runAt || "",
    taskType: experiment.taskType || "座位级多标签分类",
    datasetName: dataset.name || "答辩版多标签座位数据集",
    bestModel: deploymentModel.name || "支持向量机 SVM",
    accuracyText: "",
    macroF1Text: formatPercent(deploymentModel.macroF1),
    precisionText: formatPercent(deploymentModel.macroPrecision),
    recallText: formatPercent(deploymentModel.macroRecall),
    featureCount: Number(dataset.featureCount || 0),
    classCount: Number(dataset.labelCount || 0),
    deploymentReason: experiment.deploymentReason || "",
    deepLearningModel: experiment.deepLearningModel
      ? {
          name: experiment.deepLearningModel.name || "",
          macroF1Text: formatPercent(experiment.deepLearningModel.macroF1),
          microF1Text: formatPercent(experiment.deepLearningModel.microF1)
        }
      : null,
    metricRows: metricRows.slice(0, 7).map((item) => ({
      model: item.model,
      accuracyText: "",
      macroF1Text: formatPercent(item.macroF1)
    }))
  };
}

async function buildMatchingExperimentCard() {
  const text = await safeReadText(path.resolve(DATA_DIR, "seat_matching_runtime.json"));
  if (!text) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return null;
  }

  const dataset = payload.dataset || {};
  const experiment = payload.experiment || {};
  const deploymentModel = experiment.deploymentModel || {};
  const metricRows = Array.isArray(experiment.metricRows) ? experiment.metricRows : [];

  return {
    key: "request-seat-matching",
    title: "需求-座位匹配推荐实验",
    generatedAt: payload.generatedAt || "",
    taskType: experiment.taskType || "需求-座位多标签匹配分类",
    datasetName: dataset.name || "需求-座位多标签匹配推荐数据集",
    bestModel: deploymentModel.name || "支持向量机 SVM",
    accuracyText: "",
    macroF1Text: formatPercent(deploymentModel.f1 || deploymentModel.macroF1),
    precisionText: formatPercent(deploymentModel.precision),
    recallText: formatPercent(deploymentModel.recall),
    featureCount: Number(dataset.featureCount || 0),
    classCount: Number(dataset.labelCount || 1),
    deploymentReason: experiment.deploymentReason || "",
    deepLearningModel: null,
    metricRows: metricRows.slice(0, 7).map((item) => ({
      model: item.model_name || item.model,
      accuracyText: formatPercent(pickMetricValue(item, ["subset_accuracy", "accuracy"])),
      macroF1Text: formatPercent(pickMetricValue(item, ["macro_f1", "macroF1", "f1"]))
    }))
  };
}

async function getAlgorithmOverview() {
  const [matchingCard, tableGroupSummary, seatSummary] = await Promise.all([
    buildMatchingExperimentCard(),
    readLatestMetadata("table_group_scene_experiment_results"),
    readLatestMetadata("classification_experiment_results")
  ]);

  const experiments = [
    matchingCard || buildRuntimeExperimentCard(),
    buildExperimentCard("table-group", "桌组级场景分类实验", tableGroupSummary),
    buildExperimentCard("seat-classification", "座位级类别识别实验", seatSummary)
  ].filter(Boolean);

  return {
    generatedAt: experiments[0] ? experiments[0].generatedAt : "",
    experiments
  };
}

module.exports = {
  getAlgorithmOverview
};
