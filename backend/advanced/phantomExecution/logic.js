/**
 * backend/advanced/phantomExecution/logic.js
 *
 * Core business logic for Phantom Execution (adv-1).
 *
 * Part 2: Full challenge implementation.
 *
 * ═══════════════════════════════════════════════════════════════════
 * THE VULNERABILITY — read carefully before editing
 * ═══════════════════════════════════════════════════════════════════
 *
 * The portal's profile update handler applies a defensive validation on
 * the PERSISTENT store — it strips the "role" field before writing to
 * storage, so the database always records role="user".
 *
 * However, the same handler incorrectly synchronises the submitted body
 * fields into the *transient session* without the same sanitisation.
 * The session key "phantomRole" is set directly from submitted input.
 *
 * Admin-only endpoints (admin-check, admin/export) read the role
 * exclusively from the transient session, not from persistent storage.
 *
 * Exploit chain:
 *   1. POST /api/advanced/phantom/auth/login   → obtain session context
 *   2. GET  /api/advanced/phantom/user/profile → observe role="user"
 *   3. POST /api/advanced/phantom/user/update  → submit {role:"admin",...}
 *      → persistent profile unchanged (role="user")
 *      → session phantomRole becomes "admin"
 *   4. POST /api/advanced/phantom/admin/check  → returns authorized=true
 *   5. POST /api/advanced/phantom/admin/export → returns auditToken (flag)
 *
 * The flag is ONLY accessible through this exact chain.
 * ═══════════════════════════════════════════════════════════════════
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── Challenge constants ─────────────────────────────────────────────────────

const CHALLENGE_ID = "adv-1";
const CHALLENGES_DB = path.resolve(__dirname, "../../../database/challenges.json");

// Session key that carries the transient (buggy) role
const SESSION_ROLE_KEY = "phantomRole";

// Allowed values that trigger admin-level responses
const ADMIN_ROLE_VALUES = new Set(["admin", "administrator", "root", "superuser"]);

// Fields that are STRIPPED from persistent profile writes (safe-ish pattern)
const PROTECTED_PROFILE_FIELDS = new Set(["role", "clearance", "userId"]);

// ─── Metadata loader ─────────────────────────────────────────────────────────

function loadChallengeMeta() {
    const raw = fs.readFileSync(CHALLENGES_DB, "utf8");
    const db = JSON.parse(raw);
    const entry = db.challenges.find((c) => c.id === CHALLENGE_ID);
    if (!entry) throw new Error("Phantom Execution metadata not found in challenges.json");
    return entry;
}

function buildPublicDetails(meta) {
    return {
        id: meta.id,
        title: meta.title,
        category: meta.category,
        difficulty: meta.difficulty,
        points: meta.points,
        track: meta.track,
        hintMode: meta.hintMode,
        description: meta.description,
        story: meta.story,
        objective: meta.objective,
        estimatedMinutes: meta.estimatedMinutes
    };
}

// ─── Flag verification ───────────────────────────────────────────────────────

function checkFlag(submittedFlag) {
    try {
        const meta = loadChallengeMeta();
        const submittedHash = crypto
            .createHash("sha256")
            .update((submittedFlag || "").trim(), "utf8")
            .digest();
        const expectedHash = Buffer.from(meta.flagHash, "hex");
        if (submittedHash.length !== expectedHash.length) return { correct: false };
        return { correct: crypto.timingSafeEqual(submittedHash, expectedHash) };
    } catch {
        return { correct: false };
    }
}

// ─── Session helpers ─────────────────────────────────────────────────────────

/**
 * Read the transient session role. Returns null if not set.
 */
function getSessionRole(req) {
    return (req.session && req.session[SESSION_ROLE_KEY]) || null;
}

/**
 * Set the transient session role from submitted input.
 * This is the vulnerable operation — no sanitisation of the value.
 */
function setSessionRoleFromInput(req, rawValue) {
    if (!req.session) return;
    req.session[SESSION_ROLE_KEY] = String(rawValue || "user");
}

