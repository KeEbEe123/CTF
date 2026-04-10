/**
 * backend/advanced/phantomExecution/controller.js
 *
 * HTTP handlers for Phantom Execution (adv-1).
 *
 * All handlers assume requireAuth + requireAdvancedTrackActive have already
 * run at the parent router (advancedChallenges.js).
 * req.authUser and req.advancedTrackState are available.
 *
 * ── Endpoint inventory ──────────────────────────────────────────────────────
 *
 *   GET  /api/advanced/phantom/details              Safe overview + runtime status
 *   POST /api/advanced/phantom/submit               Flag submission
 *
 *   POST /api/advanced/phantom/auth/login           Challenge-local session init
 *   POST /api/advanced/phantom/auth/logout          Clear challenge session
 *
 *   GET  /api/advanced/phantom/user/profile         Read persistent profile
 *   POST /api/advanced/phantom/user/update          Update profile [VULNERABLE]
 *
 *   POST /api/advanced/phantom/admin/check          Admin gate (trusts session)
 *   POST /api/advanced/phantom/admin/export         Admin export → auditToken
 *
 *   GET  /api/advanced/phantom/audit/logs           Audit log context
 *   GET  /api/advanced/phantom/system/info          App/version info [DECOY]
 *   GET  /api/advanced/phantom/debug/env            Debug env probe [DECOY]
 */

"use strict";

const { getSessionUser } = require("../../middleware/auth");
const { reconcileAndPersistExpiry } = require("../../lib/trackLogic");
const { isDynamicFlagsEnabled, buildFlag, verifySubmittedFlag } = require("../../lib/dynamicFlagService");
const {
    getOrCreateChallengeInstance,
    getActiveChallengeInstance,
    markChallengeInstanceSolved,
    listChallengeInstances
} = require("../../lib/challengeInstanceStore");
const fs = require("fs");
const path = require("path");
const { getRecord, getOrInitRecord, setRecord } = require("./state");
const {
    loadChallengeMeta,
    buildPublicDetails,
    checkFlag,
    getSessionRole,
    clearSessionRole,
    isSessionAdmin,
    applyProfileUpdate,
    generateAuditToken,
    buildRuntimeStatus,
    sanitiseQueryParam
} = require("./logic");
const {
    APP_NAME,
    APP_VERSION,
    APP_BUILD,
    buildPortalProfile,
    STATIC_AUDIT_ENTRIES,
    DECOY_HEADERS,
    ADMIN_GATE_DENIED,
    ADMIN_GATE_GRANTED
} = require("./data");
const progressStore = require("../../lib/progressStore");
const { assignScore } = require("../../lib/dynamicScoring");

const dynamicChallengeId = "adv-1";
const dynamicChallengeSlug = "phantom_execution";

// ─── Helper ──────────────────────────────────────────────────────────────────

function currentUser(req) {
    return req.authUser || getSessionUser(req);
}

function resolveDynamicContext(req, user, state, options = {}) {
    if (!isDynamicFlagsEnabled()) {
        return { enabled: false, instance: null, expectedFlag: null, errorCode: null };
    }

    if (!req || !req.sessionID) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "SESSION_ID_MISSING" };
    }
    if (!user || !user.id) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "USER_MISSING" };
    }

    const scope = {
        userId: user.id,
        challengeId: dynamicChallengeId,
        challengeSlug: dynamicChallengeSlug,
        sessionId: req.sessionID
    };

    const createIfMissing = options.createIfMissing !== false;
    let instance = getActiveChallengeInstance(scope);

    if (!instance && state && state.solved) {
        const existingRecords = listChallengeInstances(scope);
        instance = existingRecords.find((record) => record.status === "solved") || existingRecords[0] || null;
    }

    if (!instance && createIfMissing && (!state || !state.solved)) {
        instance = getOrCreateChallengeInstance(scope).instance;
    }

    if (!instance) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "NO_ACTIVE_INSTANCE" };
    }

    const expectedFlag = buildFlag({
        challengeId: dynamicChallengeId,
        challengeSlug: dynamicChallengeSlug,
        sessionId: req.sessionID,
        instanceId: instance.instanceId
    });

    return { enabled: true, instance, expectedFlag, errorCode: null };
}

function addDecoyHeaders(res) {
    res.setHeader("X-Internal-Request-Id", require("crypto").randomBytes(8).toString("hex"));
    res.setHeader("X-Session-Scope", "standard");
}

