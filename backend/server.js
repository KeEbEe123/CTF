const express = require("express");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const challenge1Routes = require("./routes/challenge1");
const challenge2Routes = require("./routes/challenge2");
const challenge3Routes = require("./routes/challenge3");
const challenge4Routes = require("./routes/challenge4");
const trackRoutes = require("./routes/tracks");
const advancedChallengesRoutes = require("./routes/advancedChallenges");
const adminRoutes = require("./routes/admin");
const authRoutes = require("./routes/auth");
const scoreboardRoutes = require("./routes/scoreboard");
const { serveInternalAdminBackup } = require("./controllers/challenge2Controller");
const { requirePageRoles } = require("./middleware/auth");
const { initializeUserStore } = require("./lib/userStore");
const { initializeProgressStore } = require("./lib/progressStore");
const { initializeTrackStore } = require("./lib/trackStore");
const { initializeChallengeInstanceStore } = require("./lib/challengeInstanceStore");
const { isDynamicFlagsEnabled } = require("./lib/dynamicFlagService");
const { initializePhantomStateStore } = require("./advanced/phantomExecution/state");

function loadLocalEnvFile() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const currentValue = process.env[key];
    if (!key || (currentValue !== undefined && currentValue !== null && String(currentValue).length > 0)) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadLocalEnvFile();

const app = express();
const PORT = process.env.PORT || 3000;
const frontendRoot = path.resolve(__dirname, "../frontend");
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const cookieSecure = String(process.env.COOKIE_SECURE || "").toLowerCase() === "true";

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is not set. Using an ephemeral secret for this process.");
}
if (isProduction && !cookieSecure) {
  console.warn("COOKIE_SECURE is not enabled. Use HTTPS and set COOKIE_SECURE=true in production.");
  console.warn("⚠️  WARNING: Login and registration will NOT work properly without COOKIE_SECURE=true on HTTPS!");
}

console.log(`[config] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[config] COOKIE_SECURE: ${cookieSecure}`);
console.log(`[config] Trust proxy: enabled (required for Render/Railway/Heroku)`);

initializeUserStore();
initializeProgressStore();
initializeTrackStore();
initializeChallengeInstanceStore();

// Trust proxy - required for Render, Railway, Heroku, etc.
// This allows Express to correctly detect HTTPS connections behind a reverse proxy
app.set("trust proxy", 1);

app.disable("x-powered-by");
const corsOrigin = process.env.CORS_ORIGIN || true;
console.log(`[config] CORS origin: ${corsOrigin === true ? 'all origins (reflect)' : corsOrigin}`);

app.use(
  cors({
    origin: corsOrigin,
    credentials: true
  })
);
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );

  if (cookieSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});
app.use(
  session({
    name: "ctf.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      maxAge: 4 * 60 * 60 * 1000
    }
  })
);

app.use("/api/challenge1", challenge1Routes);
app.use("/api/challenge2", challenge2Routes);
app.use("/api/challenge3", challenge3Routes);
app.use("/api/challenge4", challenge4Routes);
app.use("/api/tracks", trackRoutes);
app.use("/api/advanced", advancedChallengesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/scoreboard", scoreboardRoutes);
app.get("/target/challenge2/internal/admin-backup", serveInternalAdminBackup);
app.get("/target/challenge2/internal/admin-backup.html", serveInternalAdminBackup);
app.use(
  "/target/challenge2",
  express.static(path.resolve(__dirname, "./targets/challenge2-app"), {
    extensions: ["html"]
  })
);
app.get("/pages/admin.html", requirePageRoles(["instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/admin.html"));
});
app.get("/pages/scoreboard.html", requirePageRoles(["student", "instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/scoreboard.html"));
});
app.get("/pages/challenge_adv1.html", requirePageRoles(["student", "instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/challenge_adv1.html"));
});
app.get("/pages/challenge_adv2.html", requirePageRoles(["student", "instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/challenge_adv2.html"));
});
app.get("/pages/challenge_adv3.html", requirePageRoles(["student", "instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/challenge_adv3.html"));
});
app.get("/pages/challenge_adv4.html", requirePageRoles(["student", "instructor", "admin"]), (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "pages/challenge_adv4.html"));
});
app.use("/", express.static(frontendRoot));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/debug/session", (req, res) => {
  res.json({
    hasSession: !!req.session,
    sessionID: req.session?.id || null,
    authUser: req.session?.authUser || null,
    secure: req.secure,
    protocol: req.protocol,
    headers: {
      'x-forwarded-proto': req.get('x-forwarded-proto'),
      'x-forwarded-host': req.get('x-forwarded-host')
    },
    cookieSecure: cookieSecure
  });
});

app.use("/api", (req, res) => {
  return res.status(404).json({
    success: false,
    code: "API_NOT_FOUND",
    message: "API endpoint not found."
  });
});

app.use((err, req, res, next) => {
  const originalUrl = String(req.originalUrl || "");
  const isApiRequest = originalUrl.startsWith("/api/");

  if (!isApiRequest) {
    return next(err);
  }

  if (res.headersSent) {
    return next(err);
  }

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      code: "INVALID_JSON",
      message: "Invalid JSON payload."
    });
  }

  const derivedStatus = Number(err && (err.status || err.statusCode));
  const statusCode = Number.isFinite(derivedStatus) && derivedStatus >= 400 ? derivedStatus : 500;
  const message =
    statusCode >= 500
      ? "Internal server error."
      : (err && err.message) || "Request failed.";

  return res.status(statusCode).json({
    success: false,
    code: (err && err.code) || "API_ERROR",
    message
  });
});

app.listen(PORT, () => {
  const { initializeUserStore } = require("./lib/userStore");
  const { initializeProgressStore } = require("./lib/progressStore");
  const { initializeTrackStore } = require("./lib/trackStore");
  const { initializeChallengeInstanceStore } = require("./lib/challengeInstanceStore");
  const { initializeProtocolStore } = require("./advanced/protocolCollapse/sessionState");
  const { isDynamicFlagsEnabled } = require("./lib/dynamicFlagService");

  initializeUserStore();
  initializeProgressStore();
  initializeTrackStore();
  initializeChallengeInstanceStore();
  initializePhantomStateStore();
  initializeProtocolStore();

  console.log(`CTF server running on port ${PORT}`);
  console.log(
    `[dynamic-flags] ${isDynamicFlagsEnabled() ? "enabled" : "disabled"} (set ENABLE_DYNAMIC_FLAGS=true to enable)`
  );
});
