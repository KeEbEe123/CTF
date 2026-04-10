"use strict";

const fs = require("fs");
const path = require("path");

function getSolveCount(challengeId) {
    const { listAllProgress } = require("./progressStore");
    const allProgress = listAllProgress();
    // Verify true arrays safely counting chronological absolute solves per identity matrix
    return allProgress.filter(p => p && p.state && p.state.solved && String(p.challengeId) === String(challengeId)).length;
}

function calculateScore(challengeId, currentSolveCount) {
    // defaults
    let initialPoints = 500;
    let minPoints = 100;
    let decayRate = 20;

    // fetch initial points
    try {
        const dbPath = path.resolve(__dirname, "../../database/challenges.json");
        const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
        const cMeta = db.challenges.find(c => String(c.id) === String(challengeId));
        if (cMeta && cMeta.points) {
            initialPoints = Number(cMeta.points);
            if (cMeta.track === "beginner") {
                // If it's beginner, custom degradation or standard? 
                // The prompt says default config is: decayRate 20, minPoints 100
                // I'll keep the standard across the board unless instructed otherwise
            }
        }
    } catch (e) {
        // Safe fallback native behavior
    }

    // Fallback logic, exactly as requested: max(minPoints, initialPoints - (solveCount * decayRate))
    // solveCount represents how many people solved it BEFORE this person
    return Math.max(minPoints, initialPoints - (currentSolveCount * decayRate));
}

function assignScore(userId, challengeId) {
    // Computes the score correctly based on how many people already solved it natively
    const solveCount = getSolveCount(challengeId);
    const score = calculateScore(challengeId, solveCount);

    // Return parameters mapping natively to JSON arrays globally locking state mathematically
    return { scoreAwarded: score, solveOrder: solveCount + 1 };
}

module.exports = {
    getSolveCount,
    calculateScore,
    assignScore
};
