"use strict";

const fs = require("fs");
const path = require("path");
const siemEngine = require("./siemEngine");
const { getSessionUser } = require("../../middleware/auth");
const progressStore = require("../../lib/progressStore");
const { reconcileAndPersistExpiry } = require("../../lib/trackLogic");
const { assignScore } = require("../../lib/dynamicScoring");
const { isDynamicFlagsEnabled, buildFlag, verifySubmittedFlag } = require("../../lib/dynamicFlagService");
const {
    getOrCreateChallengeInstance,
    getActiveChallengeInstance,
    markChallengeInstanceSolved,
    listChallengeInstances
} = require("../../lib/challengeInstanceStore");

const FLAG_FORMAT_REGEX = /^CTF\{[A-Za-z0-9_]+\}$/;
const DYNAMIC_CHALLENGE_ID = "adv-4";
const DYNAMIC_CHALLENGE_SLUG = "signal_noise";

function currentUser(req) {
    return req.authUser || getSessionUser(req);
}

function resolveDynamicContext(req, user, state, options = {}) {
    if (!isDynamicFlagsEnabled()) {
        return { enabled: false, instance: null, expectedFlag: null, errorCode: null };
    }

    const normalizedSessionId = String(req && req.sessionID ? req.sessionID : "").trim();
    if (!normalizedSessionId) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "SESSION_ID_MISSING" };
    }
    if (!user || !user.id) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "USER_MISSING" };
    }

    const scope = {
        userId: user.id,
        challengeId: DYNAMIC_CHALLENGE_ID,
        challengeSlug: DYNAMIC_CHALLENGE_SLUG,
        sessionId: normalizedSessionId
    };

    const createIfMissing = options.createIfMissing !== false;
    let instance = getActiveChallengeInstance(scope);

    if (!instance && state && state.solved) {
        const priorRecords = listChallengeInstances(scope);
        instance = priorRecords.find((record) => record.status === "solved") || priorRecords[0] || null;
    }

    if (!instance && createIfMissing && (!state || !state.solved)) {
        instance = getOrCreateChallengeInstance(scope).instance;
    }

    if (!instance) {
        return { enabled: true, instance: null, expectedFlag: null, errorCode: "NO_ACTIVE_INSTANCE" };
    }

    const expectedFlag = buildFlag({
        challengeId: DYNAMIC_CHALLENGE_ID,
        challengeSlug: DYNAMIC_CHALLENGE_SLUG,
        sessionId: normalizedSessionId,
        instanceId: instance.instanceId
    });

    return { enabled: true, instance, expectedFlag, errorCode: null };
}

function getMetadata() {
    const metadataPath = path.resolve(__dirname, "../../../database/challenges.json");
    if (!fs.existsSync(metadataPath)) return null;
    try {
        const db = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        return db.challenges.find((challenge) => String(challenge.id) === DYNAMIC_CHALLENGE_ID) || null;
    } catch {
        return null;
    }
}

