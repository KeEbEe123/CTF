const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getOrCreateProgress, setProgress } = require("../lib/progressStore");
const { getSessionUser } = require("../middleware/auth");
const { isDynamicFlagsEnabled, buildFlag, verifySubmittedFlag } = require("../lib/dynamicFlagService");
const {
  getOrCreateChallengeInstance,
  getActiveChallengeInstance,
  markChallengeInstanceSolved,
  listChallengeInstances
} = require("../lib/challengeInstanceStore");
const { challengeId, challengesDbPath, completionLogPath, commandMaxLength } = require("../config/challenge4Config");
const { createTerminalState, executeTerminalCommand, formatPrompt } = require("../lib/challenge4Terminal");

const dynamicChallengeId = "challenge4";
const dynamicChallengeSlug = "challenge4";

function loadChallenge() {
  const raw = fs.readFileSync(challengesDbPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.challenges.find((challenge) => challenge.id === challengeId);
}

function compareHashes(submittedFlag, expectedHashHex) {
  const submittedHash = crypto.createHash("sha256").update(submittedFlag.trim(), "utf8").digest();
  const expectedHash = Buffer.from(expectedHashHex, "hex");

  if (submittedHash.length !== expectedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(submittedHash, expectedHash);
}

function createDefaultProgressState() {
  return {
    startedAtMs: Date.now(),
    solved: false,
    solvedAtMs: null,
    completionDurationSeconds: null,
    attempts: {
      total: 0,
      correct: 0,
      incorrect: 0
    },
    hintsUsed: 0,
    firstSolveTime: null,
    pointsAwarded: 0,
    terminal: createTerminalState()
  };
}

function ensureProgressState(req) {
  const user = req.authUser || getSessionUser(req);
  if (!user) {
    return null;
  }
  const state = getOrCreateProgress(user.id, challengeId, createDefaultProgressState);
  if (!state.terminal || typeof state.terminal !== "object") {
    state.terminal = createTerminalState();
  }
  return { user, state };
}

function resolveDynamicContext(req, user, state, options = {}) {
  if (!isDynamicFlagsEnabled()) {
    if (state && state.terminal && state.terminal.dynamicFlagEnabled) {
      state.terminal.dynamicFlagEnabled = false;
    }
    return { enabled: false, instance: null, expectedFlag: null, errorCode: null };
  }

  if (!req || !req.sessionID) {
    return { enabled: true, instance: null, expectedFlag: null, errorCode: "SESSION_ID_MISSING" };
  }

  const scope = {
    userId: user.id,
    challengeId: dynamicChallengeId,
    challengeSlug: dynamicChallengeSlug,
    sessionId: req.sessionID
  };

  const createIfMissing = options.createIfMissing !== false;
  let instance = getActiveChallengeInstance(scope);

  if (!instance && state && state.solved) {
    const existingRecords = listChallengeInstances(scope);
    instance = existingRecords.find((record) => record.status === "solved") || existingRecords[0] || null;
  }

  if (!instance && createIfMissing && (!state || !state.solved)) {
    instance = getOrCreateChallengeInstance(scope).instance;
  }

  if (!instance) {
    return { enabled: true, instance: null, expectedFlag: null, errorCode: "NO_ACTIVE_INSTANCE" };
  }

  const expectedFlag = buildFlag({
    challengeId: dynamicChallengeId,
    challengeSlug: dynamicChallengeSlug,
    sessionId: req.sessionID,
    instanceId: instance.instanceId
  });

  if (state && state.terminal) {
    state.terminal.dynamicFlag = expectedFlag;
    state.terminal.dynamicFlagEnabled = true;
    state.terminal.dynamicFlagInstanceId = instance.instanceId;
  }

  return { enabled: true, instance, expectedFlag, errorCode: null };
}

function saveProgressState(userId, state) {
  setProgress(userId, challengeId, state);
}

function getElapsedSeconds(state) {
  if (state.solved && Number.isInteger(state.completionDurationSeconds)) {
    return state.completionDurationSeconds;
  }

  return Math.max(0, Math.floor((Date.now() - state.startedAtMs) / 1000));
}

function buildSessionSnapshot(req, challenge, state) {
  const hintsTotal = Array.isArray(challenge.hints) ? challenge.hints.length : 0;

  return {
    sessionId: req.sessionID,
    elapsedSeconds: getElapsedSeconds(state),
    solved: state.solved,
    solvedAt: state.solvedAtMs ? new Date(state.solvedAtMs).toISOString() : null,
    firstSolveTime: state.firstSolveTime,
    completionDurationSeconds: state.completionDurationSeconds,
    attempts: state.attempts,
    hintsUsed: state.hintsUsed,
    hintsRemaining: Math.max(0, hintsTotal - state.hintsUsed),
    revealedHints: (challenge.hints || []).slice(0, state.hintsUsed),
    pointsAwarded: state.pointsAwarded,
    terminal: {
      prompt: formatPrompt(state.terminal),
      ftpConnected: state.terminal.ftp.connected,
      commandCount: state.terminal.commandHistory.length
    }
  };
}

function appendCompletionLog(entry) {
  try {
    fs.mkdirSync(path.dirname(completionLogPath), { recursive: true });
    fs.appendFileSync(completionLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write challenge4 completion log:", error.message);
  }
}

function getChallenge(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { user, state } = progressContext;
    const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: true });
    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
      return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }

    const publicData = {
      id: challenge.id,
      title: challenge.title,
      category: challenge.category,
      difficulty: challenge.difficulty,
      points: challenge.points,
      estimatedMinutes: challenge.estimatedMinutes,
      flagFormat: challenge.flagFormat || "CTF{...}",
      description: challenge.description,
      objective: challenge.objective,
      hintsTotal: (challenge.hints || []).length
    };

    const responseBody = {
      success: true,
      challenge: publicData,
      sessionState: buildSessionSnapshot(req, challenge, state)
    };

    if (state.solved && challenge.postSolve) {
      responseBody.postSolve = challenge.postSolve;
    }

    return res.json(responseBody);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load challenge data." });
  }
}

