require("dotenv").config();

const express = require("express");
const path = require("path");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

const { initDb, db } = require("./src/db");
const {
  SESSION_COOKIE,
  clearSession,
  createSession,
  findUserByCredentials,
  getUserFromRequest,
} = require("./src/auth-service");
const {
  CONFIG,
  getCmeDashboardData,
  getCmeFileById,
  runCmeDownloadCycle,
} = require("./src/cme-service");

const app = express();
const port = Number(process.env.PORT || 3000);
const scheduledRuns = new Set();

dayjs.extend(utc);
dayjs.extend(timezone);

initDb();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  req.user = getUserFromRequest(req);
  res.locals.currentPath = req.path;
  res.locals.flash = req.query.flash || "";
  res.locals.error = req.query.error || "";
  res.locals.currentUser = req.user;
  res.locals.formatDateTime = (value) =>
    value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-";
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) {
    res.redirect("/login?error=请先登录");
    return;
  }
  next();
}

app.get("/login", (req, res) => {
  if (req.user) {
    res.redirect("/");
    return;
  }
  res.render("cme-login");
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const user = findUserByCredentials(username, password);

  if (!user) {
    res.redirect("/login?error=账号或密码错误");
    return;
  }

  const session = createSession(user.id);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax`
  );
  res.redirect("/?flash=登录成功");
});

app.post("/logout", (req, res) => {
  if (req.user?.token) {
    clearSession(req.user.token);
  }
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`
  );
  res.redirect("/login?flash=已退出登录");
});

app.get("/", requireAuth, (req, res) => {
  res.render("cme-cloud", {
    cmeDashboard: getCmeDashboardData(),
  });
});

app.post("/run", requireAuth, async (req, res) => {
  try {
    const result = await runCmeDownloadCycle({ force: true });
    const saved = result.results?.filter((item) => item.status === "saved") || [];
    const failed = result.results?.filter((item) => item.status === "failed") || [];
    const duplicates = result.results?.filter((item) => item.status === "duplicate") || [];
    const reportMismatch = result.results?.find((item) => item.status === "skip_report_date_mismatch");
    const activityMismatch = result.results?.find((item) => item.status === "skip_activity_date_mismatch");

    let message = "检查已完成";
    if (saved.length === 2) {
      message = "黄金和白银都已更新";
    } else if (saved.length === 1) {
      message = `${saved[0].reportLabel === "Gold Stocks" ? "黄金" : "白银"}已更新`;
    } else if (failed.length > 0) {
      message = `${failed[0].reportLabel === "Gold Stocks" ? "黄金" : "白银"}暂时下载失败`;
    } else if (reportMismatch) {
      message = `${reportMismatch.reportLabel === "Gold Stocks" ? "黄金" : "白银"}今天还没更新`;
    } else if (activityMismatch) {
      message = `${activityMismatch.reportLabel === "Gold Stocks" ? "黄金" : "白银"}今天还没更新`;
    } else if (duplicates.length === 2) {
      message = "黄金和白银今天都已归档";
    } else if (duplicates.length === 1) {
      message = `${duplicates[0].reportLabel === "Gold Stocks" ? "黄金" : "白银"}今天已归档`;
    }

    res.redirect(`/?flash=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect("/?error=检查失败，请稍后再试");
  }
});

app.get("/files/:id/download", requireAuth, (req, res) => {
  const file = getCmeFileById(Number(req.params.id));
  if (!file) {
    res.redirect("/?error=文件不存在");
    return;
  }

  res.download(file.stored_path, file.stored_filename);
});

app.get("/health", (_req, res) => {
  const fileCount = db
    .prepare("SELECT COUNT(*) AS count FROM cme_download_files")
    .get().count;
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    files: fileCount,
  });
});

function getScheduleKey(nowNy) {
  return `${nowNy.format("YYYY-MM-DD-HH")}`;
}

async function runScheduledCycle(reason) {
  try {
    const result = await runCmeDownloadCycle();
    console.log(`[scheduler] ${reason}:`, result.status, result.reportLabel || "");
  } catch (error) {
    console.error(`[scheduler] ${reason} failed:`, error);
  }
}

function tickScheduler() {
  const nowNy = dayjs().tz(CONFIG.timezone);
  const hour = nowNy.hour();
  if (!CONFIG.activeHoursNy.includes(hour)) {
    return;
  }

  const minute = nowNy.minute();
  if (minute > 10) {
    return;
  }

  const key = getScheduleKey(nowNy);
  if (scheduledRuns.has(key)) {
    return;
  }

  scheduledRuns.add(key);
  runScheduledCycle(`ny-${key}`);
}

function primeCurrentWindow() {
  const nowNy = dayjs().tz(CONFIG.timezone);
  if (!CONFIG.activeHoursNy.includes(nowNy.hour())) {
    return;
  }

  const key = getScheduleKey(nowNy);
  if (scheduledRuns.has(key)) {
    return;
  }

  scheduledRuns.add(key);
  runScheduledCycle(`startup-ny-${key}`);
}

setInterval(tickScheduler, 60 * 1000);
primeCurrentWindow();

app.listen(port, () => {
  console.log(`CME file center running at http://localhost:${port}`);
});
