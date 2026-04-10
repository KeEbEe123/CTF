"use strict";

const API_BASE = "/api/advanced/protocol";
const AUTH_API = "/api/auth";

function el(id) { return document.getElementById(id); }

function termLog(msg, color = "#e2e8f0") {
    const term = el("terminal");
    if (!term) return;
    const span = document.createElement("div");
    span.style.color = color;
    span.textContent = msg;
    term.appendChild(span);
    term.scrollTop = term.scrollHeight; // Auto-scroll
}

function renderHistory(historyArray) {
    const container = el("history");
    if (!container) return;
    container.innerHTML = "";

    if (!historyArray || historyArray.length === 0) {
        container.innerHTML = '<div style="text-align:center; margin-top: 1rem;">No RX/TX history yet</div>';
        return;
    }

    // Max 50 shown
    const recent = historyArray.slice(-50);
    recent.forEach(item => {
        const div = document.createElement("div");
        div.style.padding = "0.3rem 0";
        div.style.borderBottom = "1px solid rgba(255,255,255,0.05)";

        const timeStr = new Date(item.timestamp).toLocaleTimeString();
        const isClient = item.direction === "client";
        const prefix = isClient ? "[TX]" : "[RX]";
        const color = isClient ? "#94a3b8" : "#818cf8";

        div.innerHTML = `<span style="color:${color}">${timeStr} ${prefix}</span> <span style="word-break:break-all;">${item.content}</span>`;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

function setInteractable(enabled, state = "Disconnected") {
    const term = el("terminal");
    const input = el("payloadInput");
    const sendBtn = el("sendBtn");
    const connectBtn = el("connectBtn");
    const resetBtn = el("resetBtn");
    const status = el("connectionState");
    const flagInput = el("flagInput");
    const flagBtn = el("flagSubmitBtn");

    if (enabled) {
        term.style.opacity = "1";
        term.style.pointerEvents = "auto";
        input.disabled = false;
        sendBtn.disabled = false;
        connectBtn.style.display = "none";
        resetBtn.style.display = "inline-block";
        status.textContent = `Status: Active [${state}]`;
        status.style.color = "#4ade80";
        if (flagInput) flagInput.disabled = false;
        if (flagBtn) flagBtn.disabled = false;
    } else {
        term.style.opacity = "0.5";
        term.style.pointerEvents = "none";
        input.disabled = true;
        sendBtn.disabled = true;
        connectBtn.style.display = "inline-block";
        resetBtn.style.display = "none";
        status.textContent = `Status: ${state}`;
        status.style.color = "#94a3b8";
    }
}

function getBlockedStateCopy(payload = {}) {
    const status = String(payload.status || "").toLowerCase();
    const code = String(payload.code || "").toUpperCase();
    const serverMessage = payload.message ? String(payload.message) : "";

    if (status === "expired" || code.includes("EXPIRED")) {
        return {
            icon: "EXPIRED",
            title: "Advanced Track Expired",
            message: serverMessage || "Your 4-hour advanced track window has expired. Advanced challenge submissions are locked."
        };
    }

    if (status === "completed" || code.includes("COMPLETED")) {
        return {
            icon: "COMPLETED",
            title: "Advanced Track Completed",
            message: serverMessage || "Your advanced track attempt is already completed. New submissions are not accepted."
        };
    }

    if (
        status === "locked" ||
        status === "available" ||
        code.includes("LOCKED") ||
        code.includes("AVAILABLE")
    ) {
        return {
            icon: "LOCKED",
            title: "Advanced Track Not Active",
            message: serverMessage || "Complete beginner challenges and start the Advanced Track from your dashboard before opening this challenge."
        };
    }

    return {
        icon: "BLOCKED",
        title: "Advanced Challenge Access Blocked",
        message: serverMessage || "You do not currently have access to this advanced challenge."
    };
}

function disableEntireChallenge(payload = {}) {
    const main = document.querySelector(".adv-shell");
    if (!main) return;
    const copy = getBlockedStateCopy(payload);

    main.innerHTML = `
      <section class="adv-panel" style="text-align:center;padding:3rem 1.5rem;max-width:760px;margin:2rem auto;">
        <p style="font-size:2rem;margin:0 0 0.5rem;">${copy.icon}</p>
        <h2 style="color:#f87171;margin-bottom:0.75rem;">${copy.title}</h2>
        <p style="color:#94a3b8;max-width:540px;margin:0 auto;">${copy.message}</p>
        <a href="/" class="btn" style="margin-top:1.5rem;display:inline-block;">← Back to Dashboard</a>
      </section>
    `;
}

async function readJsonSafely(resp) {
    const rawText = await resp.text();
    if (!rawText) return { data: {}, rawText: "" };
    try {
        return { data: JSON.parse(rawText), rawText };
    } catch {
        return { data: {}, rawText };
    }
}

function resolveSubmitErrorMessage(resp, payload, rawText) {
    if (resp.status === 401) {
        return payload.message || "Authentication required. Please log in again.";
    }

    if (resp.status === 403) {
        if (payload.code === "ADVANCED_TRACK_EXPIRED") {
            return payload.message || "Your advanced track window has expired. Submissions are locked.";
        }
        return payload.message || "You are not authorized to submit this challenge.";
    }

    if (resp.status === 400) {
        if (payload.code === "PROTOCOL_SEQUENCE_REQUIRED") {
            return payload.message || "Submission blocked: capture the audit token from the protocol console first.";
        }
        return payload.message || "Invalid submission payload.";
    }

    if (resp.status >= 500) {
        return payload.message || `Server error (HTTP ${resp.status}). Please retry.`;
    }

    if (payload.message) {
        return payload.message;
    }

    if (rawText) {
        return `Submission failed (HTTP ${resp.status}).`;
    }

    return "Submission failed.";
}

async function loadIdentity() {
    try {
        const resp = await fetch(`${AUTH_API}/me`);
        const data = await resp.json();
        if (data.authenticated && data.user) {
            const elId = el("userIdentity");
            if (elId) elId.textContent = `[${data.user.role.toUpperCase()}] ${data.user.email}`;

            // Check if already solved 
            if (data.progress && data.progress.solvedChallenges && data.progress.solvedChallenges.includes("adv-2")) {
                termLog("[SYS] Target already neutralized. Socket locked.", "#f87171");
                el("flagInput").disabled = true;
                el("flagSubmitBtn").disabled = true;
                el("flagSubmitBtn").textContent = "Solved";

                el("payloadInput").disabled = true;
                el("sendBtn").disabled = true;
                el("connectBtn").disabled = true;
                if (el("resetBtn")) el("resetBtn").disabled = true;
                el("connectionState").textContent = "Status: Solved";
            }
        }
    } catch (e) {
        console.error("Identity load failed");
    }
}

async function loadDetails() {
    try {
        const resp = await fetch(`${API_BASE}/details`, { credentials: "include" });
        if (resp.status === 401) { window.location.href = "/"; return; }

        if (resp.status === 403) {
            const { data } = await readJsonSafely(resp);
            disableEntireChallenge(data);
            return;
        }

        const data = await resp.json();
        if (data.success) {
            const c = data.challenge;
            if (el("challengeTitle")) el("challengeTitle").textContent = c.title;
            if (el("challengeDescription")) el("challengeDescription").textContent = c.description;
            if (el("challengeStory")) el("challengeStory").textContent = c.story;
            if (el("pointsBadge")) {
                const parsedPoints = Number(c.points);
                el("pointsBadge").textContent = Number.isFinite(parsedPoints) ? `${parsedPoints} pts` : "-- pts";
            }

            if (data.runtime) {
                if (data.runtime.connected) {
                    setInteractable(true, data.runtime.protocolState);
                } else {
                    setInteractable(false, "Disconnected");
                }

                if (data.runtime.history) {
                    renderHistory(data.runtime.history);
                }
            }
        }
    } catch (e) {
        termLog("[ERR] Network failure loading protocol shell.", "#f87171");
    }
}

async function connectSession() {
    try {
        const resp = await fetch(`${API_BASE}/connect`, { method: "POST", credentials: "include" });
        const data = await resp.json();
        if (data.success) {
            el("terminal").innerHTML = "";
            termLog("[SYS] Socket opened. Synchronizing TCP connection...", "#4ade80");
            termLog(`[SYS] Assigned SID: ${data.sessionId}`);
            termLog(`[SYS] Entropy Nonce: ${data.nonce}`);
            loadDetails();
        } else {
            termLog(`[ERR] ${data.message}`, "#f87171");
        }
    } catch (e) {
        termLog(`[ERR] ${e.message}`, "#f87171");
    }
}

async function resetSession() {
    try {
        const resp = await fetch(`${API_BASE}/reset`, { method: "POST", credentials: "include" });
        const data = await resp.json();
        if (data.success) {
            el("terminal").innerHTML = "";
            termLog("[SYS] RST flag sent. Session flushed and rebuilt.", "#fbbf24");
            termLog(`[SYS] Assigned SID: ${data.sessionId}`);
            termLog(`[SYS] Entropy Nonce: ${data.nonce}`);
            loadDetails();
        } else {
            termLog(`[ERR] ${data.message}`, "#f87171");
        }
    } catch (e) {
        termLog(`[ERR] ${e.message}`, "#f87171");
    }
}

async function sendPayload() {
    const inputEl = el("payloadInput");
    const raw = inputEl.value.trim();
    if (!raw) return;

    inputEl.value = "";
    termLog(`[TX] ${raw}`, "#e2e8f0");

    try {
        const resp = await fetch(`${API_BASE}/send`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ frame: raw })
        });
        const data = await resp.json();

        if (data.success) {
            termLog(`[RX] ${data.response}`, "#e2e8f0");
            loadDetails(); // To refresh dynamic state & history
        } else {
            termLog(`[ERR] ${data.message}`, "#f87171");
        }
    } catch (e) {
        termLog(`[ERR] ${e.message}`, "#f87171");
    }
}

