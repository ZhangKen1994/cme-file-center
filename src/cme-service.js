const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const XLSX = require("xlsx");
const { db, dataDir } = require("./db");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const CONFIG = {
  timezone: "America/New_York",
  downloadUrl: "https://www.cmegroup.com/delivery_reports/Gold_Stocks.xls",
  holidayCalendarUrl: "https://www.cmegroup.com/tools-information/holiday-calendar.html",
  reportName: "Gold_Stocks",
  activeHoursNy: { start: 12, end: 15 },
  requestTimeoutSeconds: 40,
  storageDir: process.env.CME_STORAGE_DIR
    ? path.resolve(process.env.CME_STORAGE_DIR)
    : path.join(dataDir, "cme-downloads"),
  tempDir: path.join(os.tmpdir(), "cme-gold-stocks"),
};

function ensureCmeDirectories() {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
  fs.mkdirSync(CONFIG.tempDir, { recursive: true });
}

function isCmeBusinessDay(day, holidaySet) {
  const weekday = day.day();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return !holidaySet.has(day.format("YYYY-MM-DD"));
}

function previousCmeBusinessDay(day, holidaySet) {
  let cursor = day.subtract(1, "day").startOf("day");
  while (!isCmeBusinessDay(cursor, holidaySet)) {
    cursor = cursor.subtract(1, "day");
  }
  return cursor;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDate(rows, label) {
  const pattern = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4})`, "i");

  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell !== "string") {
        continue;
      }

      const match = cell.match(pattern);
      if (!match) {
        continue;
      }

      const parsed = dayjs.tz(match[1], "M/D/YYYY", CONFIG.timezone);
      if (parsed.isValid()) {
        return parsed.format("YYYY-MM-DD");
      }
    }
  }

  return null;
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("workbook has no sheets");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });

  const reportDate = extractDate(rows, "Report Date");
  const activityDate = extractDate(rows, "Activity Date");

  if (!reportDate || !activityDate) {
    throw new Error("unable to extract Report Date and Activity Date");
  }

  return { sheetName, reportDate, activityDate };
}

function pythonFetchText(url) {
  return execFileSync(
    "python3",
    [
      "-c",
      [
        "import sys, urllib.request",
        "url = sys.argv[1]",
        "req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'})",
        `with urllib.request.urlopen(req, timeout=${CONFIG.requestTimeoutSeconds}) as response:`,
        "    sys.stdout.write(response.read().decode('utf-8', 'ignore'))",
      ].join("\n"),
      url,
    ],
    { encoding: "utf8" }
  );
}

function pythonDownloadBinary(url, targetFile) {
  const metadataJson = execFileSync(
    "python3",
    [
      "-c",
      [
        "import json, sys, urllib.request",
        "url = sys.argv[1]",
        "target = sys.argv[2]",
        "req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'})",
        `with urllib.request.urlopen(req, timeout=${CONFIG.requestTimeoutSeconds}) as response:`,
        "    data = response.read()",
        "    with open(target, 'wb') as f:",
        "        f.write(data)",
        "    headers = {k.lower(): v for k, v in response.headers.items()}",
        "    print(json.dumps(headers))",
      ].join("\n"),
      url,
      targetFile,
    ],
    { encoding: "utf8" }
  );

  return JSON.parse(metadataJson);
}

function fetchCmeClearingHolidays() {
  const html = pythonFetchText(CONFIG.holidayCalendarUrl);
  const sectionMatch = html.match(/<h2 id="clearing"[\s\S]*?<\/table>/i);
  if (!sectionMatch) {
    throw new Error("unable to locate CME Clearing section");
  }

  const rawDates = sectionMatch[0].match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/g) || [];
  const holidays = new Set();

  for (const rawDate of rawDates) {
    const parsed = dayjs.tz(rawDate, "D MMMM YYYY", CONFIG.timezone);
    if (parsed.isValid()) {
      holidays.add(parsed.format("YYYY-MM-DD"));
    }
  }

  return holidays;
}

function logCmeRun(entry) {
  db.prepare(
    `
      INSERT INTO cme_download_logs (
        status, message, report_date, activity_date, expected_report_date,
        expected_activity_date, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    entry.status,
    entry.message,
    entry.reportDate || null,
    entry.activityDate || null,
    entry.expectedReportDate || null,
    entry.expectedActivityDate || null,
    entry.fileId || null,
    new Date().toISOString()
  );
}

