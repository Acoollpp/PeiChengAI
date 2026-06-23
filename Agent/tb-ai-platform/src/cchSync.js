const { Pool } = require("pg");

function syncRows(store, rows, now = new Date()) {
  const syncedAt = now.toISOString();
  const result = {
    usersCreated: 0,
    usersUpdated: 0,
    keysCreated: 0,
    keysUpdated: 0,
    skippedKeys: 0,
    errors: [],
    startedAt: syncedAt,
    finishedAt: null
  };

  const localUsersByCchId = new Map();

  for (const row of rows.users || []) {
    const parsed = parseUserRow(row, now);
    const existing = store.db
      .prepare("SELECT id FROM users WHERE cch_user_id = ?")
      .get(parsed.cchUserId);
    const user = store.upsertUser({ ...parsed, syncedAt });
    if (existing) result.usersUpdated += 1;
    else result.usersCreated += 1;
    localUsersByCchId.set(parsed.cchUserId, user);
  }

  for (const row of rows.keys || []) {
    const parsed = parseKeyRow(row, now);
    let user = localUsersByCchId.get(parsed.cchUserId);
    if (!user) {
      user = store.db
        .prepare("SELECT * FROM users WHERE cch_user_id = ?")
        .get(parsed.cchUserId);
      if (user) {
        user = {
          id: user.id,
          isActive: Boolean(user.is_active)
        };
      }
    }

    if (!user) {
      result.skippedKeys += 1;
      result.errors.push(`key ${parsed.cchKeyId} references missing CCH user ${parsed.cchUserId}`);
      continue;
    }

    const disabledReason = parsed.disabledReason || (user.isActive ? null : "user_disabled");
    const existing = store.db
      .prepare("SELECT id FROM api_keys WHERE cch_key_id = ?")
      .get(parsed.cchKeyId);

    store.upsertApiKey({
      cchKeyId: parsed.cchKeyId,
      userId: user.id,
      key: parsed.key,
      name: parsed.name,
      isActive: disabledReason === null,
      disabledReason,
      syncedAt
    });

    if (existing) result.keysUpdated += 1;
    else result.keysCreated += 1;
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

async function syncFromCchDatabase(store, databaseUrl, now = new Date()) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const [users, keys] = await Promise.all([
      pool.query("SELECT * FROM users"),
      pool.query("SELECT * FROM keys")
    ]);
    return syncRows(store, { users: users.rows, keys: keys.rows }, now);
  } finally {
    await pool.end();
  }
}

function parseUserRow(row, now) {
  const disabledReason = disabledReasonFor({
    enabled: value(row, "is_enabled", "active", "is_active") !== false,
    deletedAt: value(row, "deleted_at", "deletedAt"),
    expiresAt: value(row, "expires_at", "expiresAt"),
    disabled: "cch_user_disabled",
    deleted: "cch_user_deleted",
    expired: "cch_user_expired",
    now
  });

  return {
    cchUserId: Number(value(row, "id", "user_id", "cch_user_id")),
    fullName: value(row, "name", "full_name", "username") || null,
    role: normalizeRole(value(row, "role") || "user"),
    isActive: disabledReason === null,
    disabledReason
  };
}

function parseKeyRow(row, now) {
  const disabledReason = disabledReasonFor({
    enabled: value(row, "is_enabled", "active", "is_active") !== false,
    deletedAt: value(row, "deleted_at", "deletedAt"),
    expiresAt: value(row, "expires_at", "expiresAt"),
    disabled: "key_disabled",
    deleted: "key_deleted",
    expired: "key_expired",
    now
  });

  return {
    cchKeyId: Number(value(row, "id", "key_id", "cch_key_id")),
    cchUserId: Number(value(row, "user_id", "cch_user_id")),
    key: String(value(row, "key", "api_key", "token")),
    name: value(row, "name", "key_name") || null,
    disabledReason
  };
}

function disabledReasonFor({ enabled, deletedAt, expiresAt, disabled, deleted, expired, now }) {
  if (deletedAt) return deleted;
  if (!enabled) return disabled;
  if (isExpired(expiresAt, now)) return expired;
  return null;
}

function isExpired(value, now) {
  if (!value) return false;
  const expiresAt = value instanceof Date ? value : new Date(value);
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
}

function normalizeRole(role) {
  return role === "admin" ? "admin" : "user";
}

function value(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  return undefined;
}

module.exports = {
  parseKeyRow,
  parseUserRow,
  syncFromCchDatabase,
  syncRows
};
