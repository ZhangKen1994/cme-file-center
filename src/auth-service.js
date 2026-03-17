const crypto = require("crypto");
const dayjs = require("dayjs");
const { db } = require("./db");

const SESSION_COOKIE = "reminder_session";
const SESSION_DAYS = 7;

function parseCookies(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split("=");
      acc[key] = decodeURIComponent(rest.join("="));
      return acc;
    }, {});
}

function findUserByCredentials(username, password) {
  return db
    .prepare(
      "SELECT * FROM users WHERE username = ? AND password = ? LIMIT 1"
    )
    .get(username, password);
}

function createSession(userId) {
  const now = new Date().toISOString();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = dayjs().add(SESSION_DAYS, "day").toISOString();

  db.prepare(
    `
      INSERT INTO user_sessions (token, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `
  ).run(token, userId, expiresAt, now);

  return { token, expiresAt };
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const session = db
    .prepare(
      `
        SELECT us.token, us.expires_at, u.id, u.username, u.role
        FROM user_sessions us
        JOIN users u ON u.id = us.user_id
        WHERE us.token = ?
        LIMIT 1
      `
    )
    .get(token);

  if (!session) {
    return null;
  }

  if (dayjs(session.expires_at).isBefore(dayjs())) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    return null;
  }

  return {
    id: session.id,
    username: session.username,
    role: session.role,
    token: session.token,
  };
}

function clearSession(token) {
  if (!token) return;
  db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
}

function listUsers() {
  return db
    .prepare(
      `
        SELECT id, username, role, created_at
        FROM users
        ORDER BY role ASC, username ASC
      `
    )
    .all();
}

function createUser(input) {
  const username = String(input.username || "").trim();
  const password = String(input.password || "").trim();
  const role = input.role === "admin" ? "admin" : "user";

  if (!username) throw new Error("用户名不能为空");
  if (!password) throw new Error("密码不能为空");

  const exists = db
    .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
    .get(username);
  if (exists) throw new Error("用户名已存在");

  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO users (username, password, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(username, password, role, now, now);
}

module.exports = {
  SESSION_COOKIE,
  clearSession,
  createSession,
  createUser,
  findUserByCredentials,
  getUserFromRequest,
  listUsers,
};
