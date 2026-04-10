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
const {
  challengeId,
  challengesDbPath,
  challengeFilesDir,
  completionLogPath,
  downloadTokenTtlMs
} = require("../config/challengeConfig");

const dynamicChallengeId = "challenge1";
const dynamicChallengeSlug = "challenge1";
const legacyEmbeddedBase64Flag = "Q1RGe2h0dHBfcGFja2V0fQ==";
const pcapContentType = "application/vnd.tcpdump";

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
    pointsAwarded: 0
  };
}

function ensureProgressState(req) {
  const user = req.authUser || getSessionUser(req);
  if (!user) {
    return null;
  }
  const state = getOrCreateProgress(user.id, challengeId, createDefaultProgressState);
  return { user, state };
}

function saveProgressState(userId, state) {
  setProgress(userId, challengeId, state);
}

function ensureRuntimeState(req) {
  if (!req.session.challenge1Runtime) {
    req.session.challenge1Runtime = {
      downloadToken: null,
      downloadTokenExpiresAtMs: 0,
      downloadInstanceId: null
    };
  }
  if (!("downloadInstanceId" in req.session.challenge1Runtime)) {
    req.session.challenge1Runtime.downloadInstanceId = null;
  }
  return req.session.challenge1Runtime;
}

function resolveDynamicContext(req, user, state, options = {}) {
  if (!isDynamicFlagsEnabled()) {
    return { enabled: false, instance: null, expectedFlag: null, errorCode: null };
  }

  if (!req || !req.sessionID) {
    return { enabled: true, instance: null, expectedFlag: null, errorCode: "SESSION_ID_MISSING" };
  }
  if (!user || !user.id) {
    return { enabled: true, instance: null, expectedFlag: null, errorCode: "USER_MISSING" };
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

  return { enabled: true, instance, expectedFlag, errorCode: null };
}

function calculateChecksum(buffer) {
  let sum = 0;
  const paddedLength = buffer.length % 2 === 0 ? buffer.length : buffer.length + 1;

  for (let index = 0; index < paddedLength; index += 2) {
    const high = buffer[index] || 0;
    const low = buffer[index + 1] || 0;
    sum += (high << 8) | low;
    while (sum > 0xffff) {
      sum = (sum & 0xffff) + (sum >>> 16);
    }
  }

  return (~sum) & 0xffff;
}

function updateIpv4AndTcpChecksums(packetBuffer, payloadDelta) {
  if (!packetBuffer || packetBuffer.length < 14) {
    return;
  }

  const etherType = packetBuffer.readUInt16BE(12);
  if (etherType !== 0x0800) {
    return;
  }

  const ipOffset = 14;
  const versionAndIhl = packetBuffer[ipOffset];
  const version = versionAndIhl >>> 4;
  const ihlBytes = (versionAndIhl & 0x0f) * 4;
  if (version !== 4 || ihlBytes < 20 || ipOffset + ihlBytes > packetBuffer.length) {
    return;
  }

  const originalTotalLength = packetBuffer.readUInt16BE(ipOffset + 2);
  const nextTotalLength = originalTotalLength + payloadDelta;
  if (nextTotalLength < ihlBytes || nextTotalLength > 0xffff) {
    throw new Error("Unable to patch PCAP payload safely.");
  }
  packetBuffer.writeUInt16BE(nextTotalLength, ipOffset + 2);

  packetBuffer.writeUInt16BE(0, ipOffset + 10);
  const ipChecksum = calculateChecksum(packetBuffer.slice(ipOffset, ipOffset + ihlBytes));
  packetBuffer.writeUInt16BE(ipChecksum, ipOffset + 10);

  const protocol = packetBuffer[ipOffset + 9];
  if (protocol !== 6) {
    return;
  }

  const tcpOffset = ipOffset + ihlBytes;
  if (tcpOffset + 20 > packetBuffer.length) {
    return;
  }

  const tcpLength = nextTotalLength - ihlBytes;
  if (tcpLength < 20 || tcpOffset + tcpLength > packetBuffer.length) {
    return;
  }

  const sourceIp = packetBuffer.slice(ipOffset + 12, ipOffset + 16);
  const destinationIp = packetBuffer.slice(ipOffset + 16, ipOffset + 20);
  const tcpSegment = Buffer.from(packetBuffer.slice(tcpOffset, tcpOffset + tcpLength));
  tcpSegment.writeUInt16BE(0, 16);

  const pseudoHeader = Buffer.alloc(12 + tcpLength);
  sourceIp.copy(pseudoHeader, 0);
  destinationIp.copy(pseudoHeader, 4);
  pseudoHeader[8] = 0;
  pseudoHeader[9] = 6;
  pseudoHeader.writeUInt16BE(tcpLength, 10);
  tcpSegment.copy(pseudoHeader, 12);

  const tcpChecksum = calculateChecksum(pseudoHeader);
  packetBuffer.writeUInt16BE(tcpChecksum, tcpOffset + 16);
}

function buildDynamicPcapBuffer(basePcapPath, dynamicFlag) {
  const baseBuffer = fs.readFileSync(basePcapPath);
  if (baseBuffer.length < 24) {
    throw new Error("Base PCAP template is invalid.");
  }

  const markerBuffer = Buffer.from(legacyEmbeddedBase64Flag, "ascii");
  const replacementBuffer = Buffer.from(Buffer.from(dynamicFlag, "utf8").toString("base64"), "ascii");

  const outputChunks = [Buffer.from(baseBuffer.slice(0, 24))];
  let patchedOccurrences = 0;
  let cursor = 24;

  while (cursor + 16 <= baseBuffer.length) {
    const recordHeader = Buffer.from(baseBuffer.slice(cursor, cursor + 16));
    const capturedLength = recordHeader.readUInt32LE(8);
    const originalLength = recordHeader.readUInt32LE(12);
    const packetStart = cursor + 16;
    const packetEnd = packetStart + capturedLength;

    if (packetEnd > baseBuffer.length) {
      throw new Error("Malformed PCAP packet record.");
    }

    let packet = Buffer.from(baseBuffer.slice(packetStart, packetEnd));
    const markerIndex = packet.indexOf(markerBuffer);

    if (markerIndex >= 0) {
      patchedOccurrences += 1;
      packet = Buffer.concat([
        packet.slice(0, markerIndex),
        replacementBuffer,
        packet.slice(markerIndex + markerBuffer.length)
      ]);

      const payloadDelta = replacementBuffer.length - markerBuffer.length;
      const nextCapturedLength = capturedLength + payloadDelta;
      const nextOriginalLength = originalLength + payloadDelta;
      if (nextCapturedLength < 0 || nextOriginalLength < 0) {
        throw new Error("Patched PCAP packet length is invalid.");
      }

      recordHeader.writeUInt32LE(nextCapturedLength, 8);
      recordHeader.writeUInt32LE(nextOriginalLength, 12);
      updateIpv4AndTcpChecksums(packet, payloadDelta);
    }

    outputChunks.push(recordHeader, packet);
    cursor = packetEnd;
  }

  if (cursor !== baseBuffer.length) {
    throw new Error("Malformed PCAP structure.");
  }
  if (patchedOccurrences !== 1) {
    throw new Error("Expected exactly one embedded flag marker in base PCAP.");
  }

  return Buffer.concat(outputChunks);
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
    pointsAwarded: state.pointsAwarded
  };
}

