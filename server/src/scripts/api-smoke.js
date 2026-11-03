const assert = require("assert/strict");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_PORT = Number(process.env.SMOKE_PORT || 3101);
const DEFAULT_HOST = process.env.SMOKE_HOST || "127.0.0.1";
const SERVER_ENTRY = path.resolve(__dirname, "..", "index.js");
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_BASE_URL = String(process.env.SMOKE_BASE_URL || "").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildHeaders(token, extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function request(baseUrl, pathname, options = {}) {
  const {
    method = "GET",
    token = "",
    body,
    headers = {}
  } = options;

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: buildHeaders(token, headers),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    const message = data && data.message ? data.message : `${method} ${pathname} failed with ${response.status}`;
    const requestError = new Error(message);
    requestError.statusCode = response.status;
    requestError.payload = data;
    throw requestError;
  }

  return data;
}

async function waitForHealth(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await request(baseUrl, "/api/health");
      return;
    } catch (error) {
      await sleep(500);
    }
  }

  throw new Error(`服务未在 ${timeoutMs}ms 内启动完成`);
}

function createStudentNo() {
  return `9${String(Date.now()).slice(-9)}`;
}

async function findAvailableSeat(baseUrl, token, advanceDays) {
  const timeWindows = [
    { startTime: "09:00", endTime: "11:00" },
    { startTime: "14:00", endTime: "16:00" },
    { startTime: "18:00", endTime: "20:00" }
  ];
  const startOffset = advanceDays > 0 ? 1 : 0;
  const endOffset = Math.max(startOffset, Number(advanceDays) || 1);
  const today = new Date();

  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    const reservationDate = formatDate(addDays(today, offset));

    for (const window of timeWindows) {
      const query = new URLSearchParams({
        reservationDate,
        startTime: window.startTime,
        endTime: window.endTime,
        limit: "30"
      });

      const response = await request(baseUrl, `/api/seats?${query.toString()}`, {
        token
      });

      const seat = (response.items || []).find((item) => item.canReserve);
      if (seat) {
        return {
          seatId: seat.seatId,
          reservationDate,
          startTime: window.startTime,
          endTime: window.endTime
        };
      }
    }
  }

  throw new Error("未找到可用于测试的可预约座位");
}

async function tryAdminLogin(baseUrl) {
  // Admin accounts need a password (see "npm run set-password").
  if (!process.env.SMOKE_ADMIN_PASSWORD) {
    return null;
  }
  const candidates = [
    {
      studentNo: process.env.SMOKE_ADMIN_NO || "LIB001",
      password: process.env.SMOKE_ADMIN_PASSWORD
    }
  ];

  for (const candidate of candidates) {
    try {
      const loginResult = await request(baseUrl, "/api/admin/login", {
        method: "POST",
        body: candidate
      });

      const dashboard = await request(baseUrl, "/api/admin/dashboard", {
        token: loginResult.token
      });

      return {
        candidate,
        loginResult,
        dashboard
      };
    } catch (error) {
      continue;
    }
  }

  return null;
}

