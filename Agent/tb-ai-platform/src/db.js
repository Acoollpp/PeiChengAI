const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

function createStore({ databasePath }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.chmodSync(path.dirname(databasePath), 0o700);
  const db = new Database(databasePath);
  fs.chmodSync(databasePath, 0o600);
  db.pragma("journal_mode = WAL");
  migrate(db);

  function upsertUser(row) {
    const now = row.syncedAt;
    db.prepare(
      `
        INSERT INTO users (
          cch_user_id, full_name, role, is_active, disabled_reason,
          last_synced_at, created_at, updated_at
        )
        VALUES (@cchUserId, @fullName, @role, @isActive, @disabledReason, @syncedAt, @syncedAt, @syncedAt)
        ON CONFLICT(cch_user_id) DO UPDATE SET
          full_name = excluded.full_name,
          role = excluded.role,
          is_active = excluded.is_active,
          disabled_reason = excluded.disabled_reason,
          last_synced_at = excluded.last_synced_at,
          updated_at = excluded.updated_at
      `
    ).run({
      cchUserId: row.cchUserId,
      fullName: row.fullName,
      role: row.role,
      isActive: row.isActive ? 1 : 0,
      disabledReason: row.disabledReason,
      syncedAt: now
    });

    return mapUser(db.prepare("SELECT * FROM users WHERE cch_user_id = ?").get(row.cchUserId));
  }

  function upsertApiKey(row) {
    db.prepare(
      `
        INSERT INTO api_keys (
          cch_key_id, user_id, key, name, is_active, disabled_reason,
          last_synced_at, created_at, updated_at
        )
        VALUES (@cchKeyId, @userId, @key, @name, @isActive, @disabledReason, @syncedAt, @syncedAt, @syncedAt)
        ON CONFLICT(cch_key_id) DO UPDATE SET
          user_id = excluded.user_id,
          key = excluded.key,
          name = excluded.name,
          is_active = excluded.is_active,
          disabled_reason = excluded.disabled_reason,
          last_synced_at = excluded.last_synced_at,
          updated_at = excluded.updated_at
      `
    ).run({
      cchKeyId: row.cchKeyId,
      userId: row.userId,
      key: row.key,
      name: row.name,
      isActive: row.isActive ? 1 : 0,
      disabledReason: row.disabledReason,
      syncedAt: row.syncedAt
    });

    return db.prepare("SELECT * FROM api_keys WHERE cch_key_id = ?").get(row.cchKeyId);
  }

  function findUserByKey(key) {
    return mapUser(db
      .prepare(
        `
          SELECT users.*
          FROM api_keys
          JOIN users ON users.id = api_keys.user_id
          WHERE api_keys.key = ?
            AND api_keys.is_active = 1
            AND users.is_active = 1
        `
      )
      .get(key));
  }

  function createSession({ userId, expiresAt }) {
    const id = crypto.randomBytes(32).toString("hex");
    const createdAt = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO sessions (id, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `
    ).run(id, userId, createdAt, expiresAt);
    return { id, userId, createdAt, expiresAt };
  }

  function getSessionUser(sessionId, now = new Date().toISOString()) {
    if (!sessionId) return null;
    return mapUser(db
      .prepare(
        `
          SELECT users.*
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.id = ?
            AND sessions.expires_at > ?
            AND users.is_active = 1
        `
      )
      .get(sessionId, now));
  }

  function deleteSession(sessionId) {
    if (!sessionId) return;
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  function recordAuditLog({ userId, action, mode, runId, metadata }) {
    db.prepare(
      `
        INSERT INTO audit_logs (user_id, action, mode, run_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      userId,
      action,
      mode,
      runId,
      JSON.stringify(metadata || {}),
      new Date().toISOString()
    );
  }

  function createRunHistory({ userId, runId, mode, title, message, itemCount, projectUrl, aiTest }) {
    const now = new Date().toISOString();
    db.prepare(
      `
        INSERT INTO run_history (
          run_id, user_id, mode, title, message_preview, message_text,
          project_url, ai_test, item_count,
          status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `
    ).run(
      runId,
      userId,
      mode,
      title,
      previewText(message),
      message,
      projectUrl || null,
      aiTest ? 1 : 0,
      itemCount || 1,
      now,
      now
    );
  }

  function finishRunHistory({
    runId,
    status,
    code,
    completedSteps,
    failedSteps,
    missingSteps,
    resultUrls,
    errorMessages,
    itemResults
  }) {
    db.prepare(
      `
        UPDATE run_history
        SET status = ?,
            exit_code = ?,
            completed_steps_json = ?,
            failed_steps_json = ?,
            missing_steps_json = ?,
            result_urls_json = ?,
            error_messages_json = ?,
            item_results_json = ?,
            finished_at = ?,
            updated_at = ?
        WHERE run_id = ?
      `
    ).run(
      status,
      code,
      JSON.stringify(completedSteps || []),
      JSON.stringify(failedSteps || []),
      JSON.stringify(missingSteps || []),
      JSON.stringify(resultUrls || []),
      JSON.stringify(errorMessages || []),
      JSON.stringify(itemResults || []),
      new Date().toISOString(),
      new Date().toISOString(),
      runId
    );
  }

  function listRunHistory({ userId, mode, limit = 30 }) {
    const where = mode ? "WHERE run_history.user_id = ? AND run_history.mode = ?" : "WHERE run_history.user_id = ?";
    const params = mode ? [userId, mode, limit] : [userId, limit];
    return db
      .prepare(
        `
          SELECT run_history.*, users.full_name
          FROM run_history
          JOIN users ON users.id = run_history.user_id
          ${where}
          ORDER BY run_history.created_at DESC
          LIMIT ?
        `
      )
      .all(...params)
      .map(mapRunHistory);
  }

  return {
    db,
    upsertUser,
    upsertApiKey,
    findUserByKey,
    createSession,
    getSessionUser,
    deleteSession,
    recordAuditLog,
    createRunHistory,
    finishRunHistory,
    listRunHistory,
    close: () => db.close()
  };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    cchUserId: row.cch_user_id,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    disabledReason: row.disabled_reason,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRunHistory(row) {
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    userName: row.full_name,
    mode: row.mode,
    title: row.title,
    messagePreview: row.message_preview,
    messageText: row.message_text,
    projectUrl: row.project_url,
    aiTest: Boolean(row.ai_test),
    itemCount: row.item_count,
    status: row.status,
    exitCode: row.exit_code,
    completedSteps: parseJsonArray(row.completed_steps_json),
    failedSteps: parseJsonArray(row.failed_steps_json),
    missingSteps: parseJsonArray(row.missing_steps_json),
    resultUrls: parseJsonArray(row.result_urls_json),
    errorMessages: parseJsonArray(row.error_messages_json),
    itemResults: parseJsonArray(row.item_results_json),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    durationMs: durationMs(row.created_at, row.finished_at)
  };
}

function previewText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function durationMs(start, end) {
  if (!start || !end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cch_user_id INTEGER NOT NULL UNIQUE,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      disabled_reason TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cch_key_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL UNIQUE,
      name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      disabled_reason TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      mode TEXT,
      run_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      title TEXT NOT NULL,
      message_preview TEXT,
      message_text TEXT,
      project_url TEXT,
      ai_test INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      exit_code INTEGER,
      completed_steps_json TEXT,
      failed_steps_json TEXT,
      missing_steps_json TEXT,
      result_urls_json TEXT,
      error_messages_json TEXT,
      item_results_json TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ix_api_keys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS ix_run_history_user_id ON run_history(user_id);
    CREATE INDEX IF NOT EXISTS ix_run_history_created_at ON run_history(created_at);
  `);

  ensureColumn(db, "run_history", "message_text", "TEXT");
  ensureColumn(db, "run_history", "project_url", "TEXT");
  ensureColumn(db, "run_history", "ai_test", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "run_history", "result_urls_json", "TEXT");
  ensureColumn(db, "run_history", "error_messages_json", "TEXT");
  ensureColumn(db, "run_history", "item_results_json", "TEXT");
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

module.exports = {
  createStore
};
