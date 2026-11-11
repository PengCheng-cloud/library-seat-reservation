// Calls the Python model (scripts/realtime_svm_predict.py) for seat recommendations.
//
// Two ways to run it:
//
//   worker  (default) One long-lived Python process. It loads the model and the seat
//           profiles once and then answers one request per line on stdin/stdout.
//   oneshot Start a new Python process for every request. This was the first
//           implementation; almost all of its time goes into starting Python and
//           loading the model again (measurements in docs/recommendation.md).
//
// If the worker cannot be started or dies, the request falls back to a one-shot
// process, and the next request starts a new worker.
// Set SVM_INFERENCE_MODE=oneshot to switch the worker off.

const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "realtime_svm_predict.py");
const PYTHON_BIN = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const DEFAULT_TIMEOUT_MS = 30000;
const WORKER_START_TIMEOUT_MS = 60000;

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

// ---------------------------------------------------------------------------
// One-shot mode
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Worker mode
// ---------------------------------------------------------------------------

let worker = null; // { child, ready: Promise, pending: Map<id, { resolve, reject, timer }> }
let nextRequestId = 1;

function stopWorker(reason) {
  if (!worker) {
    return;
  }

  const stopped = worker;
  worker = null;
  for (const request of stopped.pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  stopped.pending.clear();
  stopped.rejectReady(new Error(reason));
  if (stopped.child.exitCode === null) {
    stopped.child.kill();
  }
}

function startWorker() {
  const child = spawn(PYTHON_BIN, [SCRIPT_PATH, "--serve"], {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const started = { child, pending: new Map() };
  started.ready = new Promise((resolve, reject) => {
    started.resolveReady = resolve;
    started.rejectReady = reject;
  });
  // The rejection is reported to the request that waits for the worker.
  started.ready.catch(() => {});
  worker = started;

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });

  const startTimer = setTimeout(() => {
    if (worker === started) {
      stopWorker("SVM worker did not start in time");
    }
  }, WORKER_START_TIMEOUT_MS);

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return; // not a protocol line, e.g. a warning printed by a library
    }

    if (message.ready) {
      clearTimeout(startTimer);
      started.resolveReady();
      return;
    }

    const request = started.pending.get(message.id);
    if (!request) {
      return; // answered after its timeout
    }

    started.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(new Error(`SVM 实时预测失败：${message.error}`));
    } else {
      request.resolve(message.result);
    }
  });

  const onGone = (detail) => {
    clearTimeout(startTimer);
    if (worker === started) {
      stopWorker(`SVM worker stopped: ${detail}${stderr ? `\n${stderr}` : ""}`);
    }
  };
  child.on("error", (error) => onGone(error.message));
  child.on("close", (code) => onGone(`exit code ${code}`));
  // Do not keep the Node.js process alive only because of the worker.
  child.unref();
  child.stdin.on("error", () => {});

  return started;
}

async function runWorkerInference(input, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const current = worker || startWorker();
  await current.ready;

  return new Promise((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;
    const timer = setTimeout(() => {
      current.pending.delete(id);
      reject(new Error(`SVM 实时预测超时：超过 ${timeoutMs}ms`));
    }, timeoutMs);
    current.pending.set(id, { resolve, reject, timer });
    current.child.stdin.write(`${JSON.stringify({ id, payload: input || {} })}\n`);
  });
}

function shutdownInferenceWorker() {
  stopWorker("SVM worker shut down");
}

// ---------------------------------------------------------------------------

function inferenceMode() {
  return process.env.SVM_INFERENCE_MODE === "oneshot" ? "oneshot" : "worker";
}

async function runInference(input, timeoutMs) {
  if (inferenceMode() === "oneshot") {
    return runPythonInference(input, timeoutMs);
  }

  try {
    return await runWorkerInference(input, timeoutMs);
  } catch (error) {
    // Worker missing or broken: answer this request the slow way.
    return runPythonInference(input, timeoutMs);
  }
}

async function predictSeatRuntime(seats, options = {}) {
  const seatIds = Array.from(new Set((seats || []).map((seat) => seat && seat.seatId).filter(Boolean)));
  const payload = await runInference({
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
  predictSeatRuntime,
  shutdownInferenceWorker
};
