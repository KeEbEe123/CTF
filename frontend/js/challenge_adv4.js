"use strict";

const API_BASE = "/api/advanced/siem";
const AUTH_API = "/api/auth";

let rawAlerts = null;
let rawLogs = null;
let currentTab = null;

function el(id) { return document.getElementById(id); }

function setInteractable(enabled) {
    const sBtn = el("loadSiemBtn");
    const sFltr = el("severityFilter");
    const ipFltr = el("ipFilter");
    const lSearch = el("logSearch");
    const fIn = el("flagInput");
    const fBtn = el("flagSubmitBtn");

    if (enabled) {
        if (sBtn) sBtn.disabled = false;
        if (sFltr) sFltr.disabled = false;
        if (ipFltr) ipFltr.disabled = false;
        if (lSearch) lSearch.disabled = false;
        if (fIn) fIn.disabled = false;
        if (fBtn) fBtn.disabled = false;
    } else {
        if (sBtn) sBtn.disabled = true;
        if (sFltr) sFltr.disabled = true;
        if (ipFltr) ipFltr.disabled = true;
        if (lSearch) lSearch.disabled = true;
        if (fIn) fIn.disabled = true;
        if (fBtn) fBtn.disabled = true;
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

            if (data.progress && data.progress.solvedChallenges && data.progress.solvedChallenges.includes("adv-4")) {
                const fIn = el("flagInput");
                const fBtn = el("flagSubmitBtn");
                if (fIn) fIn.disabled = true;
                if (fBtn) {
                    fBtn.disabled = true;
                    fBtn.textContent = "Solved";
                }
            }
        }
    } catch (e) {
        console.error("Identity map failed");
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

            // Allow clicking connection button
            el("loadSiemBtn").disabled = false;
        }
    } catch (e) {
        console.error("Network failure loading explicit SIEM meta");
    }
}

async function bootSiem() {
    el("loadSiemBtn").disabled = true;
    el("loadSiemBtn").textContent = "Establishing Feed...";

    el("alertsContainer").innerHTML = `<div style="padding:1rem;color:#c084fc;">[SYNCING NATIVE METRICS ALERTS...]</div>`;
    el("logsContainer").innerHTML = `<span style="color:#c084fc;">[PULLING BASELINE RAW BUFFERS...]</span>`;

    try {
        const [ar, lr] = await Promise.all([
            fetch(`${API_BASE}/alerts`, { credentials: "include" }),
            fetch(`${API_BASE}/logs`, { credentials: "include" })
        ]);

        if (!ar.ok || !lr.ok) throw new Error("Backend connection actively terminated by gateway.");

        const aData = await ar.json();
        const lData = await lr.json();

        rawAlerts = aData.alerts || [];
        rawLogs = lData.logs || {};

        el("loadSiemBtn").textContent = "Feed Active";
        setInteractable(true); // unlocks filters and flag form

        // Render UI
        renderAlerts();
        renderLogTabs();
    } catch (err) {
        el("alertsContainer").innerHTML = `<div style="padding:1rem;color:#f87171;">[ERROR] ${err.message}</div>`;
        el("logsContainer").textContent = `// FATAL CRASH: ${err.message}`;
        el("loadSiemBtn").disabled = false;
        el("loadSiemBtn").textContent = "Connect to SIEM Feed";
    }
}

function renderAlerts() {
    const container = el("alertsContainer");
    if (!rawAlerts) return;

    const sev = el("severityFilter").value;
    const ip = el("ipFilter").value.trim().toLowerCase();

    let filtered = rawAlerts;
    if (sev !== "ALL") filtered = filtered.filter(a => a.severity === sev);
    if (ip) filtered = filtered.filter(a => a.sourceIP.toLowerCase().includes(ip));

    if (filtered.length === 0) {
        container.innerHTML = `<div style="padding:1rem;color:#64748b;">// 0 correlating vectors mapped.</div>`;
        return;
    }

    let html = "";
    filtered.forEach(a => {
        const t = a.timestamp.replace("T", " ").replace("Z", "");
        html += `<div class="alert-row">
            <span style="color:#94a3b8;width:145px;flex-shrink:0;">${t}</span>
            <span class="sev-${a.severity}">${a.severity}</span>
            <span style="color:#e2e8f0;width:240px;flex-shrink:0;">[${a.ruleName}]</span>
            <span style="color:#38bdf8;width:120px;flex-shrink:0;">SRC: ${a.sourceIP}</span>
            <span style="color:#cbd5e1;flex:1;">${a.description}</span>
        </div>`;
    });

    container.innerHTML = html;
}

function renderLogTabs() {
    const tabsContainer = el("logTabs");
    tabsContainer.innerHTML = "";

    if (!rawLogs) return;

    const files = Object.keys(rawLogs);
    if (files.length > 0 && !currentTab) currentTab = files[0];

    files.forEach(file => {
        const btn = document.createElement("button");
        btn.className = "tab-btn";
        btn.textContent = file;
        btn.onclick = () => {
            currentTab = file;
            updateTabStyles();
            applyLogFilters();
        };
        tabsContainer.appendChild(btn);
    });

    updateTabStyles();
    applyLogFilters();
}

function updateTabStyles() {
    const container = el("logTabs");
    Array.from(container.children).forEach(btn => {
        if (btn.textContent === currentTab) {
            btn.classList.add("tab-active");
        } else {
            btn.classList.remove("tab-active");
        }
    });
}

function applyLogFilters() {
    const term = el("logsContainer");
    const searchEl = el("logSearch");

    if (!rawLogs || !currentTab) return;

    const searchStr = searchEl ? searchEl.value : "";
    const raw = rawLogs[currentTab] || "";

    if (!searchStr) {
        term.textContent = raw;
        return;
    }

    try {
        const regex = new RegExp(searchStr, "i");
        const lines = raw.split("\\n");
        const matches = lines.filter(l => regex.test(l));
        term.textContent = matches.join("\\n") || `// 0 artifacts matched filter '\\${searchStr}' in buffer '${currentTab}'...`;
    } catch (e) {
        const lower = searchStr.toLowerCase();
        const lines = raw.split("\\n");
        const matches = lines.filter(l => l.toLowerCase().includes(lower));
        term.textContent = matches.join("\\n") || `// 0 artifacts matched literal string '\\${searchStr}' in buffer '${currentTab}'...`;
    }
}

async function handleFlagSubmit(e) {
    e.preventDefault();
    const flagE = el("flagInput");
    const flag = flagE.value.trim();
    if (!flag) return;

    const resE = el("flagResult");
    resE.style.display = "block";
    resE.textContent = "Validating extraction path...";
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

            flagE.disabled = true;
            el("flagSubmitBtn").disabled = true;
            el("flagSubmitBtn").textContent = "Neutralized";
        } else {
            resE.textContent = data.message || "Incorrect reconstruction sequence.";
            resE.style.background = "rgba(248, 113, 113, 0.2)";
            resE.style.color = "#f87171";
        }
    } catch (err) {
        console.error("Submission error:", err);
        resE.textContent = "Submission failed. Unable to reach the SIEM verification service.";
        resE.style.background = "rgba(248, 113, 113, 0.2)";
        resE.style.color = "#f87171";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Buttons disabled natively via HTML or setInteractable
    loadIdentity();
    loadDetails();

    el("loadSiemBtn")?.addEventListener("click", bootSiem);
    el("severityFilter")?.addEventListener("change", renderAlerts);
    el("ipFilter")?.addEventListener("input", renderAlerts);
    el("logSearch")?.addEventListener("input", applyLogFilters);
    el("flagForm")?.addEventListener("submit", handleFlagSubmit);
});
