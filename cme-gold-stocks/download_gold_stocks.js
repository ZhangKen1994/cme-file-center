#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const CONFIG = {
  label: "com.ken.cme-gold-stocks",
  timezone: "America/New_York",
  downloadUrl: "https://www.cmegroup.com/delivery_reports/Gold_Stocks.xls",
  holidayCalendarUrl: "https://www.cmegroup.com/tools-information/holiday-calendar.html",
  reportName: "Gold_Stocks",
  activeHoursNy: { start: 12, end: 15 },
  requestTimeoutMs: 40000,
  baseDir: path.join(os.homedir(), "Documents", "CME-Gold-Stocks"),
};

const paths = {
  downloadsDir: path.join(CONFIG.baseDir, "downloads"),
  logsDir: path.join(CONFIG.baseDir, "logs"),
  tempDir: path.join(CONFIG.baseDir, "tmp"),
  stateFile: path.join(CONFIG.baseDir, "state.json"),
  runLogFile: path.join(CONFIG.baseDir, "logs", "run.log"),
  tempDownloadFile: path.join(CONFIG.baseDir, "tmp", `${CONFIG.reportName}.xls`),
};

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const skipDateCheck = args.has("--skip-date-check");

async function main() {
  ensureDirectories();

  const nyNow = dayjs().tz(CONFIG.timezone);
  const holidaySet = await fetchCmeClearingHolidays();
  const todayNy = nyNow.startOf("day");

  if (!force) {
    if (!isCmeBusinessDay(todayNy, holidaySet)) {
      log(
        `skip: ${todayNy.format("YYYY-MM-DD")} is not a CME business day in New York`
      );
      return;
    }

    const hour = nyNow.hour();
    if (hour < CONFIG.activeHoursNy.start || hour > CONFIG.activeHoursNy.end) {
      log(
        `skip: New York time ${nyNow.format(
          "YYYY-MM-DD HH:mm:ss"
        )} is outside ${CONFIG.activeHoursNy.start}:00-${CONFIG.activeHoursNy.end}:59`
      );
      return;
    }
  }

  const expectedActivityDate = previousCmeBusinessDay(todayNy, holidaySet).format(
    "YYYY-MM-DD"
  );
  const expectedReportDate = todayNy.format("YYYY-MM-DD");

  const downloadResult = await downloadReport();
  const parsed = parseReport(downloadResult.buffer);

  log(
    `downloaded reportDate=${parsed.reportDate} activityDate=${parsed.activityDate} lastModified=${
      downloadResult.lastModified || "n/a"
    } etag=${downloadResult.etag || "n/a"}`
  );

  if (!skipDateCheck) {
    const mismatches = [];

    if (parsed.reportDate !== expectedReportDate) {
      mismatches.push(
        `reportDate expected ${expectedReportDate}, got ${parsed.reportDate || "missing"}`
      );
    }

    if (parsed.activityDate !== expectedActivityDate) {
      mismatches.push(
        `activityDate expected ${expectedActivityDate}, got ${parsed.activityDate || "missing"}`
      );
    }

    if (mismatches.length > 0 && !force) {
      log(`skip: ${mismatches.join("; ")}`);
      writeState({
        status: "skipped_date_mismatch",
        checkedAt: new Date().toISOString(),
        expectedReportDate,
        expectedActivityDate,
        actualReportDate: parsed.reportDate,
        actualActivityDate: parsed.activityDate,
        lastModified: downloadResult.lastModified,
        etag: downloadResult.etag,
      });
      return;
    }
  }

  const targetFile = path.join(
    paths.downloadsDir,
    `${parsed.activityDate || expectedActivityDate}_${CONFIG.reportName}.xls`
  );
  const metadataFile = targetFile.replace(/\.xls$/i, ".json");
  const alreadyExists = fs.existsSync(targetFile);

  if (!alreadyExists) {
    fs.copyFileSync(paths.tempDownloadFile, targetFile);
  }

  fs.writeFileSync(
    metadataFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        reportDate: parsed.reportDate,
        activityDate: parsed.activityDate,
        sourceUrl: CONFIG.downloadUrl,
        lastModified: downloadResult.lastModified,
        etag: downloadResult.etag,
        contentLength: downloadResult.contentLength,
      },
      null,
      2
    )
  );

  writeState({
    status: alreadyExists ? "duplicate" : "saved",
    savedAt: new Date().toISOString(),
    file: targetFile,
    reportDate: parsed.reportDate,
    activityDate: parsed.activityDate,
    lastModified: downloadResult.lastModified,
    etag: downloadResult.etag,
  });

  log(
    alreadyExists
      ? `duplicate: ${path.basename(targetFile)} already exists`
      : `saved: ${targetFile}`
  );
}

async function fetchCmeClearingHolidays() {
  try {
    const html = pythonFetchText(CONFIG.holidayCalendarUrl);
    const sectionMatch = html.match(
      /<h2 id="clearing"[\s\S]*?<\/table>/i
    );

    if (!sectionMatch) {
      throw new Error("unable to locate CME Clearing section");
    }

    const dateMatches =
      sectionMatch[0].match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/g) || [];

    const holidays = new Set();

    for (const rawDate of dateMatches) {
      const parsed = dayjs.tz(rawDate, "D MMMM YYYY", CONFIG.timezone);
      if (parsed.isValid()) {
        holidays.add(parsed.format("YYYY-MM-DD"));
      }
    }

    log(`loaded ${holidays.size} CME clearing holiday dates`);
    return holidays;
  } catch (error) {
    log(`warning: failed to load CME clearing holidays, weekend-only fallback: ${error.message}`);
    return new Set();
  }
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

async function downloadReport() {
  const metadata = pythonDownloadBinary(CONFIG.downloadUrl, paths.tempDownloadFile);

  const buffer = fs.readFileSync(paths.tempDownloadFile);

  if (buffer.length === 0) {
    throw new Error("downloaded file is empty");
  }

  return {
    buffer,
    lastModified: metadata["last-modified"] || null,
    etag: metadata.etag || null,
    contentLength: metadata["content-length"] || null,
  };
}

function parseReport(buffer) {
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
    throw new Error("unable to extract Report Date and Activity Date from workbook");
  }

  return { reportDate, activityDate, sheetName };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureDirectories() {
  fs.mkdirSync(paths.downloadsDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.mkdirSync(paths.tempDir, { recursive: true });
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
        `with urllib.request.urlopen(req, timeout=${Math.ceil(CONFIG.requestTimeoutMs / 1000)}) as response:`,
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
        `with urllib.request.urlopen(req, timeout=${Math.ceil(CONFIG.requestTimeoutMs / 1000)}) as response:`,
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

function writeState(state) {
  fs.writeFileSync(paths.stateFile, JSON.stringify(state, null, 2));
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(paths.runLogFile, `${line}\n`);
  console.log(line);
}

main().catch((error) => {
  ensureDirectories();
  log(`error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
