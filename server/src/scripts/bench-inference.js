// Latency of the recommendation model: a new Python process per request ("oneshot")
// against the long-lived worker. Also checks that both give the same seats and scores.
//
//   npm run bench:inference
//
// Needs Python with scikit-learn and a trained model
// (python scripts/build_matching_recommendation_pipeline.py). No database needed.

const assert = require("assert/strict");
const path = require("path");
const { performance } = require("perf_hooks");

const seatMaster = require(path.resolve(__dirname, "..", "..", "..", "data", "seat_master.json"));
const allSeats = seatMaster.seats.map((seat) => ({ seatId: seat.seatId }));

const request = {
  message: "我晚上来图书馆，希望避开通道、有插座",
  filters: ["power_outlet"],
  sceneKey: "sprint",
  startTime: "18:00",
  endTime: "21:00"
};

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function measure(mode, seats, runs) {
  process.env.SVM_INFERENCE_MODE = mode;
  // Load the module again so that it reads the mode.
  delete require.cache[require.resolve("../lib/svm-runtime-inference")];
  const inference = require("../lib/svm-runtime-inference");
  if (mode === "worker") {
    await inference.predictSeatRuntime(seats.slice(0, 1), request); // start the worker, not timed
  }

  const times = [];
  let last;
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    last = await inference.predictSeatRuntime(seats, request);
    times.push(performance.now() - startedAt);
  }
  inference.shutdownInferenceWorker();
  times.sort((a, b) => a - b);
  return { p50: percentile(times, 50), p95: percentile(times, 95), last };
}

async function main() {
  console.log("seats   mode      runs   p50 ms   p95 ms");
  for (const count of [20, 200, allSeats.length]) {
    const seats = allSeats.slice(0, count);
    const oneshot = await measure("oneshot", seats, 5);
    const worker = await measure("worker", seats, 30);
    for (const [mode, runs, result] of [["oneshot", 5, oneshot], ["worker", 30, worker]]) {
      console.log(
        `${String(count).padStart(5)}   ${mode.padEnd(8)}  ${String(runs).padStart(4)}   ${result.p50.toFixed(0).padStart(6)}   ${result.p95.toFixed(0).padStart(6)}`
      );
    }
    // Same model, same input: the seats and all their scores must be identical.
    assert.deepEqual(worker.last.seats, oneshot.last.seats);
    assert.deepEqual(worker.last.groups, oneshot.last.groups);
  }
  console.log("\nworker and oneshot results are identical");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
