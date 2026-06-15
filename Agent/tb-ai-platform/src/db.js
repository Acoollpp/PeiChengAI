const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

function createStore({ databasePath }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
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

  return {
    db,
    upsertUser,
    upsertApiKey,
    findUserByKey,
    createSession,
    getSessionUser,
    deleteSession,
    recordAuditLog,
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

    CREATE INDEX IF NOT EXISTS ix_api_keys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS ix_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs(user_id);
  `);
}

module.exports = {
  createStore
};
