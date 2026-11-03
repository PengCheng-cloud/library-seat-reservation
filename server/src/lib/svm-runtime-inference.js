const { spawn } = require("child_process");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "realtime_svm_predict.py");
const PYTHON_BIN = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const DEFAULT_TIMEOUT_MS = 30000;

function hydrateRuntime(payload) {
  const seats = payload && payload.seats ? payload.seats : {};
  const groups = payload && payload.groups ? payload.groups : {};
  return {
    available: true,
    ...payload,
    seatMap: new Map(Object.entries(seats)),
    groupMap: new Map(Object.entries(groups))
  };
}

function runPythonInference(input, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
      cwd: ROOT_DIR,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`SVM 实时预测超时：超过 ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`SVM 实时预测失败：${stderr || `Python exited with ${code}`}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`SVM 实时预测结果解析失败：${error.message}`));
      }
    });

    child.stdin.end(JSON.stringify(input || {}));
  });
}

async function predictSeatRuntime(seats, options = {}) {
  const seatIds = Array.from(new Set((seats || []).map((seat) => seat && seat.seatId).filter(Boolean)));
  const payload = await runPythonInference({
    seatIds,
    requestId: options.requestId || "",
    message: options.message || "",
    filters: options.filters || [],
    sceneKey: options.sceneKey || "",
    startTime: options.startTime || "",
    endTime: options.endTime || ""
  }, options.timeoutMs);
  return hydrateRuntime(payload);
}

module.exports = {
  predictSeatRuntime
};
