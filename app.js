require("dotenv").config();

const express = require("express");
const path = require("path");
const dayjs = require("dayjs");

const { db, initDb } = require("./src/db");
const {
  SESSION_COOKIE,
  clearSession,
  createSession,
  createUser,
  findUserByCredentials,
  getUserFromRequest,
  listUsers,
} = require("./src/auth-service");
const {
  createReminder,
  deleteReminder,
  ensureReminderAccess,
  getDashboardData,
  getReminderById,
  runDueReminders,
  toggleReminder,
  triggerReminderNow,
} = require("./src/reminder-service");
const {
  getCmeDashboardData,
  getCmeFileById,
  runCmeDownloadCycle,
} = require("./src/cme-service");

const app = express();
const port = Number(process.env.PORT || 3000);

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

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    res.redirect("/reminders?error=只有管理员可以创建新用户");
    return;
  }
  next();
}

app.get("/login", (req, res) => {
  if (req.user) {
    res.redirect("/portal");
    return;
  }
  res.render("login");
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
  res.redirect("/portal?flash=登录成功");
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

app.get("/", (req, res) => {
  if (!req.user) {
    res.redirect("/login");
    return;
  }

  res.redirect("/portal");
});

app.get("/portal", requireAuth, (req, res) => {
  res.render("portal");
});

app.get("/reminders", requireAuth, (req, res) => {
  const dashboard = getDashboardData(req.user);
  res.render("reminders", {
    dashboard,
    defaults: {
      remindAt: dayjs().add(10, "minute").format("YYYY-MM-DDTHH:mm"),
    },
    smsConfig: {
      mode: process.env.SMS_MODE || "mock",
      webhookConfigured: Boolean(process.env.SMS_WEBHOOK_URL),
    },
    users: req.user.role === "admin" ? listUsers() : [],
  });
});

app.get("/cme", requireAuth, (req, res) => {
  res.render("cme", {
    cmeDashboard: getCmeDashboardData(),
  });
});

app.post("/reminders", requireAuth, (req, res) => {
  try {
    createReminder(req.body, req.user.id);
    res.redirect("/reminders?flash=提醒已创建");
  } catch (error) {
    res.redirect(`/reminders?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/cme/run", requireAuth, async (req, res) => {
  try {
    const result = await runCmeDownloadCycle({ force: true });
    const message =
      result.status === "saved"
        ? "CME 文件已下载"
        : result.status === "duplicate"
          ? "今天对应的文件已经存在"
          : result.message || "检查已完成";
    res.redirect(`/cme?flash=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(`/cme?error=${encodeURIComponent(error.message)}`);
  }
});

app.get("/cme/files/:id/download", requireAuth, (req, res) => {
  const file = getCmeFileById(Number(req.params.id));
  if (!file) {
    res.redirect("/cme?error=文件不存在");
    return;
  }

  res.download(file.stored_path, file.stored_filename);
});

app.post("/reminders/:id/toggle", requireAuth, (req, res) => {
  try {
    toggleReminder(Number(req.params.id), req.user);
    res.redirect("/reminders?flash=提醒状态已更新");
  } catch (error) {
    res.redirect(`/reminders?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/reminders/:id/send", requireAuth, async (req, res) => {
  try {
    const reminder = getReminderById(Number(req.params.id));
    ensureReminderAccess(reminder, req.user);
    await triggerReminderNow(reminder);
    res.redirect("/reminders?flash=已触发一次发送");
  } catch (error) {
    res.redirect(`/reminders?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/reminders/:id/delete", requireAuth, (req, res) => {
  try {
    deleteReminder(Number(req.params.id), req.user);
    res.redirect("/reminders?flash=提醒已删除");
  } catch (error) {
    res.redirect(`/reminders?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/users", requireAuth, requireAdmin, (req, res) => {
  try {
    createUser(req.body);
    res.redirect("/reminders?flash=新用户已创建");
  } catch (error) {
    res.redirect(`/reminders?error=${encodeURIComponent(error.message)}`);
  }
});

app.get("/health", (req, res) => {
  const reminderCount = db
    .prepare("SELECT COUNT(*) AS count FROM reminders")
    .get().count;
  res.json({
    status: "ok",
    now: new Date().toISOString(),
    reminders: reminderCount,
    smsMode: process.env.SMS_MODE || "mock",
  });
});

setInterval(() => {
  runDueReminders().catch((error) => {
    console.error("[scheduler] runDueReminders failed:", error);
  });
}, 30 * 1000);

setInterval(() => {
  runCmeDownloadCycle().catch((error) => {
    console.error("[scheduler] runCmeDownloadCycle failed:", error);
  });
}, 30 * 60 * 1000);

runDueReminders().catch((error) => {
  console.error("[startup] initial reminder scan failed:", error);
});

runCmeDownloadCycle().catch((error) => {
  console.error("[startup] initial CME scan failed:", error);
});

app.listen(port, () => {
  console.log(`Reminder admin running at http://localhost:${port}`);
});
