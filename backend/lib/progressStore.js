const path = require("path");
const { deepClone, ensureJsonFile, readJsonFile, writeJsonFileAtomic } = require("./jsonFileStore");
const { assignScore } = require("./dynamicScoring");

const progressFilePath = path.resolve(__dirname, "../../database/progress.json");
const defaultData = {
  version: 1,
  records: []
};

function readStore() {
  const data = readJsonFile(progressFilePath, defaultData);
  if (!Array.isArray(data.records)) {
    data.records = [];
  }
  return data;
}

function writeStore(data) {
  writeJsonFileAtomic(progressFilePath, data);
}

function normalizeKey(userId, challengeId) {
  const numericUserId = Number(userId);
  const stringChallengeId = String(challengeId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    throw new Error("Invalid user id.");
  }
  if (!stringChallengeId) {
    throw new Error("Invalid challenge id.");
  }
  return { numericUserId, numericChallengeId: stringChallengeId };
}

function initializeProgressStore() {
  ensureJsonFile(progressFilePath, defaultData);
}

function getProgress(userId, challengeId) {
  const { numericUserId, numericChallengeId } = normalizeKey(userId, challengeId);
  const store = readStore();
  const record = store.records.find(
    (entry) => Number(entry.userId) === numericUserId && String(entry.challengeId) === numericChallengeId
  );
  return record ? deepClone(record.state) : null;
}

function setProgress(userId, challengeId, state) {
  const { numericUserId, numericChallengeId } = normalizeKey(userId, challengeId);
  const store = readStore();
  const recordIndex = store.records.findIndex(
    (entry) => Number(entry.userId) === numericUserId && String(entry.challengeId) === numericChallengeId
  );

  const record = {
    userId: numericUserId,
    challengeId: numericChallengeId,
    state: deepClone(state),
    updatedAt: new Date().toISOString()
  };

  if (recordIndex === -1) {
    store.records.push(record);
  } else {
    store.records[recordIndex] = record;
  }

  writeStore(store);
  return deepClone(record.state);
}

function getOrCreateProgress(userId, challengeId, createDefault) {
  const existing = getProgress(userId, challengeId);
  if (existing) {
    return existing;
  }

  const initialState = typeof createDefault === "function" ? createDefault() : {};
  return setProgress(userId, challengeId, initialState);
}

function markChallengeSolved(userId, challengeId, points = 500) {
  let state = getProgress(userId, challengeId);
  if (!state) {
    state = {
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

  if (!state.attempts || typeof state.attempts !== "object") {
    state.attempts = { total: 0, correct: 0, incorrect: 0 };
  }

  if (!state.solved) {
    state.solved = true;
    state.solvedAtMs = Date.now();

    // Apply Global Dynamic Scoring Assignment
    const { scoreAwarded, solveOrder } = assignScore(userId, challengeId);
    state.pointsAwarded = scoreAwarded;
    state.solveOrder = solveOrder;

    state.firstSolveTime = state.firstSolveTime || new Date().toISOString();
    state.attempts.correct = (state.attempts.correct || 0) + 1;
    return setProgress(userId, challengeId, state);
  }

  return deepClone(state);
}

function listUserProgress(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    return [];
  }

  const store = readStore();
  return store.records
    .filter((entry) => entry && entry.userId && entry.state)
    .filter((entry) => Number(entry.userId) === numericUserId)
    .map((entry) => ({
      challengeId: entry.challengeId,
      state: deepClone(entry.state)
    }))
    .sort((a, b) => String(a.challengeId).localeCompare(String(b.challengeId)));
}

function listAllProgress() {
  const store = readStore();
  return store.records
    .filter((entry) => entry && entry.state)
    .map((entry) => ({
      userId: Number(entry.userId),
      challengeId: entry.challengeId,
      state: deepClone(entry.state),
      updatedAt: entry.updatedAt || null
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.userId) &&
        entry.userId > 0 &&
        String(entry.challengeId).length > 0
    )
    .sort((a, b) => {
      if (a.userId !== b.userId) {
        return a.userId - b.userId;
      }
      return String(a.challengeId).localeCompare(String(b.challengeId));
    });
}

module.exports = {
  progressFilePath,
  initializeProgressStore,
  getProgress,
  setProgress,
  getOrCreateProgress,
  markChallengeSolved,
  listUserProgress,
  listAllProgress
};
