/**
 * backend/middleware/advancedTrack.js
 *
 * Reusable Express middleware for enforcing Advanced Track access rules.
 *
 * Usage on an advanced challenge router:
 *   const { requireAdvancedTrackActive } = require("../middleware/advancedTrack");
 *   router.use(requireAdvancedTrackActive);
 *
 * This middleware MUST come AFTER requireAuth (it assumes req.session.user is set).
 * It also reconciles and persists the expired state when detected, so the DB
 * always reflects the authoritative status.
 */

"use strict";

const { getSessionUser } = require("./auth");
const { reconcileAndPersistExpiry } = require("../lib/trackLogic");
const { getProgress } = require("../lib/progressStore");

// ---------------------------------------------------------------------------
// Status messages returned to the client
// ---------------------------------------------------------------------------

const MESSAGES = {
    locked:
        "Advanced Track is locked. Complete all beginner challenges first.",
    available:
        "Advanced Track has not been started yet. Start the Advanced Track from your dashboard.",
    expired:
        "Your 4-hour Advanced Track attempt window has expired. Advanced submissions are no longer accepted.",
    completed:
        "Advanced Track is already completed.",
    unauthenticated:
        "Authentication required."
};

const COMPLETED_SUBMIT_CHALLENGE_MAP = Object.freeze({
    "/phantom/submit": "adv-1",
    "/protocol/submit": "adv-2",
    "/ghost/submit": "adv-3",
    "/siem/submit": "adv-4"
});

function resolveCompletedSubmitChallengeId(req) {
    if (!req || String(req.method || "").toUpperCase() !== "POST") {
        return null;
    }

    const rawPath = String(req.path || req.originalUrl || "");
    const normalizedPath = rawPath.split("?")[0];
    return COMPLETED_SUBMIT_CHALLENGE_MAP[normalizedPath] || null;
}

// ---------------------------------------------------------------------------
// requireAdvancedTrackActive
//
// Allows access only when the authenticated user's advanced track status is
// exactly "active" and the server-computed expiry has not elapsed.
// On expiry detection, the DB record is written back to "expired" and an
// advanced_expired audit event is appended before responding 403.
// ---------------------------------------------------------------------------

function requireAdvancedTrackActive(req, res, next) {
    const user = req.authUser || getSessionUser(req);

    if (!user) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHENTICATED",
            message: MESSAGES.unauthenticated
        });
    }

    try {
        // reconcileAndPersistExpiry handles: read DB, compute status, write-back if
        // active→expired, log advanced_expired event.
        const state = reconcileAndPersistExpiry(user.id);

        if (state.status === "active") {
            // Attach resolved state to request so downstream handlers can use it
            // without re-reading the DB.
            req.advancedTrackState = state;
            return next();
        }

        if (state.status === "completed") {
            const challengeId = resolveCompletedSubmitChallengeId(req);
            if (challengeId) {
                const challengeProgress = getProgress(user.id, challengeId);
                if (challengeProgress && challengeProgress.solved === true) {
                    req.advancedTrackState = state;
                    req.allowCompletedSubmit = true;
                    return next();
                }
            }
        }

        // All non-active states → deny
        const message =
            state.status === "expired"
                ? MESSAGES.expired
                : state.status === "completed"
                    ? MESSAGES.completed
                    : state.status === "available"
                        ? MESSAGES.available
                        : MESSAGES.locked;

        return res.status(403).json({
            success: false,
            code: `ADVANCED_TRACK_${state.status.toUpperCase()}`,
            message,
            status: state.status,
            expiresAt: state.expiresAt || null,
            serverNow: state.serverNow || new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to verify Advanced Track access."
        });
    }
}

// ---------------------------------------------------------------------------
// requireAdvancedTrackNotExpired
//
// Lighter variant: allows "active" OR "completed" (useful for read-only detail
// pages where you want to let completed users review the challenge). Still
// blocks locked/available/expired.
// ---------------------------------------------------------------------------

function requireAdvancedTrackNotExpired(req, res, next) {
    const user = req.authUser || getSessionUser(req);

    if (!user) {
        return res.status(401).json({
            success: false,
            code: "UNAUTHENTICATED",
            message: MESSAGES.unauthenticated
        });
    }

    try {
        const state = reconcileAndPersistExpiry(user.id);

        if (state.status === "active" || state.status === "completed") {
            req.advancedTrackState = state;
            return next();
        }

        const message =
            state.status === "expired"
                ? MESSAGES.expired
                : state.status === "available"
                    ? MESSAGES.available
                    : MESSAGES.locked;

        return res.status(403).json({
            success: false,
            code: `ADVANCED_TRACK_${state.status.toUpperCase()}`,
            message,
            status: state.status,
            serverNow: state.serverNow || new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Unable to verify Advanced Track access."
        });
    }
}

module.exports = {
    requireAdvancedTrackActive,
    requireAdvancedTrackNotExpired
};
