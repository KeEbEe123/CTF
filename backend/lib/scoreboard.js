"use strict";

const fs = require("fs");
const path = require("path");
const { getPublicProfiles } = require("./userStore");
const { listAllProgress } = require("./progressStore");
const { listAllTrackRecords } = require("./trackStore");

const challengesDbPath = path.resolve(__dirname, "../../database/challenges.json");

function getChallengesMap() {
    try {
        const raw = fs.readFileSync(challengesDbPath, "utf8");
        const parsed = JSON.parse(raw);
        const map = new Map();
        parsed.challenges.forEach(c => {
            map.set(String(c.id), { track: c.track, points: c.points || 0, title: c.title });
        });
        return map;
    } catch (e) {
        return new Map();
    }
}

function computeScoreboard() {
    const profiles = getPublicProfiles();
    const progressList = listAllProgress();
    const trackRecords = listAllTrackRecords();
    const challengesMap = getChallengesMap();

    const trackMap = new Map();
    trackRecords.forEach(tr => trackMap.set(Number(tr.userId), tr));

    const userStats = new Map();

    profiles.forEach(user => {
        userStats.set(Number(user.id), {
            userId: user.id,
            displayName: user.name || user.email.split("@")[0],
            role: user.role,
            beginnerScore: 0,
            advancedScore: 0,
            totalScore: 0,
            totalHintsUsed: 0,
            totalAttempts: 0,
            lastSolveAt: null,
            completedChallengeCount: 0,
            advancedTrackStatus: "locked",
            breakdown: [] // { challengeId, title, points, solvedAt, track, valid }
        });
    });

    // Populate advanced track status
    trackRecords.forEach(tr => {
        const entry = userStats.get(Number(tr.userId));
        if (entry) {
            entry.advancedTrackStatus = tr.status || "locked";
        }
    });

    // Compute progress
    progressList.forEach(prog => {
        const uid = Number(prog.userId);
        const cid = String(prog.challengeId);
        const state = prog.state;

        const uData = userStats.get(uid);
        if (!uData) return;

        const cMeta = challengesMap.get(cid);
        if (!cMeta) return;

        // Count attempts/hints universally for attempted challenges
        uData.totalHintsUsed += (state.hintsUsed || 0);
        uData.totalAttempts += ((state.attempts && state.attempts.total) || 0);

        if (state.solved) {
            let valid = true;
            let earnedPoints = (state.pointsAwarded !== undefined && state.pointsAwarded !== null) ? state.pointsAwarded : cMeta.points;

            // Enforce Advanced Track Time Window Rule
            if (cMeta.track === "advanced") {
                const tr = trackMap.get(uid);
                // If the track is active/completed/expired natively it has startedAt.
                // We check if solvedAtMs falls perfectly within startedAt + 4 hours.
                if (tr && tr.startedAt) {
                    const startMs = new Date(tr.startedAt).getTime();
                    const expiresMs = tr.expiresAt ? new Date(tr.expiresAt).getTime() : startMs + (4 * 60 * 60 * 1000);
                    const solvedMs = state.solvedAtMs || (state.firstSolveTime ? new Date(state.firstSolveTime).getTime() : 0);

                    if (solvedMs < startMs || solvedMs > expiresMs) {
                        valid = false; // Post-expiry or pre-mature hack block
                    }
                } else {
                    valid = false; // No start marker? No score.
                }
            }

            if (valid) {
                if (cMeta.track === "advanced") {
                    uData.advancedScore += earnedPoints;
                } else {
                    uData.beginnerScore += earnedPoints;
                }

                uData.totalScore += earnedPoints;
                uData.completedChallengeCount += 1;

                const solveMs = state.solvedAtMs || (state.firstSolveTime ? new Date(state.firstSolveTime).getTime() : 0);
                if (solveMs) {
                    const curLast = uData.lastSolveAt ? new Date(uData.lastSolveAt).getTime() : 0;
                    if (solveMs > curLast) {
                        uData.lastSolveAt = new Date(solveMs).toISOString();
                    }
                }
            }

            uData.breakdown.push({
                challengeId: cid,
                title: cMeta.title,
                track: cMeta.track,
                points: valid ? earnedPoints : 0,
                valid,
                solvedAt: state.firstSolveTime || new Date(state.solvedAtMs).toISOString(),
                attempts: state.attempts ? state.attempts.total : 0,
                hintsUsed: state.hintsUsed || 0
            });
        }
    });

    // Convert map to array and apply Tie-Break Logic
    const usersArray = Array.from(userStats.values());

    usersArray.sort((a, b) => {
        // 1. totalScore DESC
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        // 2. advancedScore DESC
        if (b.advancedScore !== a.advancedScore) return b.advancedScore - a.advancedScore;
        // 3. totalHintsUsed ASC
        if (a.totalHintsUsed !== b.totalHintsUsed) return a.totalHintsUsed - b.totalHintsUsed;
        // 4. totalAttempts ASC
        if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
        // 5. lastSolveAt ASC (Faster solver wins tied buckets)
        const timeA = a.lastSolveAt ? new Date(a.lastSolveAt).getTime() : Infinity;
        const timeB = b.lastSolveAt ? new Date(b.lastSolveAt).getTime() : Infinity;
        if (timeA !== timeB) return timeA - timeB;
        // 6. userId ASC
        return Number(a.userId) - Number(b.userId);
    });

    // Assign contiguous formal ranks, sharing ties explicitly if mathematical absolute tie
    let currentRank = 1;
    for (let i = 0; i < usersArray.length; i++) {
        const u = usersArray[i];
        if (i > 0) {
            const prev = usersArray[i - 1];
            if (
                u.totalScore === prev.totalScore &&
                u.advancedScore === prev.advancedScore &&
                u.totalHintsUsed === prev.totalHintsUsed &&
                u.totalAttempts === prev.totalAttempts &&
                u.lastSolveAt === prev.lastSolveAt
            ) {
                u.rank = prev.rank;
            } else {
                u.rank = i + 1;
            }
        } else {
            u.rank = 1;
        }
    }

    return usersArray;
}

