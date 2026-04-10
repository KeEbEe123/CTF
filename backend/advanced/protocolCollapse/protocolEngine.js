"use strict";

const sessionState = require("./sessionState");

const CHALLENGE_ID = "adv-2";
const STATIC_AUDIT_TOKEN = "CTF{protocol_collapse_state_desync}";

function withHint(message, hint) {
    return `${message} | HINT: ${hint}`;
}

function normalizeScopeId(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
}

function normalizeDynamicFlag(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
}

function resolveRuntimeContext(userIdOrContext, inputFrameMaybe) {
    if (userIdOrContext && typeof userIdOrContext === "object" && !Array.isArray(userIdOrContext)) {
        return {
            userId: userIdOrContext.userId,
            inputFrame: userIdOrContext.inputFrame,
            sessionScopeId: normalizeScopeId(userIdOrContext.sessionScopeId),
            dynamicFlag: normalizeDynamicFlag(userIdOrContext.dynamicFlag)
        };
    }

    return {
        userId: userIdOrContext,
        inputFrame: inputFrameMaybe,
        sessionScopeId: null,
        dynamicFlag: null
    };
}

function resolveAuditToken(dynamicFlag) {
    return normalizeDynamicFlag(dynamicFlag) || STATIC_AUDIT_TOKEN;
}

function initSession(userId, options = {}) {
    const sessionScopeId = normalizeScopeId(options.sessionScopeId);
    return sessionState.createOrResetSession(userId, sessionScopeId);
}

function computeChecksum(payload, nonce) {
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
        sum += payload.charCodeAt(i);
    }
    const n = parseInt(nonce.substring(0, 4), 16) || 0;
    return (sum + n) % 65536;
}

function extractFrame(frameStr) {
    // Expected format: LEN:TYPE:SID:PAYLOAD:CHK
    const parts = frameStr.split(":");
    if (parts.length < 5) return null;

    const lenStr = parts[0];
    const type = parts[1];
    const sid = parts[2];
    const chkStr = parts[parts.length - 1];
    // Payload can naturally contain colons, join the middle segments
    const payload = parts.slice(3, parts.length - 1).join(":");

    return { lenStr, type, sid, payload, chkStr };
}