/**
 * Clear the transient session role (e.g. on logout / re-login).
 */
function clearSessionRole(req) {
    if (req.session) delete req.session[SESSION_ROLE_KEY];
}

/**
 * Returns true if the current session has admin-level role.
 * This is the guard all admin endpoints use — trusting only session state.
 */
function isSessionAdmin(req) {
    const role = getSessionRole(req);
    return typeof role === "string" && ADMIN_ROLE_VALUES.has(role.toLowerCase());
}

// ─── Profile update logic ────────────────────────────────────────────────────

/**
 * Apply a profile update.
 *
 * The "safe" persistent write: strips protected fields so storage is
 * never modified with role/clearance overrides.
 *
 * The BUG: the raw submitted body is also synced into the session,
 * including the "role" key, WITHOUT the same sanitisation.
 *
 * @param {object}  req          - Express request (session mutated here)
 * @param {object}  currentProfile - existing persistent profile
 * @param {object}  submitted    - raw submitted body fields
 * @returns {{ persistedProfile, sessionUpdated, allowedFields }}
 */
function applyProfileUpdate(req, currentProfile, submitted) {
    // Allowed display fields that can be persisted
    const ALLOWED_PERSISTENT = ["name", "preferences"];

    const persistedUpdates = {};
    const sessionSyncFields = [];

    for (const [key, value] of Object.entries(submitted || {})) {
        if (ALLOWED_PERSISTENT.includes(key)) {
            persistedUpdates[key] = value;
        }
        // THE BUG: session receives ALL submitted fields, including "role"
        if (!PROTECTED_PROFILE_FIELDS.has(key) || key === "role") {
            sessionSyncFields.push(key);
        }
    }

    // Update transient session with submitted fields (vulnerable — includes "role")
    for (const key of Object.keys(submitted || {})) {
        if (key === "role") {
            setSessionRoleFromInput(req, submitted[key]);
        }
    }

    return {
        persistedProfile: { ...currentProfile, ...persistedUpdates },
        sessionUpdated: sessionSyncFields.length > 0,
        allowedPersistFields: ALLOWED_PERSISTENT
    };
}

// ─── Audit token (flag) ──────────────────────────────────────────────────────

/**
 * Generate the audit export token — this IS the flag.
 * Only called when the admin gate is passed.
 *
 * Presented believably as a review token in the response — no obvious label.
 */
function generateAuditToken() {
    // The flag itself, returned inside a realistic-looking export payload.
    return "CTF{phantom_execution_chain}";
}

// ─── Runtime status ──────────────────────────────────────────────────────────

function buildRuntimeStatus(record) {
    if (!record) {
        return {
            initialized: false,
            solved: false,
            attempts: 0,
            sessionActive: false,
            exportUnlocked: false
        };
    }
    return {
        initialized: record.initialized === true,
        solved: record.solved === true,
        attempts: Number(record.attempts || 0),
        sessionActive: typeof record.sessionToken === "string" && record.sessionToken.length > 0,
        exportUnlocked: record.exportUnlocked === true
    };
}

// ─── Decoy helpers ───────────────────────────────────────────────────────────

/**
 * Validates a query parameter that looks injectable but is fully sanitised.
 * Returns a safe, clean string value or null. Never executes anything.
 */
function sanitiseQueryParam(raw) {
    if (typeof raw !== "string") return null;
    // Strip anything that looks like SQL/script injection
    return raw.replace(/['";\\\-\-<>()=]/g, "").substring(0, 64);
}

module.exports = {
    CHALLENGE_ID,
    SESSION_ROLE_KEY,
    ADMIN_ROLE_VALUES,
    loadChallengeMeta,
    buildPublicDetails,
    checkFlag,
    getSessionRole,
    setSessionRoleFromInput,
    clearSessionRole,
    isSessionAdmin,
    applyProfileUpdate,
    generateAuditToken,
    buildRuntimeStatus,
    sanitiseQueryParam
};