async function handleFlagSubmit(e) {
    e.preventDefault();
    const flagE = el("flagInput");
    const flag = flagE.value.trim();
    if (!flag) return;

    const resE = el("flagResult");
    resE.style.display = "block";
    resE.textContent = "Verifying payload...";
    resE.style.background = "rgba(255, 255, 255, 0.1)";
    resE.style.color = "#e2e8f0";

    try {
        const resp = await fetch(`${API_BASE}/submit`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ flag })
        });
        const { data: parsedData, rawText } = await readJsonSafely(resp);
        const data = (parsedData && typeof parsedData === "object") ? parsedData : {};

        if (!resp.ok || !data.success) {
            resE.textContent = resolveSubmitErrorMessage(resp, data, rawText);
            resE.style.background = "rgba(248, 113, 113, 0.2)";
            resE.style.color = "#f87171";
            return;
        }

        if (data.correct) {
            resE.textContent = data.message;
            resE.style.background = "rgba(74, 222, 128, 0.2)";
            resE.style.color = "#4ade80";

            // Lock out interaction safely
            setInteractable(false, "Solved");
            flagE.disabled = true;
            el("flagSubmitBtn").disabled = true;
            el("flagSubmitBtn").textContent = "Neutralized";
        } else {
            resE.textContent = data.message || "Invalid payload format.";
            resE.style.background = "rgba(248, 113, 113, 0.2)";
            resE.style.color = "#f87171";
        }
    } catch (err) {
        console.error("Submission error:", err);
        resE.textContent = "Submission failed. Unable to reach the verification service.";
        resE.style.background = "rgba(248, 113, 113, 0.2)";
        resE.style.color = "#f87171";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadIdentity();
    loadDetails();

    el("connectBtn")?.addEventListener("click", connectSession);
    el("resetBtn")?.addEventListener("click", resetSession);
    el("sendBtn")?.addEventListener("click", sendPayload);

    el("payloadInput")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendPayload();
    });

    el("flagForm")?.addEventListener("submit", handleFlagSubmit);
});
