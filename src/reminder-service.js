const dayjs = require("dayjs");
const { db } = require("./db");
const { sendSms } = require("./sms-service");

function validateReminderInput(input) {
  const title = String(input.title || "").trim();
  const phoneNumber = String(input.phoneNumber || "").trim();
  const message = String(input.message || "").trim();
  const repeatType = String(input.repeatType || "once");
  const remindAt = String(input.remindAt || "").trim();

  if (!title) throw new Error("标题不能为空");
  if (!phoneNumber) throw new Error("手机号不能为空");
  if (!message) throw new Error("提醒内容不能为空");
  if (!["once", "daily", "weekly"].includes(repeatType)) {
    throw new Error("重复规则不合法");
  }
  if (!dayjs(remindAt).isValid()) {
    throw new Error("提醒时间不合法");
  }

  return {
    title,
    phoneNumber,
    message,
    repeatType,
    remindAt: dayjs(remindAt).second(0).millisecond(0).toISOString(),
  };
}

function createReminder(input, userId) {
  const now = new Date().toISOString();
  const reminder = validateReminderInput(input);

  db.prepare(
    `
      INSERT INTO reminders (
        user_id, title, phone_number, message, remind_at, repeat_type,
        is_active, next_run_at, created_at, updated_at
      ) VALUES (
        @user_id, @title, @phone_number, @message, @remind_at, @repeat_type,
        1, @next_run_at, @created_at, @updated_at
      )
    `
  ).run({
    user_id: userId,
    title: reminder.title,
    phone_number: reminder.phoneNumber,
    message: reminder.message,
    remind_at: reminder.remindAt,
    repeat_type: reminder.repeatType,
    next_run_at: reminder.remindAt,
    created_at: now,
    updated_at: now,
  });
}

function getReminderById(id) {
  return db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
}

function ensureReminderAccess(reminder, user) {
  if (!reminder) throw new Error("提醒不存在");
  if (user.role !== "admin" && reminder.user_id !== user.id) {
    throw new Error("无权操作这条提醒");
  }
}

function toggleReminder(id, user) {
  const reminder = getReminderById(id);
  ensureReminderAccess(reminder, user);
  const now = new Date().toISOString();
  const nextActive = reminder.is_active ? 0 : 1;

  db.prepare(
    "UPDATE reminders SET is_active = ?, updated_at = ? WHERE id = ?"
  ).run(nextActive, now, id);
}

function deleteReminder(id, user) {
  const reminder = getReminderById(id);
  ensureReminderAccess(reminder, user);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM notification_logs WHERE reminder_id = ?").run(id);
    db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
  });
  transaction();
}

function computeNextRunAt(reminder) {
  const current = dayjs(reminder.next_run_at);
  if (reminder.repeat_type === "daily") {
    return current.add(1, "day").toISOString();
  }
  if (reminder.repeat_type === "weekly") {
    return current.add(1, "week").toISOString();
  }
  return reminder.next_run_at;
}

async function deliverReminder(reminder) {
  const result = await sendSms({
    phoneNumber: reminder.phone_number,
    message: reminder.message,
    reminderId: reminder.id,
  });

  const now = new Date().toISOString();
  const nextRunAt = computeNextRunAt(reminder);

  const transaction = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO notification_logs (
          reminder_id, channel, status, provider_response, sent_at
        ) VALUES (?, 'sms', ?, ?, ?)
      `
    ).run(
      reminder.id,
      result.status,
      result.providerResponse || "",
      now
    );

    db.prepare(
      `
        UPDATE reminders
        SET
          last_sent_at = ?,
          next_run_at = ?,
          is_active = ?,
          updated_at = ?
        WHERE id = ?
      `
    ).run(
      now,
      nextRunAt,
      reminder.repeat_type === "once" ? 0 : 1,
      now,
      reminder.id
    );
  });

  transaction();
}

async function triggerReminderNow(reminder) {
  await deliverReminder(reminder);
}

async function runDueReminders() {
  const now = new Date().toISOString();
  const dueReminders = db
    .prepare(
      `
        SELECT * FROM reminders
        WHERE is_active = 1 AND next_run_at <= ?
        ORDER BY next_run_at ASC
      `
    )
    .all(now);

  for (const reminder of dueReminders) {
    try {
      await deliverReminder(reminder);
    } catch (error) {
      db.prepare(
        `
          INSERT INTO notification_logs (
            reminder_id, channel, status, provider_response, sent_at
          ) VALUES (?, 'sms', 'failed', ?, ?)
        `
      ).run(reminder.id, error.message, new Date().toISOString());
      console.error(`[reminder:${reminder.id}] send failed:`, error.message);
    }
  }
}

function getDashboardData(user) {
  const isAdmin = user.role === "admin";
  const reminders = isAdmin
    ? db
        .prepare(
          `
            SELECT r.*, u.username
            FROM reminders r
            LEFT JOIN users u ON u.id = r.user_id
            ORDER BY r.is_active DESC, r.next_run_at ASC, r.id DESC
          `
        )
        .all()
    : db
        .prepare(
          `
            SELECT r.*, u.username
            FROM reminders r
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.user_id = ?
            ORDER BY r.is_active DESC, r.next_run_at ASC, r.id DESC
          `
        )
        .all(user.id);

  const recentLogs = isAdmin
    ? db
        .prepare(
          `
            SELECT nl.*, r.title, u.username
            FROM notification_logs nl
            JOIN reminders r ON r.id = nl.reminder_id
            LEFT JOIN users u ON u.id = r.user_id
            ORDER BY nl.sent_at DESC
            LIMIT 20
          `
        )
        .all()
    : db
        .prepare(
          `
            SELECT nl.*, r.title, u.username
            FROM notification_logs nl
            JOIN reminders r ON r.id = nl.reminder_id
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.user_id = ?
            ORDER BY nl.sent_at DESC
            LIMIT 20
          `
        )
        .all(user.id);

  const stats = isAdmin
    ? {
        total: db.prepare("SELECT COUNT(*) AS count FROM reminders").get().count,
        active: db
          .prepare("SELECT COUNT(*) AS count FROM reminders WHERE is_active = 1")
          .get().count,
        sent: db
          .prepare(
            "SELECT COUNT(*) AS count FROM notification_logs WHERE status IN ('sent', 'mock_sent')"
          )
          .get().count,
        failed: db
          .prepare(
            "SELECT COUNT(*) AS count FROM notification_logs WHERE status = 'failed'"
          )
          .get().count,
      }
    : {
        total: db
          .prepare("SELECT COUNT(*) AS count FROM reminders WHERE user_id = ?")
          .get(user.id).count,
        active: db
          .prepare(
            "SELECT COUNT(*) AS count FROM reminders WHERE user_id = ? AND is_active = 1"
          )
          .get(user.id).count,
        sent: db
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM notification_logs nl
              JOIN reminders r ON r.id = nl.reminder_id
              WHERE r.user_id = ? AND nl.status IN ('sent', 'mock_sent')
            `
          )
          .get(user.id).count,
        failed: db
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM notification_logs nl
              JOIN reminders r ON r.id = nl.reminder_id
              WHERE r.user_id = ? AND nl.status = 'failed'
            `
          )
          .get(user.id).count,
      };

  return { reminders, recentLogs, stats };
}

module.exports = {
  createReminder,
  deleteReminder,
  ensureReminderAccess,
  getDashboardData,
  getReminderById,
  runDueReminders,
  toggleReminder,
  triggerReminderNow,
};
