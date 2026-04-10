"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { deepClone } = require("../../lib/jsonFileStore");

const DB_PATH = path.resolve(__dirname, "../../../database/adv2_protocol_state.json");

function normalizeUserId(userId) {
    const parsed = Number(userId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSessionScopeId(sessionScopeId) {
    const normalized = String(sessionScopeId || "").trim();
    return normalized || null;
}

function buildScopeKey(userId, sessionScopeId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
        return null;
    }

    const normalizedScopeId = normalizeSessionScopeId(sessionScopeId);
    return normalizedScopeId ? `${normalizedUserId}::${normalizedScopeId}` : String(normalizedUserId);
}

function readStore() {
    if (!fs.existsSync(DB_PATH)) return { sessions: {} };
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    } catch {
        return { sessions: {} };
    }
}

function writeStore(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function initializeProtocolStore() {
    if (!fs.existsSync(DB_PATH)) {
        writeStore({ sessions: {} });
    }
}

function getSessionState(userId, sessionScopeId = null) {
    const scopeKey = buildScopeKey(userId, sessionScopeId);
    if (!scopeKey) return null;

    const store = readStore();
    const record = store.sessions[scopeKey];
    return record ? deepClone(record) : null;
}

function createOrResetSession(userId, sessionScopeId = null) {
    const normalizedUserId = normalizeUserId(userId);
    const scopeKey = buildScopeKey(userId, sessionScopeId);
    if (!normalizedUserId || !scopeKey) return null;

    const store = readStore();
    const sessionId = crypto.randomBytes(8).toString("hex");
    const nonce = crypto.randomBytes(4).toString("hex");
    const normalizedScopeId = normalizeSessionScopeId(sessionScopeId);

    store.sessions[scopeKey] = {
        userId: normalizedUserId,
        sessionScopeId: normalizedScopeId,
        sessionId,
        nonce,
        protocolState: "INIT",
        exploitEvidenceCaptured: false,
        lastProtocolHint: null,
        messageHistory: [],
        lastActivityTime: new Date().toISOString()
    };

    writeStore(store);
    return deepClone(store.sessions[scopeKey]);
}

function updateSessionState(userId, updates, sessionScopeId = null) {
    const scopeKey = buildScopeKey(userId, sessionScopeId);
    if (!scopeKey) return null;

    const store = readStore();
    if (!store.sessions[scopeKey]) return null;

    store.sessions[scopeKey] = {
        ...store.sessions[scopeKey],
        ...updates,
        lastActivityTime: new Date().toISOString()
    };

    writeStore(store);
    return deepClone(store.sessions[scopeKey]);
}

function logMessageHistory(userId, direction, content, sessionScopeId = null) {
    const scopeKey = buildScopeKey(userId, sessionScopeId);
    if (!scopeKey) return;

    const store = readStore();
    if (!store.sessions[scopeKey]) return;

    store.sessions[scopeKey].messageHistory.push({
        direction,
        content,
        timestamp: new Date().toISOString()
    });

    store.sessions[scopeKey].lastActivityTime = new Date().toISOString();
    writeStore(store);
}

module.exports = {
    initializeProtocolStore,
    getSessionState,
    createOrResetSession,
    updateSessionState,
    logMessageHistory
};