function processMessage(userIdOrContext, inputFrameMaybe) {
    const { userId, inputFrame, sessionScopeId, dynamicFlag } = resolveRuntimeContext(
        userIdOrContext,
        inputFrameMaybe
    );

    if (typeof inputFrame !== "string") {
        return "ERROR: FATAL_ENCODING_ERROR";
    }

    let state = sessionState.getSessionState(userId, sessionScopeId);
    if (!state) {
        state = sessionState.createOrResetSession(userId, sessionScopeId);
    }

    sessionState.logMessageHistory(userId, "client", inputFrame, sessionScopeId);

    const frame = extractFrame(inputFrame);
    if (!frame) {
        const err = withHint("ERROR: MALFORMED_FRAME", "Expected LEN:TYPE:SID:PAYLOAD:CHK");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err;
    }

    if (frame.sid !== state.sessionId) {
        const err = withHint("ERROR: INVALID_SID", "Initialize or reset connection to get the active SID");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err;
    }

    // THE VULNERABILITY (Core State Desync): 
    // State machine updates prematurely based on TYPE before detailed format validations.
    if (frame.type === "HELO" && state.protocolState === "INIT") {
        state.protocolState = "NEGOTIATE";
    } else if (frame.type === "AUTH" && state.protocolState === "NEGOTIATE") {
        // BUG: Premature escalation to AUTH state!
        state.protocolState = "AUTH";
    }

    sessionState.updateSessionState(userId, { protocolState: state.protocolState }, sessionScopeId);

    // Detailed parse validation constraints applied AFTER state transition!
    const expectedLen = parseInt(frame.lenStr, 10);
    if (isNaN(expectedLen) || frame.payload.length !== expectedLen) {
        const err = withHint("ERROR: LEN_MISMATCH_FRAME_DROPPED", "LEN must match PAYLOAD character count");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err; // Drops out, preserving whatever state was set above.
    }

    const expectedChk = computeChecksum(frame.payload, state.nonce);
    const providedChk = parseInt(frame.chkStr, 10);
    if (isNaN(providedChk) || providedChk !== expectedChk) {
        // Decoy 4: Incorrect checksum paths
        const err = withHint(`ERROR: CHK_INVALID expected=${expectedChk}`, "Use INFO to confirm checksum formula");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err; // Drops out, preserving whatever state was set above.
    }

    let reply = "";

    // DECOYS
    // Decoy 1: Fake SQLi parameter inside payload
    if (frame.payload.includes("' OR 1=1") || frame.payload.toUpperCase().includes("UNION SELECT")) {
        const err = withHint("ERROR: WAF_RULE_1900_SQL_INJECTION_DETECTED", "Protocol parser expects framed packets, not SQL input");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err;
    }

    // Decoy 2: Fake debug command
    if (frame.type === "DEBUG") {
        const err = withHint("ERROR: DEBUG_MODE_UNAVAILABLE_IN_PROD", "DEBUG is disabled, use INFO for protocol metadata");
        sessionState.logMessageHistory(userId, "server", err, sessionScopeId);
        return err;
    }

    // Protocol Command Logic
    if (frame.type === "HELO") {
        reply = `ACK_HELO:${state.nonce}`;
    } else if (frame.type === "INFO") {
        reply = "INFO: FMT=LEN:TYPE:SID:PAYLOAD:CHK | CMDS=HELO,INFO,AUTH,PING,ECHO,EXPORT | CHK=(sum(ascii(PAYLOAD))+int(nonce[0:4],16))%65536";
    } else if (frame.type === "AUTH") {
        if (frame.payload.includes("token_seed=")) {
            // Decoy 3: Token seed error
            reply = `ERROR: SEED_EXPIRED`;
        } else if (frame.payload === "SECRET_ADM_TOKEN") {
            state.protocolState = "READY";
            sessionState.updateSessionState(userId, { protocolState: state.protocolState }, sessionScopeId);
            reply = "AUTH_SUCCESS";
        } else {
            reply = withHint("ERROR: INVALID_AUTH_TOKEN", "Observe how state changes before deep validation");
        }
    } else if (frame.type === "PING") {
        reply = "PONG";
    } else if (frame.type === "ECHO") {
        reply = `ECHO:${frame.payload}`;
    } else if (frame.type === "EXPORT") {
        // Vulnerable condition triggers here. If user intentionally errored out 
        // during AUTH (e.g. invalid CHK or LEN), their state is still AUTH!
        if (state.protocolState === "AUTH" || state.protocolState === "READY") {
            reply = `AUDIT_TOKEN=${resolveAuditToken(dynamicFlag)}`;
            sessionState.updateSessionState(userId, {
                exploitEvidenceCaptured: true,
                lastProtocolHint: "AUDIT_TOKEN_EXTRACTED"
            }, sessionScopeId);
        } else {
            reply = withHint("ERROR: PROTOCOL_STATE_UNAUTHORIZED", "Reach AUTH/READY state before EXPORT");
        }
    } else {
        reply = withHint("ERROR: UNKNOWN_CMD", "Valid commands: HELO, INFO, AUTH, PING, ECHO, EXPORT");
    }

    sessionState.logMessageHistory(userId, "server", reply, sessionScopeId);
    return reply;
}

function buildResponse(state, type, payload) {
    const sid = state ? state.sessionId : "0000";
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const len = payloadStr.length;
    let chk = 0;
    if (state && state.nonce) {
        chk = computeChecksum(payloadStr, state.nonce);
    }
    return `${len}:${type}:${sid}:${payloadStr}:${chk}`;
}

function resetSession(userId, options = {}) {
    const sessionScopeId = normalizeScopeId(options.sessionScopeId);
    return sessionState.createOrResetSession(userId, sessionScopeId);
}

module.exports = {
    initSession,
    processMessage,
    buildResponse,
    resetSession,
    CHALLENGE_ID,
    STATIC_AUDIT_TOKEN
};
