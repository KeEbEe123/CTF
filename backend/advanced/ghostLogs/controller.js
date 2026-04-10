"use strict";

const fs = require("fs");
const path = require("path");
const logProvider = require("./logProvider");
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

const DYNAMIC_CHALLENGE_ID = "adv-3";
const DYNAMIC_CHALLENGE_SLUG = "ghost_logs";

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
    if (!meta) {
        return res.status(500).json({ success: false, message: "Metadata missing" });
    }

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

function download(req, res) {
    const user = currentUser(req);
    const progressState = user && user.id ? progressStore.getProgress(user.id, DYNAMIC_CHALLENGE_ID) : null;
    const dynamicContext = resolveDynamicContext(req, user, progressState, { createIfMissing: true });

    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }
    if (dynamicContext.errorCode === "USER_MISSING") {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const dataset = isDynamicFlagsEnabled() && dynamicContext.expectedFlag
        ? logProvider.getDataset({ flag: dynamicContext.expectedFlag })
        : logProvider.getDataset();

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="ghost_logs.json"');

    return res.status(200).send(JSON.stringify(dataset, null, 2));
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
                    message: "No active Ghost Logs instance for this session. Reopen the challenge and try again."
                });
            }

            activeDynamicInstance = dynamicContext.instance;
        }

        const correct = isDynamicFlagsEnabled()
            ? verifySubmittedFlag({
                submittedFlag: flag,
                challengeId: DYNAMIC_CHALLENGE_ID,
                challengeSlug: DYNAMIC_CHALLENGE_SLUG,
                sessionId: req.sessionID,
                instanceId: activeDynamicInstance.instanceId
            })
            : flag.trim() === logProvider.STATIC_FLAG;

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
                    console.error("[WARN] Failed to mark adv-3 challenge instance solved:", instanceError.message);
                }
            }

            try {
                reconcileAndPersistExpiry(userId);
            } catch (reconcileError) {
                console.error("[WARN] Failed to reconcile advanced track completion (adv-3):", reconcileError.message);
            }

            try {
                const logPath = path.resolve(__dirname, "../../../database/challenge_adv-3_completions.log");
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
            } catch (error) {
                console.error("[ERROR] Critical failure in ghostLogs completion logic:", error.message);
            }
        }

        return res.json({
            success: true,
            correct,
            points: correct ? awardedPoints : 0,
            pointsAwarded: correct ? awardedPoints : 0,
            message: correct ? "Forensic timeline reconstruction accepted." : "Incorrect flag payload."
        });
    } catch (error) {
        console.error("[ERROR] ghostLogs submit failed:", error.message);
        return res.status(500).json({ success: false, message: "Submission failed." });
    }
}

module.exports = {
    details,
    download,
    submit
};
