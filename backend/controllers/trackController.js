const { getSessionUser } = require("../middleware/auth");
const {
    isBeginnerTrackComplete,
    computeTrackStatus,
    buildAdvancedTrackResponse,
    reconcileAndPersistExpiry,
    appendTrackAuditLog,
    ADVANCED_TRACK_DURATION_MS,
    nowMs
} = require("../lib/trackLogic");
const {
    getOrInitTrackRecord,
    setTrackRecord,
    listAllTrackRecords
} = require("../lib/trackStore");
const { getPublicProfileById, getPublicProfiles } = require("../lib/userStore");
const { listUserProgress } = require("../lib/progressStore");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Student-facing handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/tracks/advanced/status
 * Returns the full advanced track state for the authenticated user.
 * Also reconciles and persists expiry if an active→expired transition is
 * detected at this moment, so status is always authoritative.
 */
function getAdvancedStatus(req, res) {
    try {
        const user = req.authUser || getSessionUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        // Use reconcileAndPersistExpiry so this poll also writes back expiry if needed.
        const state = reconcileAndPersistExpiry(user.id);

        const canAccess = state.status === "active" || state.status === "completed";
        const canSubmit = state.status === "active";
        const isExpired = state.status === "expired";
        const canStart = state.status === "available";

        return res.json({
            success: true,
            eligible: state.eligible,
            status: state.status,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            completedAt: state.completedAt,
            remainingSeconds: state.remainingSeconds,
            serverNow: state.serverNow,
            attemptCount: state.attemptCount,
            canStart,
            canAccess,
            canSubmit,
            isExpired
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Unable to load advanced track status." });
    }
}

/**
 * GET /api/tracks/summary
 * Returns the aggregated challenge totals and score for the dashboard
 */
function getDashboardSummary(req, res) {
    try {
        const user = req.authUser || getSessionUser(req);
        if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

        const dbPath = path.resolve(__dirname, "../../database/challenges.json");
        const raw = fs.readFileSync(dbPath, "utf8");
        const parsed = JSON.parse(raw);
        const challenges = parsed.challenges || [];

        const totalChallenges = challenges.length;
        const maxScore = challenges.reduce((sum, c) => sum + (Number(c.points) || 0), 0);

        const progress = listUserProgress(user.id) || [];
        const solvedCount = progress.filter(p => p.state && p.state.solved).length;
        const totalScore = progress.reduce((sum, p) => p.state && p.state.solved ? sum + (Number(p.state.pointsAwarded) || 0) : sum, 0);

        return res.json({
            success: true,
            totalChallenges,
            maxScore,
            solvedCount,
            totalScore
        });
    } catch (e) {
        return res.status(500).json({ success: false, message: "Unable to compute dashboard summary." });
    }
}


/**
 * POST /api/tracks/advanced/start
 * Starts the advanced track for the authenticated user. Only valid when status is "available".
 */
function startAdvancedTrack(req, res) {
    try {
        const user = req.authUser || getSessionUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        // Check beginner track completion (server-side, always)
        if (!isBeginnerTrackComplete(user.id)) {
            return res.status(403).json({
                success: false,
                message: "You must complete all beginner challenges before starting the Advanced Track."
            });
        }

        const record = getOrInitTrackRecord(user.id);
        const eligible = true; // verified above
        const resolved = computeTrackStatus(record, eligible);

        // Only allow starting if status is "available"
        if (resolved.status !== "available") {
            const msgs = {
                active: "Advanced Track is already active. Your timer is running.",
                completed: "Advanced Track is already completed.",
                expired: "Advanced Track attempt has expired. An instructor must reset it before you can retry.",
                locked: "You are not yet eligible to start the Advanced Track."
            };
            return res.status(409).json({
                success: false,
                message: msgs[resolved.status] || "Cannot start Advanced Track in current state.",
                status: resolved.status
            });
        }

        const currentMs = nowMs();
        const startedAt = new Date(currentMs).toISOString();
        const expiresAt = new Date(currentMs + ADVANCED_TRACK_DURATION_MS).toISOString();

        const updated = setTrackRecord(user.id, {
            status: "active",
            startedAt,
            expiresAt,
            completedAt: null
        });

        appendTrackAuditLog({
            eventType: "advanced_track_started",
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            startedAt,
            expiresAt,
            attemptCount: updated.attemptCount
        });

        return res.json({
            success: true,
            message: "Advanced Track started. Your 4-hour window is now active.",
            status: "active",
            startedAt,
            expiresAt,
            remainingSeconds: Math.floor(ADVANCED_TRACK_DURATION_MS / 1000),
            serverNow: startedAt
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Unable to start Advanced Track." });
    }
}

// ---------------------------------------------------------------------------
// Admin/Instructor-facing handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/tracks/advanced/reset
 * Resets a user's advanced track to "available", allowing a fresh attempt.
 * Requires instructor or admin role.
 */
function adminResetAdvancedTrack(req, res) {
    try {
        const admin = req.authUser || getSessionUser(req);
        if (!admin) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        const targetUserId = Number(req.body.targetUserId);
        if (!Number.isInteger(targetUserId) || targetUserId < 1) {
            return res.status(400).json({ success: false, message: "targetUserId is required and must be a valid user ID." });
        }

        // Confirm target user exists
        const targetUser = getPublicProfileById(targetUserId);
        if (!targetUser) {
            return res.status(404).json({ success: false, message: "Target user not found." });
        }

        const record = getOrInitTrackRecord(targetUserId);
        const eligible = isBeginnerTrackComplete(targetUserId);
        const resolved = computeTrackStatus(record, eligible);

        const previousStatus = resolved.status;
        const nowIso = new Date(nowMs()).toISOString();

        // Increment attempt count only if the track was actually started before
        const wasAttempted = ["active", "expired", "completed"].includes(previousStatus);

        const updated = setTrackRecord(targetUserId, {
            status: "available",
            startedAt: null,
            expiresAt: null,
            completedAt: null,
            attemptCount: wasAttempted ? (Number(record.attemptCount || 0) + 1) : Number(record.attemptCount || 0),
            lastResetAt: nowIso,
            resetBy: admin.id
        });

        appendTrackAuditLog({
            eventType: "advanced_track_reset",
            targetUserId,
            targetUserName: targetUser.name,
            targetUserEmail: targetUser.email,
            resetBy: admin.id,
            resetByName: admin.name,
            previousStatus,
            newStatus: "available",
            attemptCount: updated.attemptCount
        });

        return res.json({
            success: true,
            message: `Advanced Track has been reset for ${targetUser.name}. They may start a new timed attempt.`,
            targetUserId,
            targetUserName: targetUser.name,
            previousStatus,
            newStatus: "available",
            attemptCount: updated.attemptCount
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Unable to reset Advanced Track." });
    }
}

/**
 * GET /api/admin/tracks/advanced/users
 * Returns all users with their advanced track status (for instructor/admin dashboard).
 */
function listAdvancedUsers(req, res) {
    try {
        const allUsers = getPublicProfiles();
        const allRecords = listAllTrackRecords();
        const recordMap = new Map(allRecords.map((r) => [Number(r.userId), r]));

        const result = allUsers.map((user) => {
            const record = recordMap.get(Number(user.id)) || null;
            const eligible = isBeginnerTrackComplete(user.id);
            const resolved = computeTrackStatus(record, eligible);

            return {
                userId: user.id,
                userName: user.name,
                userEmail: user.email,
                role: user.role,
                eligible,
                status: resolved.status,
                startedAt: resolved.startedAt,
                expiresAt: resolved.expiresAt,
                completedAt: resolved.completedAt,
                remainingSeconds: resolved.remainingSeconds,
                attemptCount: resolved.attemptCount,
                lastResetAt: resolved.lastResetAt
            };
        });

        return res.json({ success: true, users: result, serverNow: new Date(nowMs()).toISOString() });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Unable to load advanced track user list." });
    }
}

module.exports = {
    getAdvancedStatus,
    startAdvancedTrack,
    adminResetAdvancedTrack,
    listAdvancedUsers,
    getDashboardSummary
};