function appendCompletionLog(entry) {
  try {
    fs.mkdirSync(path.dirname(completionLogPath), { recursive: true });
    fs.appendFileSync(completionLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write completion log:", error.message);
  }
}

function getChallengeDetails(req, res) {
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
      flagFormat: challenge.flagFormat,
      description: challenge.description,
      hintsTotal: (challenge.hints || []).length,
      requiresExternalTool: true,
      requiredTools: ["Wireshark"],
      toolingNote:
        "Requires Wireshark installed locally to inspect the downloaded PCAP file."
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

function issueDownloadToken(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);
    const runtimeState = ensureRuntimeState(req);

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const { user, state } = progressContext;
    if (isDynamicFlagsEnabled()) {
      const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: true });
      if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
        return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
      }
      if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
        return res.status(409).json({
          success: false,
          message: "No active challenge instance for this session. Reopen Challenge 1 and try again."
        });
      }
      runtimeState.downloadInstanceId = dynamicContext.instance.instanceId;
    } else {
      runtimeState.downloadInstanceId = null;
    }

    runtimeState.downloadToken = crypto.randomBytes(24).toString("hex");
    runtimeState.downloadTokenExpiresAtMs = Date.now() + downloadTokenTtlMs;

    return res.json({
      success: true,
      token: runtimeState.downloadToken,
      expiresInSeconds: Math.floor(downloadTokenTtlMs / 1000)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to issue download token." });
  }
}