function getLeaderboard(mode = "overall") {
    let board = computeScoreboard();

    board = board.filter(u => u.role === "student");

    if (mode === "beginner") {
        board = board.filter(u => u.beginnerScore > 0);
        // re-sort slightly if total Score overrides beginner? No, the rules dictate: "1. Higher total score first" natively applies.
    } else if (mode === "advanced") {
        board = board.filter(u => u.advancedScore > 0);
        // Tie breaks still stand.
    }

    // Re-adjust rank based on filtered subset list to avoid skipping rank digits (e.g., 1, 3, 4)
    let currentRank = 1;
    for (let i = 0; i < board.length; i++) {
        const u = board[i];
        if (i > 0) {
            const prev = board[i - 1];
            if (
                u.totalScore === prev.totalScore &&
                u.advancedScore === prev.advancedScore &&
                u.totalHintsUsed === prev.totalHintsUsed &&
                u.totalAttempts === prev.totalAttempts &&
                u.lastSolveAt === prev.lastSolveAt
            ) {
                u.rank = prev.rank;
            } else {
                u.rank = i + 1;
            }
        } else {
            u.rank = 1;
        }
    }

    return board;
}

function getUserStats(userId) {
    const full = computeScoreboard();
    return full.find(u => Number(u.userId) === Number(userId));
}

function getChallengeStats() {
    const progressList = listAllProgress();
    const map = getChallengesMap();

    const stats = new Map();
    map.forEach((cMeta, cid) => {
        stats.set(cid, {
            challengeId: cid,
            title: cMeta.title,
            track: cMeta.track,
            solveCount: 0,
            totalAttempts: 0,
            totalHintsUsed: 0,
            avgAttempts: 0,
            avgHintsUsed: 0
        });
    });

    progressList.forEach(prog => {
        const cid = String(prog.challengeId);
        const s = stats.get(cid);
        if (!s) return;

        const state = prog.state;
        s.totalAttempts += (state.attempts ? state.attempts.total : 0);
        s.totalHintsUsed += (state.hintsUsed || 0);

        if (state.solved) {
            s.solveCount += 1;
        }
    });

    // Compute averages safely
    stats.forEach(s => {
        if (s.solveCount > 0) {
            // Using solveCount as the denominator for average attempts/hints of actual solvers
            // or we could use total users mapping the challenge. Let's use total active interactions.
        }
        // Since we didn't track "users who attempted", we'll just divide by total solves roughly if > 0
        s.avgAttempts = s.solveCount > 0 ? (s.totalAttempts / s.solveCount).toFixed(1) : 0;
        s.avgHintsUsed = s.solveCount > 0 ? (s.totalHintsUsed / s.solveCount).toFixed(1) : 0;
    });

    return Array.from(stats.values());
}

module.exports = {
    computeScoreboard,
    getLeaderboard,
    getUserStats,
    getChallengeStats
};