function getLatestCmeStatus() {
  return (
    db.prepare(
      `
        SELECT *
        FROM cme_download_logs
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
    ).get() || null
  );
}

function listCmeFiles() {
  return db.prepare(
    `
      SELECT *
      FROM cme_download_files
      ORDER BY activity_date DESC, created_at DESC, id DESC
    `
  ).all();
}

function listRecentCmeLogs(limit = 20) {
  return db.prepare(
    `
      SELECT l.*, f.stored_filename
      FROM cme_download_logs l
      LEFT JOIN cme_download_files f ON f.id = l.file_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ?
    `
  ).all(limit);
}

function getCmeDashboardData() {
  const files = listCmeFiles();
  const stats = {
    totalFiles: db.prepare("SELECT COUNT(*) AS count FROM cme_download_files").get().count,
    successRuns: db
      .prepare("SELECT COUNT(*) AS count FROM cme_download_logs WHERE status IN ('saved', 'duplicate')")
      .get().count,
    failedRuns: db
      .prepare("SELECT COUNT(*) AS count FROM cme_download_logs WHERE status = 'failed'")
      .get().count,
    skippedRuns: db
      .prepare("SELECT COUNT(*) AS count FROM cme_download_logs WHERE status LIKE 'skip_%'")
      .get().count,
  };

  return {
    stats,
    files,
    latestStatus: getLatestCmeStatus(),
    recentLogs: listRecentCmeLogs(),
  };
}

function getCmeFileById(id) {
  return db.prepare("SELECT * FROM cme_download_files WHERE id = ?").get(id);
}

async function runCmeDownloadCycle(options = {}) {
  ensureCmeDirectories();

  const force = Boolean(options.force);
  const skipDateValidation = Boolean(options.skipDateValidation);
  const nowNy = dayjs().tz(CONFIG.timezone);
  const todayNy = nowNy.startOf("day");

  let holidaySet = new Set();
  try {
    holidaySet = fetchCmeClearingHolidays();
  } catch (error) {
    holidaySet = new Set();
  }

  const expectedReportDate = todayNy.format("YYYY-MM-DD");
  const expectedActivityDate = previousCmeBusinessDay(todayNy, holidaySet).format("YYYY-MM-DD");

  if (!force) {
    if (!isCmeBusinessDay(todayNy, holidaySet)) {
      const message = `${expectedReportDate} is not a CME business day`;
      logCmeRun({
        status: "skip_non_business_day",
        message,
        expectedReportDate,
        expectedActivityDate,
      });
      return { status: "skip_non_business_day", message };
    }

    const hour = nowNy.hour();
    if (hour < CONFIG.activeHoursNy.start || hour > CONFIG.activeHoursNy.end) {
      const message = `New York time ${nowNy.format("YYYY-MM-DD HH:mm:ss")} is outside the download window`;
      logCmeRun({
        status: "skip_outside_window",
        message,
        expectedReportDate,
        expectedActivityDate,
      });
      return { status: "skip_outside_window", message };
    }
  }

  try {
    const tempFile = path.join(CONFIG.tempDir, `${CONFIG.reportName}.xls`);
    const metadata = pythonDownloadBinary(CONFIG.downloadUrl, tempFile);
    const buffer = fs.readFileSync(tempFile);

    if (!buffer.length) {
      throw new Error("downloaded file is empty");
    }

    const parsed = parseWorkbook(buffer);

    if (!skipDateValidation) {
      if (parsed.reportDate !== expectedReportDate) {
        const message = `report date mismatch: expected ${expectedReportDate}, got ${parsed.reportDate}`;
        logCmeRun({
          status: "skip_report_date_mismatch",
          message,
          reportDate: parsed.reportDate,
          activityDate: parsed.activityDate,
          expectedReportDate,
          expectedActivityDate,
        });
        return { status: "skip_report_date_mismatch", message };
      }

      if (parsed.activityDate !== expectedActivityDate) {
        const message = `activity date mismatch: expected ${expectedActivityDate}, got ${parsed.activityDate}`;
        logCmeRun({
          status: "skip_activity_date_mismatch",
          message,
          reportDate: parsed.reportDate,
          activityDate: parsed.activityDate,
          expectedReportDate,
          expectedActivityDate,
        });
        return { status: "skip_activity_date_mismatch", message };
      }
    }

    const storedFilename = `${parsed.activityDate}_${CONFIG.reportName}.xls`;
    const storedPath = path.join(CONFIG.storageDir, storedFilename);
    const existing = db
      .prepare("SELECT * FROM cme_download_files WHERE activity_date = ? LIMIT 1")
      .get(parsed.activityDate);

    if (existing) {
      logCmeRun({
        status: "duplicate",
        message: `${storedFilename} already exists`,
        reportDate: parsed.reportDate,
        activityDate: parsed.activityDate,
        expectedReportDate,
        expectedActivityDate,
        fileId: existing.id,
      });
      return { status: "duplicate", file: existing };
    }

    fs.copyFileSync(tempFile, storedPath);
    const now = new Date().toISOString();
    const insert = db.prepare(
      `
        INSERT INTO cme_download_files (
          source_url, stored_filename, stored_path, report_date, activity_date,
          file_size_bytes, last_modified, etag, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    const result = insert.run(
      CONFIG.downloadUrl,
      storedFilename,
      storedPath,
      parsed.reportDate,
      parsed.activityDate,
      buffer.length,
      metadata["last-modified"] || null,
      metadata.etag || null,
      now
    );

    logCmeRun({
      status: "saved",
      message: `saved ${storedFilename}`,
      reportDate: parsed.reportDate,
      activityDate: parsed.activityDate,
      expectedReportDate,
      expectedActivityDate,
      fileId: result.lastInsertRowid,
    });

    return {
      status: "saved",
      file: getCmeFileById(result.lastInsertRowid),
    };
  } catch (error) {
    const message = error.message || "download failed";
    logCmeRun({
      status: "failed",
      message,
      expectedReportDate,
      expectedActivityDate,
    });
    return { status: "failed", message };
  }
}

module.exports = {
  CONFIG,
  ensureCmeDirectories,
  getCmeDashboardData,
  getCmeFileById,
  runCmeDownloadCycle,
};