function resolveDisplayPoints(userId, challengeId, configuredPoints) {
    const stored = progressStore.getProgress(userId, challengeId);
    if (stored && stored.solved) {
        const parsedStored = Number(stored.pointsAwarded);
        if (Number.isFinite(parsedStored) && parsedStored >= 0) {
            return parsedStored;
        }
    }

    try {
        const { scoreAwarded } = assignScore(userId, challengeId);
        const parsedAward = Number(scoreAwarded);
        if (Number.isFinite(parsedAward) && parsedAward >= 0) {
            return parsedAward;
        }
    } catch {
        // Fall back to configured points.
    }

    const parsedConfigured = Number(configuredPoints);
    return Number.isFinite(parsedConfigured) && parsedConfigured >= 0 ? parsedConfigured : 0;
}

// ─── GET /details ────────────────────────────────────────────────────────────

function getDetails(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const meta = loadChallengeMeta();
        const details = buildPublicDetails(meta);
        const record = getRecord(user.id);
        const dynamicContext = resolveDynamicContext(req, user, record, { createIfMissing: true });
        if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
            return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
        }
        const runtime = buildRuntimeStatus(record);

        const displayPoints = resolveDisplayPoints(user.id, "adv-1", details.points);

        return res.json({
            success: true,
            challenge: {
                ...details,
                maxPoints: details.points,
                points: displayPoints
            },
            runtime
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Failed to load challenge details." });
    }
}

// ─── POST /submit ────────────────────────────────────────────────────────────

function submitFlag(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const { flag } = req.body || {};
        if (!flag || typeof flag !== "string") {
            return res.status(400).json({ success: false, message: "flag field is required." });
        }

        const record = getOrInitRecord(user.id);
        let activeDynamicInstance = null;

        if (record.solved) {
            return res.json({
                success: true, correct: true, alreadySolved: true,
                message: "Challenge already solved.", points: 0, pointsAwarded: 0
            });
        }

        if (isDynamicFlagsEnabled()) {
            const dynamicContext = resolveDynamicContext(req, user, record, { createIfMissing: false });
            if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
                return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
            }
            if (dynamicContext.errorCode === "USER_MISSING") {
                return res.status(401).json({ success: false, message: "Authentication required." });
            }
            if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
                return res.status(409).json({
                    success: false,
                    message: "No active Phantom Execution instance for this session. Reopen the challenge and try again."
                });
            }
            activeDynamicInstance = dynamicContext.instance;
        }

        setRecord(user.id, { attempts: Number(record.attempts || 0) + 1 });
        const { correct } = isDynamicFlagsEnabled()
            ? {
                correct: verifySubmittedFlag({
                    submittedFlag: flag,
                    challengeId: dynamicChallengeId,
                    challengeSlug: dynamicChallengeSlug,
                    sessionId: req.sessionID,
                    instanceId: activeDynamicInstance.instanceId
                })
            }
            : checkFlag(flag);
        let awardedPoints = 0;

        if (!correct) {
            return res.json({
                success: true, correct: false,
                points: 0,
                pointsAwarded: 0,
                message: "Incorrect. Continue investigating the application."
            });
        }

        setRecord(user.id, { solved: true, solvedAtMs: Date.now() });
        if (activeDynamicInstance && activeDynamicInstance.instanceId) {
            try {
                markChallengeInstanceSolved(activeDynamicInstance.instanceId, {
                    solvedByUserId: user.id,
                    solvedForChallengeId: dynamicChallengeId
                });
            } catch (error) {
                console.error("[WARN] Failed to mark adv-1 challenge instance solved:", error.message);
            }
        }
        const solvedProgress = progressStore.markChallengeSolved(user.id, "adv-1");
        const parsedPoints = Number(solvedProgress && solvedProgress.pointsAwarded);
        awardedPoints = Number.isFinite(parsedPoints) && parsedPoints >= 0 ? parsedPoints : 0;

        try {
            reconcileAndPersistExpiry(user.id);
        } catch (reconcileError) {
            console.error("[WARN] Failed to reconcile advanced track completion (adv-1):", reconcileError.message);
        }

        try {
            // Forensic Audit Logging
            const logPath = path.resolve(__dirname, "../../../database/challenge_adv-1_completions.log");
            const entry = {
                eventType: "challenge_completed",
                challengeId: "adv-1",
                userId: user.id,
                userName: user.name || "Student",
                userEmail: user.email || "student@zerotrace",
                sessionId: req.sessionID || "unknown",
                timestamp: new Date().toISOString(),
                scoreAwarded: awardedPoints,
                hintsUsed: record.hintsUsed || 0,
                completionDurationSeconds: Math.floor((Date.now() - (record.startedAtMs || Date.now())) / 1000),
                attempts: { total: record.attempts || 1, correct: 1, incorrect: (record.attempts || 1) - 1 }
            };
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
        } catch (err) {
            console.error("[ERROR] Critical failure in phantomExecution completion logic:", err.message);
        }
        
        return res.json({
            success: true, correct: true,
            message: "Phantom Execution solved.",
            points: awardedPoints,
            pointsAwarded: awardedPoints
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Submission failed." });
    }
}

