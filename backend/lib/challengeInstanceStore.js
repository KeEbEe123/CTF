const crypto = require("crypto");
const path = require("path");
const { deepClone, ensureJsonFile, readJsonFile, writeJsonFileAtomic } = require("./jsonFileStore");

const instanceFilePath = path.resolve(__dirname, "../../database/challenge_instances.json");
const defaultData = {
  records: []
};

const INSTANCE_STATUS = Object.freeze({
  ACTIVE: "active",
  SOLVED: "solved",
  EXPIRED: "expired",
  ROTATED: "rotated"
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    throw new Error("Invalid userId for challenge instance.");
  }
  return numericUserId;
}

function normalizeChallengeId(challengeId) {
  const normalizedChallengeId = String(challengeId || "").trim();
  if (!normalizedChallengeId) {
    throw new Error("Invalid challengeId for challenge instance.");
  }
  return normalizedChallengeId;
}

function normalizeSessionId(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    throw new Error("Invalid sessionId for challenge instance.");
  }
  return normalizedSessionId;
}

function normalizeChallengeSlug(challengeSlug, challengeId) {
  const fallback = `challenge_${challengeId}`;
  const raw = String(challengeSlug || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return raw || "challenge";
}

function normalizeScope({ userId, challengeId, sessionId, challengeSlug } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedChallengeId = normalizeChallengeId(challengeId);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedChallengeSlug = normalizeChallengeSlug(challengeSlug, normalizedChallengeId);

  return {
    userId: normalizedUserId,
    challengeId: normalizedChallengeId,
    sessionId: normalizedSessionId,
    challengeSlug: normalizedChallengeSlug
  };
}

function normalizeTtlMs(ttlMs) {
  const parsed = Number(ttlMs);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function createInstanceId() {
  return `inst_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
}

function initializeChallengeInstanceStore() {
  ensureJsonFile(instanceFilePath, defaultData);
}

function readStore() {
  const store = readJsonFile(instanceFilePath, defaultData);
  if (!Array.isArray(store.records)) {
    store.records = [];
  }
  return store;
}

function writeStore(store) {
  writeJsonFileAtomic(instanceFilePath, store);
}

function isSameScope(record, scope) {
  return (
    Number(record.userId) === Number(scope.userId) &&
    String(record.challengeId) === String(scope.challengeId) &&
    String(record.sessionId) === String(scope.sessionId)
  );
}

function isRecordExpired(record, nowMs = Date.now()) {
  if (!record || !record.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(record.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function expireRecord(record, now, status, reason) {
  record.status = status;
  record.updatedAt = now;
  record.expiredAt = record.expiredAt || now;
  record.expireReason = String(reason || "").trim() || null;
}

function orderByMostRecentCreated(records) {
  return [...records].sort((left, right) => {
    const leftMs = Date.parse(left.createdAt || "");
    const rightMs = Date.parse(right.createdAt || "");
    const safeLeftMs = Number.isFinite(leftMs) ? leftMs : 0;
    const safeRightMs = Number.isFinite(rightMs) ? rightMs : 0;
    return safeRightMs - safeLeftMs;
  });
}

function resolveActiveInstanceInStore(store, scope) {
  const now = nowIso();
  const nowMs = Date.parse(now);
  let mutated = false;

  const scopeRecords = store.records.filter((record) => isSameScope(record, scope));
  for (const record of scopeRecords) {
    if (record.status === INSTANCE_STATUS.ACTIVE && isRecordExpired(record, nowMs)) {
      expireRecord(record, now, INSTANCE_STATUS.EXPIRED, "ttl_expired");
      mutated = true;
    }
  }

  const activeRecords = orderByMostRecentCreated(
    scopeRecords.filter((record) => record.status === INSTANCE_STATUS.ACTIVE)
  );

  if (activeRecords.length > 1) {
    const [primary, ...duplicates] = activeRecords;
    for (const duplicate of duplicates) {
      expireRecord(duplicate, now, INSTANCE_STATUS.ROTATED, "duplicate_active_cleanup");
      mutated = true;
    }
    return { activeInstance: primary, mutated };
  }

  return {
    activeInstance: activeRecords[0] || null,
    mutated
  };
}

function getChallengeInstanceById(instanceId) {
  const normalizedInstanceId = String(instanceId || "").trim();
  if (!normalizedInstanceId) {
    return null;
  }

  const store = readStore();
  const record = store.records.find((entry) => String(entry.instanceId) === normalizedInstanceId);
  return record ? deepClone(record) : null;
}

function getActiveChallengeInstance(scopeInput) {
  const scope = normalizeScope(scopeInput);
  const store = readStore();
  const { activeInstance, mutated } = resolveActiveInstanceInStore(store, scope);

  if (mutated) {
    writeStore(store);
  }

  return activeInstance ? deepClone(activeInstance) : null;
}

function expireActiveChallengeInstances(scopeInput, reason = "rotated") {
  const scope = normalizeScope(scopeInput);
  const store = readStore();
  const now = nowIso();
  const terminalStatus = String(reason || "").toLowerCase().includes("rotate")
    ? INSTANCE_STATUS.ROTATED
    : INSTANCE_STATUS.EXPIRED;

  let updatedCount = 0;
  for (const record of store.records) {
    if (!isSameScope(record, scope)) {
      continue;
    }
    if (record.status !== INSTANCE_STATUS.ACTIVE) {
      continue;
    }

    expireRecord(record, now, terminalStatus, reason);
    updatedCount += 1;
  }

  if (updatedCount > 0) {
    writeStore(store);
  }

  return updatedCount;
}

function createChallengeInstance({
  userId,
  challengeId,
  sessionId,
  challengeSlug,
  ttlMs,
  metadata
} = {}) {
  const scope = normalizeScope({ userId, challengeId, sessionId, challengeSlug });
  expireActiveChallengeInstances(scope, "rotated_by_create");

  const store = readStore();
  const now = nowIso();
  const safeTtlMs = normalizeTtlMs(ttlMs);

  const record = {
    instanceId: createInstanceId(),
    userId: scope.userId,
    challengeId: scope.challengeId,
    challengeSlug: scope.challengeSlug,
    sessionId: scope.sessionId,
    status: INSTANCE_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    expiresAt: safeTtlMs ? new Date(Date.parse(now) + safeTtlMs).toISOString() : null,
    solvedAt: null,
    expiredAt: null,
    expireReason: null,
    metadata: metadata && typeof metadata === "object" ? deepClone(metadata) : {}
  };

  store.records.push(record);
  writeStore(store);

  return deepClone(record);
}

function getOrCreateChallengeInstance(options = {}) {
  const scope = normalizeScope(options);
  const activeInstance = getActiveChallengeInstance(scope);
  if (activeInstance) {
    return {
      instance: activeInstance,
      reused: true
    };
  }

  return {
    instance: createChallengeInstance({ ...options, ...scope }),
    reused: false
  };
}

function markChallengeInstanceSolved(instanceId, metadataPatch) {
  const normalizedInstanceId = String(instanceId || "").trim();
  if (!normalizedInstanceId) {
    return null;
  }

  const store = readStore();
  const index = store.records.findIndex((record) => String(record.instanceId) === normalizedInstanceId);
  if (index === -1) {
    return null;
  }

  const record = store.records[index];
  if (record.status === INSTANCE_STATUS.SOLVED) {
    return deepClone(record);
  }

  const now = nowIso();
  record.status = INSTANCE_STATUS.SOLVED;
  record.updatedAt = now;
  record.solvedAt = record.solvedAt || now;
  record.expiredAt = null;
  record.expireReason = null;

  if (metadataPatch && typeof metadataPatch === "object") {
    record.metadata = {
      ...(record.metadata || {}),
      ...deepClone(metadataPatch)
    };
  }

  writeStore(store);
  return deepClone(record);
}

function expireChallengeInstance(instanceId, reason = "expired") {
  const normalizedInstanceId = String(instanceId || "").trim();
  if (!normalizedInstanceId) {
    return null;
  }

  const store = readStore();
  const index = store.records.findIndex((record) => String(record.instanceId) === normalizedInstanceId);
  if (index === -1) {
    return null;
  }

  const record = store.records[index];
  if (record.status !== INSTANCE_STATUS.ACTIVE) {
    return deepClone(record);
  }

  const now = nowIso();
  const status = String(reason || "").toLowerCase().includes("rotate")
    ? INSTANCE_STATUS.ROTATED
    : INSTANCE_STATUS.EXPIRED;
  expireRecord(record, now, status, reason);

  writeStore(store);
  return deepClone(record);
}

function listChallengeInstances(filters = {}) {
  const store = readStore();
  const normalizedStatus = filters.status ? String(filters.status).trim().toLowerCase() : null;
  const hasUserIdFilter = filters.userId !== undefined && filters.userId !== null && String(filters.userId).trim() !== "";
  const hasChallengeIdFilter =
    filters.challengeId !== undefined &&
    filters.challengeId !== null &&
    String(filters.challengeId).trim() !== "";
  const hasSessionIdFilter =
    filters.sessionId !== undefined &&
    filters.sessionId !== null &&
    String(filters.sessionId).trim() !== "";

  return orderByMostRecentCreated(store.records)
    .filter((record) => {
      if (normalizedStatus && String(record.status).toLowerCase() !== normalizedStatus) {
        return false;
      }
      if (hasUserIdFilter && Number(record.userId) !== Number(filters.userId)) {
        return false;
      }
      if (hasChallengeIdFilter && String(record.challengeId) !== String(filters.challengeId)) {
        return false;
      }
      if (hasSessionIdFilter && String(record.sessionId) !== String(filters.sessionId)) {
        return false;
      }
      return true;
    })
    .map((record) => deepClone(record));
}

module.exports = {
  instanceFilePath,
  INSTANCE_STATUS,
  initializeChallengeInstanceStore,
  getChallengeInstanceById,
  getActiveChallengeInstance,
  getOrCreateChallengeInstance,
  createChallengeInstance,
  markChallengeInstanceSolved,
  expireChallengeInstance,
  expireActiveChallengeInstances,
  listChallengeInstances
};
