const fs = require("fs");
const path = require("path");
const { getProgress } = require("./progressStore");
const { getTrackRecord } = require("./trackStore");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IDs of all challenges that make up the beginner track. */
const BEGINNER_CHALLENGE_IDS = [1, 2, 3, 4];

/** IDs of all challenges that must be solved to complete the advanced track. */
const ADVANCED_CHALLENGE_IDS = ["adv-1", "adv-2", "adv-3", "adv-4"];

/** Duration of a single advanced track attempt in milliseconds (4 hours). */
const ADVANCED_TRACK_DURATION_MS = 4 * 60 * 60 * 1000;

/** Log file path for advanced track lifecycle events. */
const ADVANCED_TRACK_LOG_PATH = path.resolve(__dirname, "../../database/advanced_track_events.log");

// ---------------------------------------------------------------------------
// Test-clock support
// Allow verify scripts to shift server "now" without waiting real time.
// Set TEST_CLOCK_OFFSET_MS env var to a number of milliseconds to add/subtract.
// ---------------------------------------------------------------------------

function nowMs() {
    const offset = Number(process.env.TEST_CLOCK_OFFSET_MS || 0);
    return Date.now() + (Number.isFinite(offset) ? offset : 0);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Returns true if the user has solved every challenge in the beginner track.
 * This is always computed server-side from the persistent progress store.
 *
 * @param {number} userId
 * @returns {boolean}
 */
function isBeginnerTrackComplete(userId) {
    for (const challengeId of BEGINNER_CHALLENGE_IDS) {
        const progress = getProgress(userId, challengeId);
        if (!progress || !progress.solved) {
            return false;
        }
    }
    return true;
}

/**
 * Returns a normalized solve timestamp from challenge progress.
 *
 * @param {object|null} progressState
 * @returns {number|null}
 */
function getSolveTimestampMs(progressState) {
    if (!progressState || !progressState.solved) {
        return null;
    }

    const solvedAtMs = Number(progressState.solvedAtMs);
    if (Number.isFinite(solvedAtMs) && solvedAtMs > 0) {
        return solvedAtMs;
    }

    if (progressState.firstSolveTime) {
        const parsed = Date.parse(progressState.firstSolveTime);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

/**
 * Returns true only when all advanced challenges are solved within the
 * user's active advanced-track time window.
 *
 * @param {number} userId
 * @param {object|null} record
 * @returns {boolean}
 */
function isAdvancedTrackComplete(userId, record) {
    if (!record || !record.startedAt) {
        return false;
    }

    const startedAtMs = Date.parse(record.startedAt);
    const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : null;

    for (const challengeId of ADVANCED_CHALLENGE_IDS) {
        const progress = getProgress(userId, challengeId);
        if (!progress || !progress.solved) {
            return false;
        }

        const solvedAtMs = getSolveTimestampMs(progress);
        if (!Number.isFinite(solvedAtMs)) {
            return false;
        }

        if (Number.isFinite(startedAtMs) && solvedAtMs < startedAtMs) {
            return false;
        }

        if (Number.isFinite(expiresAtMs) && solvedAtMs > expiresAtMs) {
            return false;
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

/**
 * Derive the current effective status of the advanced track for a user,
 * reconciling active→expired based purely on server time.
 *
 * @param {object|null} record  - Raw DB record (or null if none exists)
 * @param {boolean} eligible    - Whether beginner track is complete
 * @param {number} [now]        - Override for current time in ms (default: nowMs())
 * @returns {object}            - Resolved status object
 */
function computeTrackStatus(record, eligible, now) {
    const currentMs = now !== undefined ? now : nowMs();

    // No record yet — derive status from eligibility alone
    if (!record) {
        return {
            status: eligible ? "available" : "locked",
            startedAt: null,
            expiresAt: null,
            completedAt: null,
            attemptCount: 0,
            lastResetAt: null,
            resetBy: null
        };
    }

    let { status } = record;

    // Reconcile: if active but timer has elapsed, promote to expired
    if (status === "active" && record.expiresAt) {
        const expiresAtMs = Date.parse(record.expiresAt);
        if (Number.isFinite(expiresAtMs) && currentMs >= expiresAtMs) {
            status = "expired";
        }
    }

    // Reconcile: if locked but user has now completed beginner track, promote to available
    if (status === "locked" && eligible) {
        status = "available";
    }

    const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : null;
    const remainingMs =
        status === "active" && expiresAtMs ? Math.max(0, expiresAtMs - currentMs) : null;
    const remainingSeconds = remainingMs !== null ? Math.floor(remainingMs / 1000) : null;

    return {
        status,
        startedAt: record.startedAt || null,
        expiresAt: record.expiresAt || null,
        completedAt: record.completedAt || null,
        attemptCount: Number(record.attemptCount || 0),
        lastResetAt: record.lastResetAt || null,
        resetBy: record.resetBy || null,
        remainingSeconds,
        serverNow: new Date(currentMs).toISOString()
    };
}

/**
 * Build the full public-facing status response object.
 *
 * @param {number} userId
 * @returns {object}
 */
function buildAdvancedTrackResponse(userId) {
    const eligible = isBeginnerTrackComplete(userId);
    const record = getTrackRecord(userId);
    const resolved = computeTrackStatus(record, eligible);

    const canAccess = resolved.status === "active" || resolved.status === "completed";
    const canSubmit = resolved.status === "active";
    const isExpired = resolved.status === "expired";
    const canStart = resolved.status === "available";

    return {
        eligible,
        status: resolved.status,
        startedAt: resolved.startedAt,
        expiresAt: resolved.expiresAt,
        completedAt: resolved.completedAt,
        remainingSeconds: resolved.remainingSeconds,
        serverNow: resolved.serverNow,
        attemptCount: resolved.attemptCount,
        canStart,
        canAccess,
        canSubmit,
        isExpired
    };
}

// ---------------------------------------------------------------------------
// Authoritative reconciliation — write-back expiry to DB
// ---------------------------------------------------------------------------

/**
 * Full server-side reconciliation:
 * - Computes the effective status.
 * - If an active→expired transition is detected, persists "expired" back to
 *   the DB and fires an audit log event, making the transition durable.
 * - Returns the reconciled status object (same shape as computeTrackStatus).
 *
 * Call this on any request that must enforce advanced track state.
 *
 * @param {number} userId
 * @returns {object}  resolved status + eligible flag
 */
function reconcileAndPersistExpiry(userId) {
    // Lazy-require avoids any circular dependency risk at module load time.
    const { getTrackRecord, setTrackRecord } = require("./trackStore");

    const eligible = isBeginnerTrackComplete(userId);
    const record = getTrackRecord(userId);
    const currentMs = nowMs();
    const resolved = computeTrackStatus(record, eligible, currentMs);

    // Completion wins over expiry when all advanced challenges were solved
    // within the active attempt window.
    if (record && record.status === "active" && isAdvancedTrackComplete(userId, record)) {
        const completedAt = record.completedAt || new Date(currentMs).toISOString();
        const updatedRecord = setTrackRecord(userId, {
            status: "completed",
            completedAt
        });

        appendTrackAuditLog({
            eventType: "advanced_completed",
            userId,
            startedAt: updatedRecord.startedAt || record.startedAt || null,
            expiresAt: updatedRecord.expiresAt || record.expiresAt || null,
            completedAt
        });

        const completedResolved = computeTrackStatus(updatedRecord, eligible, currentMs);
        return { ...completedResolved, eligible };
    }

    // If an active→expired transition just happened, write it back to the store.
    if (record && record.status === "active" && resolved.status === "expired") {
        setTrackRecord(userId, { status: "expired" });
        appendTrackAuditLog({
            eventType: "advanced_expired",
            userId,
            startedAt: record.startedAt,
            expiresAt: record.expiresAt
        });
    }

    return { ...resolved, eligible };
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Append a structured lifecycle event to the advanced track audit log.
 *
 * @param {object} entry
 */
function appendTrackAuditLog(entry) {
    try {
        fs.mkdirSync(path.dirname(ADVANCED_TRACK_LOG_PATH), { recursive: true });
        fs.appendFileSync(
            ADVANCED_TRACK_LOG_PATH,
            `${JSON.stringify({ ...entry, timestamp: new Date().toISOString() })}\n`,
            "utf8"
        );
    } catch (error) {
        console.error("Failed to write advanced track audit log:", error.message);
    }
}

module.exports = {
    BEGINNER_CHALLENGE_IDS,
    ADVANCED_CHALLENGE_IDS,
    ADVANCED_TRACK_DURATION_MS,
    ADVANCED_TRACK_LOG_PATH,
    nowMs,
    isBeginnerTrackComplete,
    isAdvancedTrackComplete,
    computeTrackStatus,
    buildAdvancedTrackResponse,
    reconcileAndPersistExpiry,
    appendTrackAuditLog
};
