"use strict";

const API_BASE = "/api/advanced/ghost";
const AUTH_API = "/api/auth";

let currentLogs = null;
let currentTab = null;

function el(id) { return document.getElementById(id); }

function setInteractable(enabled) {
    const downloadBtn = el("downloadBtn");
    const viewerBtn = el("loadViewerBtn");
    const flagInput = el("flagInput");
    const flagBtn = el("flagSubmitBtn");

    if (enabled) {
        if (downloadBtn) downloadBtn.disabled = false;
        if (viewerBtn) viewerBtn.disabled = false;
        if (flagInput) flagInput.disabled = false;
        if (flagBtn) flagBtn.disabled = false;
    } else {
        if (downloadBtn) downloadBtn.disabled = true;
        if (viewerBtn) viewerBtn.disabled = true;
        if (flagInput) flagInput.disabled = true;
        if (flagBtn) flagBtn.disabled = true;
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

            if (data.progress && data.progress.solvedChallenges && data.progress.solvedChallenges.includes("adv-3")) {
                el("flagInput").disabled = true;
                el("flagSubmitBtn").disabled = true;
                el("flagSubmitBtn").textContent = "Solved";
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
            setInteractable(true);
        }
    } catch (e) {
        console.error("Network failure loading explicit ghost meta");
    }
}

function triggerDownload() {
    window.location.href = `${API_BASE}/download`;
}

async function fetchViewerLogs() {
    const term = el("logContent");
    const container = el("viewerContainer");
    container.style.display = "block";
    term.textContent = "Fetching datasets over secure tunnel...";

    el("loadViewerBtn").disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/download`, { credentials: "include" });
        if (!resp.ok) throw new Error(`Dataset retrieval blocked (HTTP ${resp.status}).`);

        currentLogs = await resp.json();
        const files = Object.keys(currentLogs);
        if (files.length > 0 && !currentTab) currentTab = files[0];

        renderTabs();
    } catch (e) {
        term.textContent = "[ERROR] " + e.message;
        el("loadViewerBtn").disabled = false;
    }
}

function renderTabs() {
    const tabsContainer = el("logTabs");
    tabsContainer.innerHTML = "";

    if (!currentLogs) return;

    const files = Object.keys(currentLogs);
    files.forEach(file => {
        const btn = document.createElement("button");
        btn.className = "tab-btn";
        btn.textContent = file;
        btn.onclick = () => {
            currentTab = file;
            updateTabStyles();
            applyFilter();
        };
        tabsContainer.appendChild(btn);
    });

    updateTabStyles();
    applyFilter();
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

function applyFilter() {
    const term = el("logContent");
    const searchEl = el("logSearch");
    if (!searchEl) return;

    const searchStr = searchEl.value;

    if (!currentLogs || !currentTab) return;

    const raw = currentLogs[currentTab] || "";
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
        // Fallback for invalid regex typed by user
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
    setInteractable(false);
    loadIdentity();
    loadDetails();

    el("downloadBtn")?.addEventListener("click", triggerDownload);
    el("loadViewerBtn")?.addEventListener("click", fetchViewerLogs);
    el("logSearch")?.addEventListener("input", applyFilter);
    el("flagForm")?.addEventListener("submit", handleFlagSubmit);
});
