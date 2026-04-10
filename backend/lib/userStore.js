const path = require("path");
const bcrypt = require("bcryptjs");
const { deepClone, ensureJsonFile, readJsonFile, writeJsonFileAtomic } = require("./jsonFileStore");

const usersFilePath = path.resolve(__dirname, "../../database/users.json");
const defaultData = {
  version: 1,
  nextUserId: 1,
  users: []
};
const allowedRoles = new Set(["student", "instructor", "admin"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function readStore() {
  const data = readJsonFile(usersFilePath, defaultData);
  if (!Array.isArray(data.users)) {
    data.users = [];
  }
  if (!Number.isInteger(data.nextUserId) || data.nextUserId < 1) {
    const maxId = data.users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0);
    data.nextUserId = maxId + 1;
  }
  return data;
}

function writeStore(data) {
  writeJsonFileAtomic(usersFilePath, data);
}

function sanitizeUser(user) {
  return {
    id: Number(user.id),
    name: String(user.name || ""),
    email: String(user.email || ""),
    role: String(user.role || "student"),
    createdAt: String(user.createdAt || ""),
    lastLoginAt: user.lastLoginAt || null
  };
}

function getPublicProfileById(userId) {
  const user = findUserById(userId);
  if (!user) {
    return null;
  }
  return sanitizeUser(user);
}

function getPublicProfiles() {
  const store = readStore();
  return store.users.map((user) => sanitizeUser(user));
}

function findUserById(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    return null;
  }

  const store = readStore();
  const user = store.users.find((entry) => Number(entry.id) === numericUserId);
  return user ? deepClone(user) : null;
}

function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const store = readStore();
  const user = store.users.find((entry) => normalizeEmail(entry.email) === normalizedEmail);
  return user ? deepClone(user) : null;
}

function createUser({ name, email, passwordHash, role = "student" }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const normalizedRole = String(role || "student").toLowerCase();

  if (!normalizedEmail || !normalizedName || !passwordHash) {
    throw new Error("Missing required fields for user creation.");
  }

  if (!allowedRoles.has(normalizedRole)) {
    throw new Error("Invalid role.");
  }

  const store = readStore();
  if (store.users.some((entry) => normalizeEmail(entry.email) === normalizedEmail)) {
    throw new Error("User with this email already exists.");
  }

  const nowIso = new Date().toISOString();
  const user = {
    id: store.nextUserId,
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: String(passwordHash),
    role: normalizedRole,
    createdAt: nowIso,
    lastLoginAt: null
  };

  store.users.push(user);
  store.nextUserId += 1;
  writeStore(store);
  return deepClone(user);
}

function updateLastLoginAt(userId) {
  const numericUserId = Number(userId);
  const store = readStore();
  const index = store.users.findIndex((entry) => Number(entry.id) === numericUserId);
  if (index === -1) {
    return null;
  }

  store.users[index].lastLoginAt = new Date().toISOString();
  writeStore(store);
  return deepClone(store.users[index]);
}

function ensureSeedUser(role, emailEnvKey, passwordEnvKey, nameEnvKey, hashRounds) {
  const email = normalizeEmail(process.env[emailEnvKey] || "");
  const password = String(process.env[passwordEnvKey] || "");
  const name = normalizeName(process.env[nameEnvKey] || `${role[0].toUpperCase()}${role.slice(1)} User`);

  if (!email || !password) {
    return false;
  }

  if (findUserByEmail(email)) {
    return false;
  }

  const passwordHash = bcrypt.hashSync(password, hashRounds);
  createUser({
    name,
    email,
    passwordHash,
    role
  });
  return true;
}

function initializeUserStore() {
  ensureJsonFile(usersFilePath, defaultData);
  const roundsRaw = Number(process.env.BCRYPT_ROUNDS || 12);
  const hashRounds = Number.isInteger(roundsRaw) && roundsRaw >= 4 ? roundsRaw : 12;
  ensureSeedUser("admin", "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_NAME", hashRounds);
  ensureSeedUser(
    "instructor",
    "SEED_INSTRUCTOR_EMAIL",
    "SEED_INSTRUCTOR_PASSWORD",
    "SEED_INSTRUCTOR_NAME",
    hashRounds
  );
}

module.exports = {
  usersFilePath,
  normalizeEmail,
  sanitizeUser,
  initializeUserStore,
  findUserById,
  findUserByEmail,
  createUser,
  updateLastLoginAt,
  getPublicProfileById,
  getPublicProfiles
};
