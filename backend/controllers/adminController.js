const fs = require("fs");
const path = require("path");
const { getPublicProfiles } = require("../lib/userStore");

const challengesDbPath = path.resolve(__dirname, "../../database/challenges.json");
const challengesIds = ["1", "2", "3", "4", "adv-1", "adv-2", "adv-3", "adv-4"];

function toChallengeId(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function isNumericChallengeId(challengeId) {
  return /^[0-9]+$/.test(toChallengeId(challengeId));
}

function compareChallengeIds(left, right) {
  const leftId = toChallengeId(left);
  const rightId = toChallengeId(right);

  const leftIsNumeric = isNumericChallengeId(leftId);
  const rightIsNumeric = isNumericChallengeId(rightId);

  if (leftIsNumeric && rightIsNumeric) {
    return Number(leftId) - Number(rightId);
  }
  if (leftIsNumeric) {
    return -1;
  }
  if (rightIsNumeric) {
    return 1;
  }

  return leftId.localeCompare(rightId);
}

function getCompletionLogFilePaths(challengeId) {
  const normalizedId = toChallengeId(challengeId);
  if (!normalizedId) {
    return [];
  }

  if (normalizedId.startsWith("adv-")) {
    // Canonical writer naming + legacy fallback naming for backward compatibility.
    return [
      path.resolve(__dirname, `../../database/challenge_${normalizedId}_completions.log`),
      path.resolve(__dirname, `../../database/challenge${normalizedId}_completions.log`)
    ];
  }

  return [path.resolve(__dirname, `../../database/challenge${normalizedId}_completions.log`)];
}

const completionLogFiles = challengesIds.map((challengeId) => ({
  challengeId,
  filePaths: getCompletionLogFilePaths(challengeId)
}));

function toNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed);
}

function averageRounded(total, count) {
  if (!count) {
    return 0;
  }
  return Math.round(total / count);
}

function loadChallengeCatalog() {
  try {
    const raw = fs.readFileSync(challengesDbPath, "utf8");
    const parsed = JSON.parse(raw);
    const challenges = Array.isArray(parsed.challenges) ? parsed.challenges : [];
    return challenges
      .map((challenge) => ({
        id: toChallengeId(challenge.id),
        title: challenge.title || `Challenge ${challenge.id}`,
        category: challenge.category || "Unknown",
        difficulty: challenge.difficulty || "Unknown",
        points: toNonNegativeInt(challenge.points)
      }))
      .filter((challenge) => challenge.id.length > 0)
      .sort((a, b) => compareChallengeIds(a.id, b.id));
  } catch (error) {
    return challengesIds.map((id) => ({
      id: toChallengeId(id),
      title: `Challenge ${id}`,
      category: "Unknown",
      difficulty: "Unknown",
      points: 0
    }))
      .sort((a, b) => compareChallengeIds(a.id, b.id));
  }
}

function normalizeAttempts(rawAttempts) {
  if (!rawAttempts || typeof rawAttempts !== "object") {
    return {
      total: 0,
      correct: 0,
      incorrect: 0
    };
  }

  return {
    total: toNonNegativeInt(rawAttempts.total),
    correct: toNonNegativeInt(rawAttempts.correct),
    incorrect: toNonNegativeInt(rawAttempts.incorrect)
  };
}

function normalizeLogEntry(rawEntry, fallbackChallengeId) {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const rawId = rawEntry.challengeId || fallbackChallengeId;
  const challengeId = toChallengeId(rawId);
  
  if (!challengeId) {
    return null;
  }

  const timestamp = typeof rawEntry.timestamp === "string" ? rawEntry.timestamp : "";
  const timestampMs = Date.parse(timestamp);
  const score = toNonNegativeInt(
    Object.prototype.hasOwnProperty.call(rawEntry, "score") ? rawEntry.score : rawEntry.scoreAwarded
  );
  const userIdValue = Number(rawEntry.userId);
  const userId = Number.isInteger(userIdValue) && userIdValue > 0 ? userIdValue : null;

  return {
    challengeId,
    userId,
    userName: typeof rawEntry.userName === "string" ? rawEntry.userName : null,
    userEmail: typeof rawEntry.userEmail === "string" ? rawEntry.userEmail : null,
    sessionId: String(rawEntry.sessionId || ""),
    timestamp,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    score,
    hintsUsed: toNonNegativeInt(rawEntry.hintsUsed),
    attempts: normalizeAttempts(rawEntry.attempts),
    completionDurationSeconds: toNonNegativeInt(rawEntry.completionDurationSeconds),
    commandCount: toNonNegativeInt(rawEntry.commandCount)
  };
}

