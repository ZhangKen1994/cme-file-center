const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "reminders.db"));

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      message TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      repeat_type TEXT NOT NULL DEFAULT 'once',
      is_active INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT NOT NULL,
      last_sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_response TEXT,
      sent_at TEXT NOT NULL,
      FOREIGN KEY(reminder_id) REFERENCES reminders(id)
    );

    CREATE TABLE IF NOT EXISTS cme_download_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_key TEXT,
      report_label TEXT,
      source_url TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      report_date TEXT,
      activity_date TEXT,
      file_size_bytes INTEGER,
      last_modified TEXT,
      etag TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cme_download_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_key TEXT,
      report_label TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      report_date TEXT,
      activity_date TEXT,
      expected_report_date TEXT,
      expected_activity_date TEXT,
      file_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(file_id) REFERENCES cme_download_files(id)
    );
  `);

  if (!hasColumn("reminders", "user_id")) {
    db.exec("ALTER TABLE reminders ADD COLUMN user_id INTEGER REFERENCES users(id)");
  }

  if (!hasColumn("cme_download_files", "report_key")) {
    db.exec("ALTER TABLE cme_download_files ADD COLUMN report_key TEXT");
  }

  if (!hasColumn("cme_download_files", "report_label")) {
    db.exec("ALTER TABLE cme_download_files ADD COLUMN report_label TEXT");
  }

  if (!hasColumn("cme_download_logs", "report_key")) {
    db.exec("ALTER TABLE cme_download_logs ADD COLUMN report_key TEXT");
  }

  if (!hasColumn("cme_download_logs", "report_label")) {
    db.exec("ALTER TABLE cme_download_logs ADD COLUMN report_label TEXT");
  }

  db.exec(`
    UPDATE cme_download_files
    SET report_key = COALESCE(report_key, 'gold'),
        report_label = COALESCE(report_label, 'Gold Stocks')
    WHERE report_key IS NULL OR report_label IS NULL;

    UPDATE cme_download_logs
    SET report_key = COALESCE(report_key, 'gold'),
        report_label = COALESCE(report_label, 'Gold Stocks')
    WHERE report_key IS NULL OR report_label IS NULL;
  `);

  const now = new Date().toISOString();
  const defaultAdminUsername = String(process.env.ADMIN_USERNAME || "admin").trim() || "admin";
  const defaultAdminPassword = String(process.env.ADMIN_PASSWORD || "123").trim() || "123";

  db.prepare(
    `
      INSERT OR IGNORE INTO users (username, password, role, created_at, updated_at)
      VALUES (?, ?, 'admin', ?, ?)
    `
  ).run(defaultAdminUsername, defaultAdminPassword, now, now);

  const admin = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(defaultAdminUsername);

  if (admin) {
    db.prepare("UPDATE reminders SET user_id = ? WHERE user_id IS NULL").run(admin.id);
  }
}

module.exports = {
  db,
  dataDir,
  initDb,
};