function createDefaultProgressState() {
    return {
        startedAtMs: Date.now(),
        solved: false,
        solvedAtMs: null,
        completionDurationSeconds: null,
        attempts: { total: 0, correct: 0, incorrect: 0 },
        hintsUsed: 0,
        firstSolveTime: null,
        pointsAwarded: 0
    };
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

function details(req, res) {
    const meta = getMetadata();
    if (!meta) return res.status(500).json({ success: false, message: "Metadata missing" });

    const user = currentUser(req);
    const progressState = user && user.id ? progressStore.getProgress(user.id, DYNAMIC_CHALLENGE_ID) : null;
    const dynamicContext = resolveDynamicContext(req, user, progressState, { createIfMissing: true });
    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }
    if (dynamicContext.errorCode === "USER_MISSING") {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const displayPoints = user && user.id
        ? resolveDisplayPoints(user.id, DYNAMIC_CHALLENGE_ID, meta.points)
        : Number(meta.points) || 0;

    return res.json({
        success: true,
        challenge: {
            title: meta.title,
            category: meta.category,
            difficulty: meta.difficulty,
            points: displayPoints,
            maxPoints: meta.points,
            story: meta.story,
            description: meta.description
        }
    });
}

function getAlerts(req, res) {
    const user = currentUser(req);
    const progressState = user && user.id ? progressStore.getProgress(user.id, DYNAMIC_CHALLENGE_ID) : null;
    const dynamicContext = resolveDynamicContext(req, user, progressState, { createIfMissing: true });

    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }
    if (dynamicContext.errorCode === "USER_MISSING") {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const alerts = isDynamicFlagsEnabled() && dynamicContext.expectedFlag
        ? siemEngine.getAlerts({ flag: dynamicContext.expectedFlag })
        : siemEngine.getAlerts();

    return res.json({ success: true, alerts });
}

function getLogs(req, res) {
    const user = currentUser(req);
    const progressState = user && user.id ? progressStore.getProgress(user.id, DYNAMIC_CHALLENGE_ID) : null;
    const dynamicContext = resolveDynamicContext(req, user, progressState, { createIfMissing: true });

    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }
    if (dynamicContext.errorCode === "USER_MISSING") {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const logs = isDynamicFlagsEnabled() && dynamicContext.expectedFlag
        ? siemEngine.getLogs({ flag: dynamicContext.expectedFlag })
        : siemEngine.getLogs();

    return res.json({ success: true, logs });
}

function submit(req, res) {
    try {
        const user = currentUser(req);
        if (!user || !user.id) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }

        const userId = user.id;
        const { flag } = req.body || {};

        if (!flag || typeof flag !== "string") {
            return res.status(400).json({ success: false, message: "Flag missing" });
        }

        const state =
            progressStore.getProgress(userId, DYNAMIC_CHALLENGE_ID) ||
            progressStore.getOrCreateProgress(userId, DYNAMIC_CHALLENGE_ID, createDefaultProgressState);

        if (state.solved) {
            return res.json({
                success: true,
                correct: true,
                alreadySolved: true,
                points: 0,
                pointsAwarded: 0,
                message: "Challenge already solved."
            });
        }

        const normalizedFlag = flag.trim();
        if (!FLAG_FORMAT_REGEX.test(normalizedFlag)) {
            return res.json({
                success: true,
                correct: false,
                code: "INVALID_FLAG_FORMAT",
                points: 0,
                pointsAwarded: 0,
                message: "Invalid flag format. Expected CTF{...}."
            });
        }

        let activeDynamicInstance = null;
        if (isDynamicFlagsEnabled()) {
            const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: false });
            if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
                return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
            }
            if (dynamicContext.errorCode === "USER_MISSING") {
                return res.status(401).json({ success: false, message: "Authentication required." });
            }
            if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
                return res.status(409).json({
                    success: false,
                    message: "No active Signal Noise instance for this session. Reopen the challenge and try again."
                });
            }

            activeDynamicInstance = dynamicContext.instance;
        }

        const correct = isDynamicFlagsEnabled()
            ? verifySubmittedFlag({
                submittedFlag: normalizedFlag,
                challengeId: DYNAMIC_CHALLENGE_ID,
                challengeSlug: DYNAMIC_CHALLENGE_SLUG,
                sessionId: req.sessionID,
                instanceId: activeDynamicInstance.instanceId
            })
            : normalizedFlag === siemEngine.STATIC_FLAG;

        let awardedPoints = 0;
        if (correct) {
            const solvedState = progressStore.markChallengeSolved(userId, DYNAMIC_CHALLENGE_ID);
            const parsedPoints = Number(solvedState && solvedState.pointsAwarded);
            awardedPoints = Number.isFinite(parsedPoints) && parsedPoints >= 0 ? parsedPoints : 0;

            if (activeDynamicInstance && activeDynamicInstance.instanceId) {
                try {
                    markChallengeInstanceSolved(activeDynamicInstance.instanceId, {
                        solvedByUserId: userId,
                        solvedForChallengeId: DYNAMIC_CHALLENGE_ID
                    });
                } catch (instanceError) {
                    console.error("[WARN] Failed to mark adv-4 challenge instance solved:", instanceError.message);
                }
            }

            try {
                reconcileAndPersistExpiry(userId);
            } catch (reconcileError) {
                console.error("[WARN] Failed to reconcile advanced track completion (adv-4):", reconcileError.message);
            }

            try {
                const logPath = path.resolve(__dirname, "../../../database/challenge_adv-4_completions.log");
                const entry = {
                    eventType: "challenge_completed",
                    challengeId: DYNAMIC_CHALLENGE_ID,
                    userId,
                    userName: user ? user.name : "Student",
                    userEmail: user ? user.email : "student@zerotrace",
                    sessionId: req.sessionID || "unknown",
                    timestamp: new Date().toISOString(),
                    scoreAwarded: awardedPoints,
                    hintsUsed: 0,
                    completionDurationSeconds: 0,
                    attempts: { total: 1, correct: 1, incorrect: 0 }
                };
                fs.mkdirSync(path.dirname(logPath), { recursive: true });
                fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
            } catch (err) {
                console.error("[ERROR] Critical failure in signalNoise completion logic:", err.message);
            }
        }

        return res.json({
            success: true,
            correct,
            code: correct ? "CORRECT" : "INCORRECT_FLAG_VALUE",
            points: correct ? awardedPoints : 0,
            pointsAwarded: correct ? awardedPoints : 0,
            message: correct ? "True attack path verified. Threat neutralized." : "Incorrect flag value."
        });
    } catch (error) {
        console.error("[ERROR] signalNoise submit failed:", error.message);
        return res.status(500).json({ success: false, message: "Submission failed." });
    }
}

module.exports = {
    details,
    getAlerts,
    getLogs,
    submit
};
