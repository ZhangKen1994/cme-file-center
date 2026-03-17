require("dotenv").config();

const express = require("express");
const path = require("path");
const dayjs = require("dayjs");

const { initDb, db } = require("./src/db");
const {
  SESSION_COOKIE,
  clearSession,
  createSession,
  findUserByCredentials,
  getUserFromRequest,
} = require("./src/auth-service");
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
    const message =
      result.status === "saved"
        ? "CME 文件已下载"
        : result.status === "duplicate"
          ? "今天对应的文件已经存在"
          : result.message || "检查已完成";
    res.redirect(`/?flash=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
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

setInterval(() => {
  runCmeDownloadCycle().catch((error) => {
    console.error("[scheduler] runCmeDownloadCycle failed:", error);
  });
}, 30 * 60 * 1000);

runCmeDownloadCycle().catch((error) => {
  console.error("[startup] initial CME scan failed:", error);
});

app.listen(port, () => {
  console.log(`CME file center running at http://localhost:${port}`);
});