async function runSmoke(baseUrl) {
  const checkpoints = [];

  const health = await request(baseUrl, "/api/health");
  assert.equal(health.ok, true, "健康检查应返回 ok=true");
  checkpoints.push("health");

  const home = await request(baseUrl, "/api/home");
  assert.ok(home && home.summary, "首页接口应返回 summary");
  checkpoints.push("home");

  const rulesResponse = await request(baseUrl, "/api/rules");
  assert.ok(rulesResponse && rulesResponse.rules, "规则接口应返回 rules");
  checkpoints.push("rules");

  const studentNo = createStudentNo();
  const realName = "接口测试用户";
  const password = "smoke-test-password";

  const registerResult = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: {
      studentNo,
      realName,
      password
    }
  });
  assert.ok(registerResult.token, "注册后应返回 token");
  checkpoints.push("register");

  const loginResult = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: {
      studentNo,
      realName,
      password
    }
  });
  assert.ok(loginResult.token, "登录后应返回 token");
  const token = loginResult.token;
  checkpoints.push("login");

  const zones = await request(baseUrl, "/api/zones", {
    token
  });
  assert.ok(Array.isArray(zones.items), "分区接口应返回 items");
  checkpoints.push("zones");

  const seatPlan = await findAvailableSeat(baseUrl, token, rulesResponse.rules.advanceDays || 1);
  checkpoints.push("find-seat");

  const previewResult = await request(baseUrl, "/api/reservations/preview", {
    method: "POST",
    token,
    body: seatPlan
  });
  assert.equal(previewResult.valid, true, "预约预校验应通过");
  checkpoints.push("preview");

  const createResult = await request(baseUrl, "/api/reservations", {
    method: "POST",
    token,
    body: seatPlan
  });
  assert.ok(createResult.reservationNo, "创建预约后应返回 reservationNo");
  checkpoints.push("create");

  const reservationList = await request(baseUrl, "/api/reservations/me", {
    token
  });
  assert.ok(
    (reservationList.current || []).some((item) => item.reservationNo === createResult.reservationNo),
    "当前预约中应包含刚创建的预约"
  );
  checkpoints.push("reservations");

  const profile = await request(baseUrl, "/api/profile/me", {
    token
  });
  assert.equal(profile.user.studentNo, studentNo, "个人中心应返回当前登录用户");
  checkpoints.push("profile");

  const cancelResult = await request(
    baseUrl,
    `/api/reservations/${encodeURIComponent(createResult.reservationNo)}/cancel`,
    {
      method: "POST",
      token,
      body: {
        cancelReason: "smoke_test"
      }
    }
  );
  assert.ok(
    cancelResult.status === "cancelled" || cancelResult.message,
    "取消预约接口应成功返回"
  );
  checkpoints.push("cancel");

  const reservationListAfterCancel = await request(baseUrl, "/api/reservations/me", {
    token
  });
  assert.ok(
    !(reservationListAfterCancel.current || []).some((item) => item.reservationNo === createResult.reservationNo),
    "取消后不应继续出现在当前预约中"
  );
  checkpoints.push("reservations-after-cancel");

  const adminResult = await tryAdminLogin(baseUrl);
  if (adminResult) {
    assert.ok(adminResult.dashboard, "管理员登录成功后应返回 dashboard");
    checkpoints.push("admin-dashboard");
  }

  return {
    studentNo,
    reservationNo: createResult.reservationNo,
    seatId: createResult.seatId,
    checkpoints,
    adminChecked: Boolean(adminResult)
  };
}

function startServer(baseUrl) {
  if (EXTERNAL_BASE_URL) {
    return {
      baseUrl,
      child: null,
      logs: {
        stdout: [],
        stderr: []
      }
    };
  }

  const logs = {
    stdout: [],
    stderr: []
  };

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      PORT: String(DEFAULT_PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    logs.stdout.push(String(chunk));
    if (logs.stdout.length > 20) {
      logs.stdout.shift();
    }
  });

  child.stderr.on("data", (chunk) => {
    logs.stderr.push(String(chunk));
    if (logs.stderr.length > 20) {
      logs.stderr.shift();
    }
  });

  return {
    baseUrl,
    child,
    logs
  };
}

function stopServer(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore"
    });
    return;
  }

  child.kill("SIGTERM");
}

async function main() {
  const baseUrl = EXTERNAL_BASE_URL || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const server = startServer(baseUrl);

  try {
    await waitForHealth(baseUrl);
    const result = await runSmoke(baseUrl);

    console.log("Smoke test passed.");
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Checkpoints: ${result.checkpoints.join(", ")}`);
    console.log(`Test user: ${result.studentNo}`);
    console.log(`Reservation: ${result.reservationNo} (${result.seatId})`);
    console.log(`Admin dashboard checked: ${result.adminChecked ? "yes" : "no"}`);
  } catch (error) {
    console.error("Smoke test failed.");
    console.error(error.message);

    if (server.logs.stdout.length) {
      console.error("Recent server stdout:");
      console.error(server.logs.stdout.join(""));
    }

    if (server.logs.stderr.length) {
      console.error("Recent server stderr:");
      console.error(server.logs.stderr.join(""));
    }

    process.exitCode = 1;
  } finally {
    stopServer(server.child);
  }
}

main();
