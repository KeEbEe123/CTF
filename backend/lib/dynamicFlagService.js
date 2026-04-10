const crypto = require("crypto");

const ENABLE_DYNAMIC_FLAGS_ENV_KEY = "ENABLE_DYNAMIC_FLAGS";
const FALLBACK_LOCAL_SECRET = "ctf_local_dev_flag_secret_change_me";
const HMAC_ALGORITHM = "sha256";
const DEFAULT_HASH_SLICE_LENGTH = 20;

let hasWarnedAboutFallbackSecret = false;

function isTruthyEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isDynamicFlagsEnabled() {
  return isTruthyEnv(process.env[ENABLE_DYNAMIC_FLAGS_ENV_KEY]);
}

function normalizeRequiredString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`Missing required ${fieldName}.`);
  }
  return normalized;
}

function normalizeChallengeSlug(challengeSlug, challengeId) {
  const fallback = `challenge_${String(challengeId || "").trim()}`;
  const raw = String(challengeSlug || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return raw || "challenge";
}

function resolveFlagSecret() {
  const configuredSecret = String(process.env.FLAG_SECRET || "").trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const runtimeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase();
  const canUseFallback = runtimeEnv === "development" || runtimeEnv === "test";

  if (!canUseFallback) {
    throw new Error("FLAG_SECRET is required when NODE_ENV is not development/test.");
  }

  if (!hasWarnedAboutFallbackSecret) {
    hasWarnedAboutFallbackSecret = true;
    console.warn("FLAG_SECRET is missing. Using local development fallback secret.");
  }

  return FALLBACK_LOCAL_SECRET;
}

function buildRawToken({ challengeId, sessionId, instanceId, hashSliceLength = DEFAULT_HASH_SLICE_LENGTH }) {
  const normalizedChallengeId = normalizeRequiredString(challengeId, "challengeId");
  const normalizedSessionId = normalizeRequiredString(sessionId, "sessionId");
  const normalizedInstanceId = normalizeRequiredString(instanceId, "instanceId");
  const material = `${normalizedChallengeId}:${normalizedSessionId}:${normalizedInstanceId}`;
  const digestHex = crypto
    .createHmac(HMAC_ALGORITHM, resolveFlagSecret())
    .update(material, "utf8")
    .digest("hex")
    .toUpperCase();

  const safeSliceLength = Number.isInteger(Number(hashSliceLength)) ? Number(hashSliceLength) : DEFAULT_HASH_SLICE_LENGTH;
  const finalSliceLength = Math.max(12, Math.min(64, safeSliceLength));
  return digestHex.slice(0, finalSliceLength);
}

function buildFlag({ challengeId, challengeSlug, sessionId, instanceId, hashSliceLength } = {}) {
  const normalizedChallengeId = normalizeRequiredString(challengeId, "challengeId");
  const token = buildRawToken({
    challengeId: normalizedChallengeId,
    sessionId,
    instanceId,
    hashSliceLength
  });
  const slug = normalizeChallengeSlug(challengeSlug, normalizedChallengeId);

  return `CTF{${slug}_${token}}`;
}

function buildFlagHash(flagValue) {
  const normalizedFlag = normalizeRequiredString(flagValue, "flagValue");
  return crypto.createHash("sha256").update(normalizedFlag, "utf8").digest("hex");
}

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySubmittedFlag({
  submittedFlag,
  expectedFlag,
  expectedFlagHash,
  challengeId,
  challengeSlug,
  sessionId,
  instanceId
} = {}) {
  const normalizedSubmittedFlag = String(submittedFlag || "").trim();
  if (!normalizedSubmittedFlag) {
    return false;
  }

  if (expectedFlagHash) {
    const submittedHash = buildFlagHash(normalizedSubmittedFlag);
    return timingSafeEqualStrings(submittedHash, String(expectedFlagHash || "").trim().toLowerCase());
  }

  const resolvedExpectedFlag = expectedFlag
    ? String(expectedFlag).trim()
    : buildFlag({
        challengeId,
        challengeSlug,
        sessionId,
        instanceId
      });

  return timingSafeEqualStrings(normalizedSubmittedFlag, resolvedExpectedFlag);
}

module.exports = {
  ENABLE_DYNAMIC_FLAGS_ENV_KEY,
  isDynamicFlagsEnabled,
  buildFlag,
  buildFlagHash,
  verifySubmittedFlag
};
