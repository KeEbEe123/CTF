const buckets = new Map();

function nowMs() {
  return Date.now();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0].trim();
    if (first) {
      return first;
    }
  }

  return req.ip || req.connection?.remoteAddress || "unknown";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function defaultKeyGenerator(req, scope) {
  const userId = req.authUser?.id || req.session?.authUser?.id || "anon";
  return `${scope}:${getClientIp(req)}:${userId}`;
}

function createRateLimiter({ windowMs, maxRequests, scope, message, keyGenerator, code }) {
  const safeWindowMs = Number.isInteger(windowMs) && windowMs > 0 ? windowMs : 60_000;
  const safeMaxRequests = Number.isInteger(maxRequests) && maxRequests > 0 ? maxRequests : 60;
  const safeScope = String(scope || "default");
  const safeCode = String(code || "RATE_LIMIT_EXCEEDED");
  const hasMessageFactory = typeof message === "function";
  const safeMessage = hasMessageFactory ? null : String(message || "Too many requests. Please try again later.");
  const resolveKey = typeof keyGenerator === "function" ? keyGenerator : defaultKeyGenerator;

  return (req, res, next) => {
    const rawKey = resolveKey(req, safeScope);
    const key = rawKey === undefined || rawKey === null || String(rawKey).trim() === ""
      ? defaultKeyGenerator(req, safeScope)
      : String(rawKey);
    const now = nowMs();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAtMs) {
      bucket = {
        count: 0,
        resetAtMs: now + safeWindowMs
      };
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.setHeader("X-RateLimit-Limit", String(safeMaxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, safeMaxRequests - bucket.count)));

    if (bucket.count > safeMaxRequests) {
      const payloadMessage = hasMessageFactory
        ? String(
            message({
              req,
              retryAfterSeconds,
              maxRequests: safeMaxRequests,
              windowMs: safeWindowMs,
              scope: safeScope
            }) || "Too many requests. Please try again later."
          )
        : safeMessage;

      return res.status(429).json({
        success: false,
        code: safeCode,
        message: payloadMessage,
        retryAfterSeconds
      });
    }

    return next();
  };
}

const authIpLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 120,
  scope: "auth-ip",
  code: "AUTH_RATE_LIMIT_IP",
  keyGenerator: (req, scope) => `${scope}:${getClientIp(req)}`,
  message: ({ retryAfterSeconds }) =>
    `Too many authentication attempts from this network. Try again in ${retryAfterSeconds}s.`
});

const authAccountLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 20,
  scope: "auth-account",
  code: "AUTH_RATE_LIMIT_ACCOUNT",
  keyGenerator: (req, scope) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return `${scope}:anonymous:${getClientIp(req)}`;
    }
    return `${scope}:${email}`;
  },
  message: ({ retryAfterSeconds }) =>
    `Too many attempts for this account. Try again in ${retryAfterSeconds}s.`
});

const hintLimiter = createRateLimiter({
  windowMs: 2 * 60 * 1000,
  maxRequests: 60,
  scope: "hint",
  message: "Too many hint requests. Please slow down."
});

const submitLimiter = createRateLimiter({
  windowMs: 2 * 60 * 1000,
  maxRequests: 80,
  scope: "submit",
  message: "Too many flag submissions. Please slow down."
});

const commandLimiter = createRateLimiter({
  windowMs: 2 * 60 * 1000,
  maxRequests: 240,
  scope: "command",
  message: "Too many terminal commands. Please slow down."
});

setInterval(() => {
  const now = nowMs();
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || now >= bucket.resetAtMs) {
      buckets.delete(key);
    }
  }
}, 60_000).unref();

module.exports = {
  createRateLimiter,
  authIpLimiter,
  authAccountLimiter,
  hintLimiter,
  submitLimiter,
  commandLimiter
};
