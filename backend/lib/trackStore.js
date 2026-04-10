const path = require("path");
const { deepClone, ensureJsonFile, readJsonFile, writeJsonFileAtomic } = require("./jsonFileStore");

const trackFilePath = path.resolve(__dirname, "../../database/advanced_track.json");
const defaultData = {
  version: 1,
  records: []
};

const DEFAULT_TRACK_RECORD = {
  status: "locked",
  startedAt: null,
  expiresAt: null,
  completedAt: null,
  attemptCount: 0,
  lastResetAt: null,
  resetBy: null
};

function readStore() {
  const data = readJsonFile(trackFilePath, defaultData);
  if (!Array.isArray(data.records)) {
    data.records = [];
  }
  return data;
}

function writeStore(data) {
  writeJsonFileAtomic(trackFilePath, data);
}

function initializeTrackStore() {
  ensureJsonFile(trackFilePath, defaultData);
}

function getTrackRecord(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    return null;
  }
  const store = readStore();
  const record = store.records.find((entry) => Number(entry.userId) === numericUserId);
  return record ? deepClone(record) : null;
}

function setTrackRecord(userId, fields) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    throw new Error("Invalid user id for track record.");
  }
  const store = readStore();
  const index = store.records.findIndex((entry) => Number(entry.userId) === numericUserId);
  const updatedAt = new Date().toISOString();

  if (index === -1) {
    const record = {
      userId: numericUserId,
      ...DEFAULT_TRACK_RECORD,
      ...fields,
      updatedAt
    };
    store.records.push(record);
    writeStore(store);
    return deepClone(record);
  }

  store.records[index] = {
    ...store.records[index],
    ...fields,
    userId: numericUserId,
    updatedAt
  };
  writeStore(store);
  return deepClone(store.records[index]);
}

function getOrInitTrackRecord(userId) {
  const existing = getTrackRecord(userId);
  if (existing) {
    return existing;
  }
  return setTrackRecord(userId, { ...DEFAULT_TRACK_RECORD });
}

function listAllTrackRecords() {
  const store = readStore();
  return store.records
    .filter((entry) => Number.isInteger(Number(entry.userId)) && Number(entry.userId) > 0)
    .map((entry) => deepClone(entry))
    .sort((a, b) => Number(a.userId) - Number(b.userId));
}

module.exports = {
  trackFilePath,
  initializeTrackStore,
  getTrackRecord,
  setTrackRecord,
  getOrInitTrackRecord,
  listAllTrackRecords
};
