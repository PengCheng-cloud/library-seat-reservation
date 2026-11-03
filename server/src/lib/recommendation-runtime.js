const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const RUNTIME_FILE = path.join(DATA_DIR, "seat_recommendation_runtime.json");
const MATCHING_RUNTIME_FILE = path.join(DATA_DIR, "seat_matching_runtime.json");

let cache = null;

function buildEmptyRuntime() {
  return {
    available: false,
    generatedAt: "",
    dataset: {
      path: "",
      demandCount: 0,
      groupCount: 0,
      seatCount: 0
    },
    experiment: {
      runDir: "",
      runAt: "",
      bestModel: {
        name: "",
        shortName: "",
        isDeepLearning: false,
        accuracy: 0,
        macroPrecision: 0,
        macroRecall: 0,
        macroF1: 0
      },
      featureColumns: [],
      labelColumn: "",
      groupColumn: "",
      metricRows: []
    },
    sceneProfiles: {},
    groups: {},
    seats: {},
    seatMap: new Map(),
    groupMap: new Map()
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function mergeMatchingExperimentRuntime(baseRuntime, matchingRuntime) {
  if (!matchingRuntime || !matchingRuntime.experiment || !matchingRuntime.dataset) {
    return baseRuntime;
  }

  return {
    ...baseRuntime,
    generatedAt: matchingRuntime.generatedAt || baseRuntime.generatedAt || "",
    dataset: {
      ...(baseRuntime.dataset || {}),
      ...(matchingRuntime.dataset || {})
    },
    experiment: {
      ...(baseRuntime.experiment || {}),
      ...(matchingRuntime.experiment || {})
    }
  };
}

function loadRuntime() {
  const basePayload = readJson(RUNTIME_FILE);
  if (!basePayload) {
    return buildEmptyRuntime();
  }

  const payload = mergeMatchingExperimentRuntime(basePayload, readJson(MATCHING_RUNTIME_FILE));
  const seats = payload.seats || {};
  const groups = payload.groups || {};
  return {
    available: true,
    ...payload,
    seatMap: new Map(Object.entries(seats)),
    groupMap: new Map(Object.entries(groups))
  };
}

function getRecommendationRuntime() {
  if (!cache) {
    cache = loadRuntime();
  }
  return cache;
}

function getRuntimeSeat(seatId) {
  if (!seatId) {
    return null;
  }
  return getRecommendationRuntime().seatMap.get(String(seatId)) || null;
}

function getRuntimeGroup(groupId) {
  if (!groupId) {
    return null;
  }
  return getRecommendationRuntime().groupMap.get(String(groupId)) || null;
}

module.exports = {
  getRecommendationRuntime,
  getRuntimeSeat,
  getRuntimeGroup
};