function revealHint(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { user, state } = progressContext;

    if (state.hintsUsed >= (challenge.hints || []).length) {
      return res.json({
        success: false,
        message: "All hints are already revealed.",
        sessionState: buildSessionSnapshot(req, challenge, state)
      });
    }

    state.hintsUsed += 1;
    saveProgressState(user.id, state);
    const hint = challenge.hints[state.hintsUsed - 1];

    return res.json({
      success: true,
      hint,
      hintNumber: state.hintsUsed,
      message: `Hint ${state.hintsUsed} revealed.`,
      sessionState: buildSessionSnapshot(req, challenge, state)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to reveal hint." });
  }
}

function runCommand(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);
    const submittedCommand = String(req.body.command || "").trim();

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { user, state } = progressContext;
    const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: true });
    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
      return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }

    if (!submittedCommand) {
      return res.status(400).json({ success: false, message: "Command is required." });
    }

    if (submittedCommand.length > commandMaxLength) {
      return res.status(400).json({
        success: false,
        message: `Command is too long (max ${commandMaxLength} characters).`
      });
    }

    state.terminal.commandHistory.push(submittedCommand);
    if (state.terminal.commandHistory.length > 150) {
      state.terminal.commandHistory.shift();
    }

    const commandResult = executeTerminalCommand(state.terminal, submittedCommand);
    saveProgressState(user.id, state);
    return res.json({
      success: true,
      command: submittedCommand,
      output: commandResult.output || [],
      clear: Boolean(commandResult.clear),
      sessionState: buildSessionSnapshot(req, challenge, state)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to execute command." });
  }
}

function submitFlag(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);
    const submittedFlag = (req.body.flag || "").trim();

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { user, state } = progressContext;

    if (!submittedFlag) {
      return res.status(400).json({ success: false, message: "Flag is required." });
    }

    if (state.solved) {
      const alreadySolved = {
        success: true,
        alreadySolved: true,
        message: "Challenge already solved in this session.",
        points: 0,
        pointsAwarded: 0,
        sessionState: buildSessionSnapshot(req, challenge, state)
      };

      if (challenge.postSolve) {
        alreadySolved.postSolve = challenge.postSolve;
      }

      return res.json(alreadySolved);
    }

    state.attempts.total += 1;

    let isCorrect = false;
    let activeDynamicInstance = null;

    if (isDynamicFlagsEnabled()) {
      const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: false });

      if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
      }
      if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
        return res.status(409).json({
          success: false,
          message: "No active challenge instance for this session. Reopen Challenge 4 and try again."
        });
      }

      activeDynamicInstance = dynamicContext.instance;
      isCorrect = verifySubmittedFlag({
        submittedFlag,
        challengeId: dynamicChallengeId,
        challengeSlug: dynamicChallengeSlug,
        sessionId: req.sessionID,
        instanceId: dynamicContext.instance.instanceId
      });
    } else {
      isCorrect = compareHashes(submittedFlag, challenge.flagHash);
    }

    if (isCorrect) {
      state.attempts.correct += 1;
      const solvedAtMs = Date.now();
      const completionDurationSeconds = Math.max(0, Math.floor((solvedAtMs - state.startedAtMs) / 1000));

      state.solved = true;
      state.solvedAtMs = solvedAtMs;
      state.completionDurationSeconds = completionDurationSeconds;
      state.firstSolveTime = state.firstSolveTime || new Date(solvedAtMs).toISOString();
      const { assignScore } = require("../lib/dynamicScoring");
      const { scoreAwarded, solveOrder } = assignScore(req.authUser.id, challenge.id);
      state.pointsAwarded = scoreAwarded;
      state.solveOrder = solveOrder;
      saveProgressState(user.id, state);

      if (activeDynamicInstance && activeDynamicInstance.instanceId) {
        try {
          markChallengeInstanceSolved(activeDynamicInstance.instanceId, {
            solvedByUserId: user.id,
            solvedForChallengeId: challenge.id
          });
        } catch (error) {
          console.error("Failed to mark challenge4 instance solved:", error.message);
        }
      }

      appendCompletionLog({
        eventType: "challenge_completed",
        challengeId: challenge.id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        sessionId: req.sessionID,
        timestamp: new Date(solvedAtMs).toISOString(),
        scoreAwarded: challenge.points,
        hintsUsed: state.hintsUsed,
        completionDurationSeconds,
        attempts: state.attempts,
        commandCount: state.terminal.commandHistory.length
      });

      const successResponse = {
        success: true,
        message: "Correct flag! Challenge solved.",
        pointsAwarded: challenge.points,
        sessionState: buildSessionSnapshot(req, challenge, state)
      };

      if (challenge.postSolve) {
        successResponse.postSolve = challenge.postSolve;
      }

      return res.json(successResponse);
    }

    state.attempts.incorrect += 1;
    saveProgressState(user.id, state);
    return res.json({
      success: false,
      message: "Incorrect flag. Try again.",
      sessionState: buildSessionSnapshot(req, challenge, state)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to validate submitted flag." });
  }
}

module.exports = {
  getChallenge,
  revealHint,
  runCommand,
  submitFlag
};