function readCompletionEntries() {
  const entries = [];
  const dedupe = new Set();

  for (const logFile of completionLogFiles) {
    for (const filePath of logFile.filePaths) {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const lines = fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const normalized = normalizeLogEntry(parsed, logFile.challengeId);
          if (normalized) {
            const key = [
              normalized.challengeId,
              normalized.userId || "",
              normalized.sessionId || "",
              normalized.timestamp || ""
            ].join("|");

            if (dedupe.has(key)) {
              continue;
            }

            dedupe.add(key);
            entries.push(normalized);
          }
        } catch (error) {
          // Skip malformed lines but keep API responsive for valid data.
        }
      }
    }
  }

  entries.sort((a, b) => b.timestampMs - a.timestampMs);
  return entries;
}

function buildSummary(entries) {
  const totalSolves = entries.length;
  const uniqueParticipants = new Set(
    entries
      .map((entry) => (entry.userId ? `u:${entry.userId}` : entry.sessionId ? `s:${entry.sessionId}` : ""))
      .filter(Boolean)
  );
  const totalStudents = uniqueParticipants.size;
  const totalHintsUsed = entries.reduce((sum, entry) => sum + entry.hintsUsed, 0);
  const totalSolveTime = entries.reduce((sum, entry) => sum + entry.completionDurationSeconds, 0);
  const totalAttempts = entries.reduce((sum, entry) => sum + entry.attempts.total, 0);
  const terminalEntries = entries.filter((entry) => entry.challengeId === "3" || entry.challengeId === "4");
  const totalCommandCount = terminalEntries.reduce((sum, entry) => sum + entry.commandCount, 0);

  return {
    totalSolves,
    totalStudents,
    totalHintsUsed,
    averageSolveTime: averageRounded(totalSolveTime, totalSolves),
    totalAttempts,
    averageAttempts: averageRounded(totalAttempts, totalSolves),
    totalCommandCount,
    averageCommandCount: averageRounded(totalCommandCount, terminalEntries.length)
  };
}

function buildChallengeStats(entries) {
  const catalog = loadChallengeCatalog();
  const stats = catalog.map((challenge) => {
    const challengeEntries = entries.filter((entry) => entry.challengeId === challenge.id);
    const solves = challengeEntries.length;
    const solveTimeSum = challengeEntries.reduce((sum, entry) => sum + entry.completionDurationSeconds, 0);
    const attemptsSum = challengeEntries.reduce((sum, entry) => sum + entry.attempts.total, 0);
    const hintsSum = challengeEntries.reduce((sum, entry) => sum + entry.hintsUsed, 0);
    const scoreSum = challengeEntries.reduce((sum, entry) => sum + entry.score, 0);
    const commandUsageCount = challengeEntries.reduce((sum, entry) => sum + entry.commandCount, 0);

    return {
      challengeId: challenge.id,
      title: challenge.title,
      category: challenge.category,
      difficulty: challenge.difficulty,
      points: challenge.points,
      solves,
      avgSolveTime: averageRounded(solveTimeSum, solves),
      avgAttempts: averageRounded(attemptsSum, solves),
      totalHintsUsed: hintsSum,
      totalScoreAwarded: scoreSum,
      commandUsageCount,
      avgCommandUsage: averageRounded(commandUsageCount, solves)
    };
  });

  return stats.sort((a, b) => compareChallengeIds(a.challengeId, b.challengeId));
}

function buildRecentEntries(entries, limit = 25) {
  const usersById = new Map(getPublicProfiles().map((profile) => [Number(profile.id), profile]));

  return entries.slice(0, limit).map((entry) => ({
    challengeId: entry.challengeId,
    userId: entry.userId,
    userName: entry.userName || usersById.get(Number(entry.userId || 0))?.name || null,
    userEmail: entry.userEmail || usersById.get(Number(entry.userId || 0))?.email || null,
    sessionId: entry.sessionId,
    timestamp: entry.timestamp,
    score: entry.score,
    attempts: entry.attempts,
    hintsUsed: entry.hintsUsed,
    commandCount: entry.commandCount
  }));
}

function getSummary(req, res) {
  try {
    const entries = readCompletionEntries();
    return res.json(buildSummary(entries));
  } catch (error) {
    return res.status(500).json({ message: "Unable to compute admin summary." });
  }
}

function getChallengeStats(req, res) {
  try {
    const entries = readCompletionEntries();
    return res.json(buildChallengeStats(entries));
  } catch (error) {
    return res.status(500).json({ message: "Unable to compute challenge statistics." });
  }
}

function getRecent(req, res) {
  try {
    const entries = readCompletionEntries();
    return res.json(buildRecentEntries(entries));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load recent admin activity." });
  }
}

module.exports = {
  getSummary,
  getChallengeStats,
  getRecent
};
