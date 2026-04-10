/**
 * backend/advanced/phantomExecution/data.js
 *
 * Static reference data for the Phantom Execution challenge.
 *
 * Provides realistic-feeling portal persona profiles and audit log
 * entries that populate the challenge API surface.
 *
 * These are fixed across all users so that the challenge environment
 * feels consistent and believable regardless of which student is playing.
 * Per-user state (role elevation, session token, export status) lives in state.js.
 */

"use strict";

const crypto = require("crypto");

// ── Portal application identity ──────────────────────────────────────────────

const APP_NAME = "InternalOps Portal";
const APP_VERSION = "3.7.1";
const APP_BUILD = "20240918-stable";

// ── Per-user portal profile template ────────────────────────────────────────
// Generated deterministically so the same user always gets the same profile.

/**
 * Build a believable portal user profile for the given platform user.
 * Role is always "user" in persistent storage — the exploit mutates the
 * transient session, not this.
 */
function buildPortalProfile(platformUser) {
    const seed = String(platformUser.id);
    const hash = crypto.createHash("md5").update(seed).digest("hex");
    const org = ["Cerberus Systems", "Nexus Analytics", "OpsCentral Ltd", "Verdant Security"][Number("0x" + hash[0]) % 4];
    const dept = ["Engineering", "Operations", "Security Research", "Platform Infrastructure"][Number("0x" + hash[1]) % 4];

    return {
        userId: `U-${String(platformUser.id).padStart(4, "0")}`,
        name: platformUser.name || "Unknown User",
        email: platformUser.email || "unknown@internal",
        role: "user",                       // persistent storage always says "user"
        organization: org,
        department: dept,
        clearance: "standard",
        preferences: {
            theme: "dark",
            locale: "en-US",
            notifications: true
        },
        accountMeta: {
            createdAt: "2024-03-01T09:00:00.000Z",
            lastLoginAt: new Date().toISOString(),
            mfaEnabled: true,
            _legacyJwt: null                        // DECOY: stale field, nonfunctional
        }
    };
}

// ── Audit log entries ────────────────────────────────────────────────────────
// Static entries that give the challenge context and plausibility.
// The most recent real entry comes from live state; these are background noise.

const STATIC_AUDIT_ENTRIES = [
    {
        id: "AUD-0041",
        timestamp: "2024-09-17T14:22:11.000Z",
        actor: "svc-account-scanner",
        action: "ROLE_ASSIGNMENT",
        target: "user/U-0017",
        outcome: "SUCCESS",
        details: "Scheduled role revalidation completed for non-admin accounts."
    },
    {
        id: "AUD-0042",
        timestamp: "2024-09-17T16:05:30.000Z",
        actor: "admin@internalops.local",
        action: "EXPORT_INITIATED",
        target: "audit/export",
        outcome: "SUCCESS",
        details: "Privileged audit export completed. Token issued to requesting session."
    },
    {
        id: "AUD-0043",
        timestamp: "2024-09-18T08:14:02.000Z",
        actor: "svc-account-monitor",
        action: "PROFILE_UPDATE_BLOCKED",
        target: "user/U-0031",
        outcome: "DENIED",
        details: "Attempt to modify role field rejected by persistent store validation."
    },
    {
        id: "AUD-0044",
        timestamp: "2024-09-18T09:30:00.000Z",
        actor: "platform-deployer",
        action: "CONFIG_RELOAD",
        target: "system/session-handler",
        outcome: "SUCCESS",
        details: "Session handler reloaded after config patch. Verification pending."
    }
];

// ── Decoy parameter hints injected into some responses ───────────────────────
// These look interesting but lead nowhere productive.

const DECOY_HEADERS = {
    "X-Internal-Request-Id": () => crypto.randomBytes(8).toString("hex"),
    "X-Session-Scope": "standard"
};

// ── Admin-gate response templates ────────────────────────────────────────────

const ADMIN_GATE_DENIED = {
    authorized: false,
    scope: "standard",
    message: "Insufficient privilege level for this operation.",
    code: "PRIV_INSUFFICIENT"
};

const ADMIN_GATE_GRANTED = {
    authorized: true,
    scope: "admin",
    message: "Privilege level confirmed for administrative scope.",
    code: "PRIV_OK"
};

module.exports = {
    APP_NAME,
    APP_VERSION,
    APP_BUILD,
    buildPortalProfile,
    STATIC_AUDIT_ENTRIES,
    DECOY_HEADERS,
    ADMIN_GATE_DENIED,
    ADMIN_GATE_GRANTED
};