// ─── POST /auth/login ────────────────────────────────────────────────────────
// Challenge-local session init. Accepts any credentials — the challenge
// doesn't validate them; it only establishes the portal session context.
// The real platform auth guard (requireAuth) already ran upstream.

function authLogin(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        // Reset transient role on fresh login
        clearSessionRole(req);

        const record = getOrInitRecord(user.id);
        const token = require("crypto").randomBytes(16).toString("hex");

        setRecord(user.id, { sessionToken: token });

        addDecoyHeaders(res);
        return res.json({
            success: true,
            message: "Session established.",
            sessionRef: token,                         // looks like a session token (decoy)
            portalUser: `U-${String(user.id).padStart(4, "0")}`,
            expiresIn: 3600,
            _debug: null                           // DECOY: stale debug field, always null
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Login failed." });
    }
}

// ─── POST /auth/logout ───────────────────────────────────────────────────────

function authLogout(req, res) {
    const user = currentUser(req);
    if (user) {
        clearSessionRole(req);
        setRecord(user.id, { sessionToken: null });
    }
    return res.json({ success: true, message: "Session terminated." });
}

// ─── GET /user/profile ───────────────────────────────────────────────────────
// Returns the PERSISTENT profile — role is always "user" here.

function getUserProfile(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const profile = buildPortalProfile(user);

        // Inject the current session role as a separate field so the discrepancy
        // is discoverable (but not announced):
        const sessionRole = getSessionRole(req);

        addDecoyHeaders(res);
        return res.json({
            success: true,
            profile: {
                ...profile,
                // The session role field — when exploited, differs from profile.role
                _sessionContext: {
                    activeRole: sessionRole || profile.role,
                    sessionSource: sessionRole ? "session" : "profile"
                }
            }
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Unable to retrieve profile." });
    }
}

// ─── POST /user/update ──────────────────────────────────────────────────────
//
// THE VULNERABLE ENDPOINT.
//
// Persistent store: role is stripped/ignored. Storage safe.
// Transient session: syncs ALL submitted fields including "role". NOT safe.
//
// A student who submits { "name": "Alice", "role": "admin" } will see:
//   - Persistent profile still has role="user"
//   - req.session.phantomRole becomes "admin"
//   - Admin endpoints will now pass
//
// The response deliberately says "preferences updated" without mentioning
// roles, so the bug isn't announced.

function updateUserProfile(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const submitted = req.body || {};

        // Reject empty updates
        if (!Object.keys(submitted).length) {
            return res.status(400).json({ success: false, message: "No update fields provided." });
        }

        // Validate types (superficially — a real app would do schema validation)
        // This looks like it protects the role field
        if (submitted.role !== undefined && typeof submitted.role !== "string") {
            return res.status(400).json({
                success: false,
                message: "Field 'role' must be a string if provided."
            });
        }

        // Build persistent profile base
        const baseProfile = buildPortalProfile(user);

        // Apply the update: persisted writes are safe, session sync is not
        const { persistedProfile, allowedPersistFields } = applyProfileUpdate(req, baseProfile, submitted);

        // Mark profile updated
        setRecord(user.id, { profileUpdatedAt: new Date().toISOString() });

        // Response does NOT mention the role sync — it says only allowed fields were updated.
        addDecoyHeaders(res);
        return res.json({
            success: true,
            message: "Profile updated.",
            updatedFields: allowedPersistFields.filter((f) => submitted[f] !== undefined),
            profile: {
                userId: persistedProfile.userId,
                name: persistedProfile.name,
                role: persistedProfile.role,          // still "user" — persistent store
                organization: persistedProfile.organization
            }
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Profile update failed." });
    }
}

// ─── POST /admin/check ───────────────────────────────────────────────────────
// Trusts ONLY the transient session role. Persistent profile not consulted.
// A successfully exploited session returns authorized=true.

function adminCheck(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const elevated = isSessionAdmin(req);

        addDecoyHeaders(res);
        if (!elevated) {
            return res.status(403).json({ success: true, ...ADMIN_GATE_DENIED });
        }

        return res.json({ success: true, ...ADMIN_GATE_GRANTED });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Privilege check failed." });
    }
}

// ─── POST /admin/export ──────────────────────────────────────────────────────
// Admin-only export endpoint. Returns the audit token (the flag) when the
// session role passes the admin gate.
// Presented realistically — "auditToken" looks like a legitimate export credential.

function adminExport(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        if (!isSessionAdmin(req)) {
            return res.status(403).json({
                success: false,
                message: "Export requires administrative scope.",
                code: "EXPORT_UNAUTHORIZED",
                reference: null
            });
        }

        // Mark export unlocked in persistent state
        const record = getOrInitRecord(user.id);
        setRecord(user.id, { exportUnlocked: true });

        let token = generateAuditToken();
        if (isDynamicFlagsEnabled()) {
            const dynamicContext = resolveDynamicContext(req, user, record, { createIfMissing: true });
            if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
                return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
            }
            if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
                return res.status(409).json({
                    success: false,
                    message: "No active Phantom Execution instance for this session. Reopen the challenge and try again."
                });
            }
            token = dynamicContext.expectedFlag;
        }

        addDecoyHeaders(res);
        return res.json({
            success: true,
            exportId: `EXP-${Date.now().toString(36).toUpperCase()}`,
            exportedAt: new Date().toISOString(),
            recordCount: 1,
            schemaVersion: "v2.4",
            auditToken: token,                   // THIS IS THE FLAG
            integrity: require("crypto")
                .createHash("sha256")
                .update(token, "utf8")
                .digest("hex")
                .substring(0, 16)                   // looks like a real integrity check
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Export failed." });
    }
}

// ─── GET /audit/logs ─────────────────────────────────────────────────────────
// Provides background context. Does NOT gate on admin role.
// Contains a static entry that mentions a successful export — a breadcrumb
// to the admin-export endpoint without being explicit.
// The "filter" query param looks injectable but is fully sanitised (decoy).

function getAuditLogs(req, res) {
    try {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const rawFilter = req.query.filter;
        const safeFilter = rawFilter ? sanitiseQueryParam(rawFilter) : null;

        let entries = [...STATIC_AUDIT_ENTRIES];

        if (safeFilter) {
            entries = entries.filter((e) =>
                Object.values(e).some((v) =>
                    typeof v === "string" && v.toLowerCase().includes(safeFilter.toLowerCase())
                )
            );
        }

        addDecoyHeaders(res);
        return res.json({
            success: true,
            total: entries.length,
            page: 1,
            pageSize: 50,
            entries,
            _notice: "Logs are immutable. Audit trail integrity is enforced server-side."
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Log retrieval failed." });
    }
}

// ─── GET /system/info ────────────────────────────────────────────────────────
// DECOY: looks like it might reveal useful internals. Returns only version info.
// The "token" query param is noted but never used (looks like JWT might matter).

function getSystemInfo(req, res) {
    const rawToken = req.query.token;   // DECOY — token param is silently ignored

    addDecoyHeaders(res);
    return res.json({
        application: APP_NAME,
        version: APP_VERSION,
        build: APP_BUILD,
        status: "operational",
        authScheme: "session+csrf",
        _legacyJwtSupport: false,      // DECOY: suggests JWT once mattered. It doesn't.
        uptime: Math.floor(process.uptime())
    });
}

// ─── GET /debug/env ──────────────────────────────────────────────────────────
// DECOY: endpoint name looks like it leaks config. Returns only safe stubs.

function getDebugEnv(req, res) {
    return res.json({
        env: "production",
        debug: false,
        secrets: "[REDACTED]",
        config: {
            sessionDriver: "memory",
            cacheDriver: "none",
            logLevel: "warn"
        },
        _note: "Debug access is restricted to service accounts."
    });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    getDetails,
    submitFlag,
    authLogin,
    authLogout,
    getUserProfile,
    updateUserProfile,
    adminCheck,
    adminExport,
    getAuditLogs,
    getSystemInfo,
    getDebugEnv
};
