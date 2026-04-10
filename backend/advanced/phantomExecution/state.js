/**
 * backend/advanced/phantomExecution/state.js
 *
 * Per-user runtime state for Phantom Execution (adv-1).
 *
 * Each user's challenge state is stored in:
 *   database/adv1_phantom_state.json
 *
 * State schema (per-user record):
 * {
 *   userId         {number}   - platform user ID
 *   initialized    {boolean}  - true after first /init or /portal call
 *   startedAtMs    {number}   - epoch ms of first interaction
 *   solved         {boolean}  - true once correct flag submitted
 *   solvedAtMs     {number|null}
 *   attempts       {number}   - total flag submission attempts
 *   sessionToken   {string|null}  - active portal session token (set in Part 2)
 *   sessionRole    {string}   - "readonly" | "elevated" | null
 *   profileUpdatedAt {string|null}  - ISO timestamp of last profile update
 *   exportUnlocked {boolean}  - whether the export flow has been triggered
 *   updatedAt      {string}   - ISO timestamp of last state write
 * }
 */

"use strict";

const path = require("path");
const { ensureJsonFile, readJsonFile, writeJsonFileAtomic, deepClone } =
    require("../../lib/jsonFileStore");

const STATE_PATH = path.resolve(__dirname, "../../../database/adv1_phantom_state.json");
const DEFAULT_DATA = { version: 1, records: [] };

const DEFAULT_RECORD = {
    initialized: false,
    startedAtMs: null,
    solved: false,
    solvedAtMs: null,
    attempts: 0,
    sessionToken: null,
    sessionRole: null,
    profileUpdatedAt: null,
    exportUnlocked: false,
    updatedAt: null
};

// ─── Internal helpers ───────────────────────────────────────────────────────

function readStore() {
    const data = readJsonFile(STATE_PATH, DEFAULT_DATA);
    if (!Array.isArray(data.records)) data.records = [];
    return data;
}

function writeStore(data) {
    writeJsonFileAtomic(STATE_PATH, data);
}

// ─── Public API ─────────────────────────────────────────────────────────────

function initializePhantomStateStore() {
    ensureJsonFile(STATE_PATH, DEFAULT_DATA);
}

/**
 * Retrieve a user's challenge record. Returns null if none exists yet.
 */
function getRecord(userId) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 1) return null;
    const store = readStore();
    const record = store.records.find((r) => Number(r.userId) === id);
    return record ? deepClone(record) : null;
}

/**
 * Get existing record or create a fresh default one.
 */
function getOrInitRecord(userId) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 1) throw new Error("Invalid userId");
    const existing = getRecord(id);
    if (existing) return existing;

    const now = new Date().toISOString();
    const record = {
        userId: id,
        ...DEFAULT_RECORD,
        startedAtMs: Date.now(),
        initialized: true,
        updatedAt: now
    };
    const store = readStore();
    store.records.push(record);
    writeStore(store);
    return deepClone(record);
}

/**
 * Upsert fields for a user's record. Merges provided fields with existing.
 */
function setRecord(userId, fields) {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 1) throw new Error("Invalid userId");

    const store = readStore();
    const idx = store.records.findIndex((r) => Number(r.userId) === id);
    const now = new Date().toISOString();

    if (idx === -1) {
        const record = { userId: id, ...DEFAULT_RECORD, ...fields, updatedAt: now };
        store.records.push(record);
        writeStore(store);
        return deepClone(record);
    }

    store.records[idx] = { ...store.records[idx], ...fields, userId: id, updatedAt: now };
    writeStore(store);
    return deepClone(store.records[idx]);
}

/**
 * List all records — used by admin/instructor reporting in later parts.
 */
function listAllRecords() {
    return readStore()
        .records
        .filter((r) => Number.isFinite(Number(r.userId)) && Number(r.userId) > 0)
        .map((r) => deepClone(r))
        .sort((a, b) => Number(a.userId) - Number(b.userId));
}

module.exports = {
    STATE_PATH,
    initializePhantomStateStore,
    getRecord,
    getOrInitRecord,
    setRecord,
    listAllRecords
};