function downloadChallengeFile(req, res) {
  try {
    const challenge = loadChallenge();
    const progressContext = ensureProgressState(req);
    const runtimeState = ensureRuntimeState(req);
    const submittedToken = String(req.query.token || "");

    if (!challenge) {
      return res.status(404).json({ success: false, message: "Challenge not found." });
    }
    if (!progressContext) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    if (!submittedToken) {
      return res.status(403).json({
        success: false,
        message: "Download token is required."
      });
    }

    if (!runtimeState.downloadToken || submittedToken !== runtimeState.downloadToken) {
      return res.status(403).json({
        success: false,
        message: "Invalid download token."
      });
    }

    if (Date.now() > runtimeState.downloadTokenExpiresAtMs) {
      return res.status(403).json({
        success: false,
        message: "Download token expired. Request a new one."
      });
    }

    const { user, state } = progressContext;
    const tokenBoundInstanceId = runtimeState.downloadInstanceId || null;
    runtimeState.downloadToken = null;
    runtimeState.downloadTokenExpiresAtMs = 0;
    runtimeState.downloadInstanceId = null;

    const pcapPath = path.resolve(challengeFilesDir, challenge.pcapFile);
    if (!fs.existsSync(pcapPath)) {
      return res.status(404).json({ success: false, message: "PCAP file is missing." });
    }

    if (!isDynamicFlagsEnabled()) {
      return res.download(pcapPath);
    }

    if (!tokenBoundInstanceId) {
      return res.status(409).json({
        success: false,
        message: "Download token is not bound to an active challenge instance. Request a new token."
      });
    }

    const dynamicContext = resolveDynamicContext(req, user, state, { createIfMissing: false });
    if (dynamicContext.errorCode === "SESSION_ID_MISSING") {
      return res.status(500).json({ success: false, message: "Session unavailable for challenge instance." });
    }
    if (dynamicContext.errorCode === "NO_ACTIVE_INSTANCE") {
      return res.status(409).json({
        success: false,
        message: "No active challenge instance for this session. Reopen Challenge 1 and request a new token."
      });
    }
    if (dynamicContext.instance.instanceId !== tokenBoundInstanceId) {
      return res.status(409).json({
        success: false,
        message: "Download token no longer matches the active challenge instance. Request a new token."
      });
    }

    const dynamicFlag = buildFlag({
      challengeId: dynamicChallengeId,
      challengeSlug: dynamicChallengeSlug,
      sessionId: req.sessionID,
      instanceId: tokenBoundInstanceId
    });
    const dynamicPcapBuffer = buildDynamicPcapBuffer(pcapPath, dynamicFlag);
    res.setHeader("Content-Type", pcapContentType);
    res.setHeader("Content-Disposition", `attachment; filename=\"${challenge.pcapFile}\"`);
    return res.send(dynamicPcapBuffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to download challenge file." });
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

function submitFlag(req, res) {
  try {
    const challenge = loadChallenge();
    const submittedFlag = (req.body.flag || "").trim();
    const progressContext = ensureProgressState(req);

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
      const alreadySolvedResponse = {
        success: true,
        alreadySolved: true,
        message: "Challenge already solved in this session.",
        points: 0,
        pointsAwarded: 0,
        sessionState: buildSessionSnapshot(req, challenge, state)
      };

      if (challenge.postSolve) {
        alreadySolvedResponse.postSolve = challenge.postSolve;
      }

      return res.json(alreadySolvedResponse);
    }

    state.attempts.total += 1;

    let isCorrect = false;
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
          message: "No active challenge instance for this session. Reopen Challenge 1 and try again."
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
          console.error("Failed to mark challenge1 instance solved:", error.message);
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
        attempts: state.attempts
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
  getChallengeDetails,
  issueDownloadToken,
  downloadChallengeFile,
  revealHint,
  submitFlag
};
