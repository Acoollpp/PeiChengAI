const crypto = require("crypto");

const COOKIE_NAME = "tb_session";

function createAuthService({ store, sessionSecret, sessionTtlHours }) {
  function loginWithKey(key, now = new Date()) {
    const trimmed = String(key || "").trim();
    if (!trimmed) return { ok: false, status: 400, error: "请输入登录 key" };

    const user = store.findUserByKey(trimmed);
    if (!user) return { ok: false, status: 401, error: "登录 key 无效或已停用" };

    const expiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1000);
    const session = store.createSession({
      userId: user.id,
      expiresAt: expiresAt.toISOString()
    });
    const value = signSessionId(session.id, sessionSecret);
    return {
      ok: true,
      user: publicUser(user),
      cookie: buildCookie(value, sessionTtlHours)
    };
  }

  function getCurrentUser(req, now = new Date()) {
    const sessionId = sessionIdFromRequest(req);
    if (!sessionId) return null;
    const user = store.getSessionUser(sessionId, now.toISOString());
    return user ? publicUser(user) : null;
  }

  function sessionIdFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    const signed = cookies[COOKIE_NAME];
    if (!signed) return "";
    return verifySessionValue(signed, sessionSecret);
  }

  function logout(sessionId) {
    store.deleteSession(sessionId);
  }

  return {
    clearCookie,
    getCurrentUser,
    loginWithKey,
    logout,
    sessionIdFromRequest
  };
}

function publicUser(user) {
  return {
    id: user.id,
    cchUserId: user.cchUserId,
    fullName: user.fullName,
    role: user.role
  };
}

function signSessionId(sessionId, secret) {
  const signature = crypto.createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${signature}`;
}

function verifySessionValue(value, secret) {
  const [sessionId, signature] = String(value || "").split(".");
  if (!sessionId || !signature) return "";
  const expected = signSessionId(sessionId, secret).split(".")[1];
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return "";
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer) ? sessionId : "";
}

function buildCookie(value, ttlHours) {
  const maxAge = Math.floor(ttlHours * 60 * 60);
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

module.exports = {
  COOKIE_NAME,
  createAuthService,
  parseCookies,
  signSessionId,
  verifySessionValue
};
