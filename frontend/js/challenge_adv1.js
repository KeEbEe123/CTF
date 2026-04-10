"use strict";

const API_BASE = "/api/advanced/phantom";
const AUTH_API = "/api/auth";

let currentProfileAction = "get-profile";
let submittingFlag = false;

function el(id) {
  return document.getElementById(id);
}

async function readJsonSafe(resp) {
  const rawText = await resp.text();
  if (!rawText) return { data: {}, rawText: "" };
  try {
    return { data: JSON.parse(rawText), rawText };
  } catch {
    return { data: {}, rawText };
  }
}

function setResult(message, ok) {
  const node = el("flagResult");
  if (!node) return;
  node.style.display = "block";
  node.textContent = message;
  node.className = ok ? "result-text result-ok" : "result-text result-bad";
}

function writeOutput(targetId, payload, status) {
  const node = el(targetId);
  if (!node) return;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  node.textContent = `HTTP ${status}\n${body}`;
}

function applyRuntime(runtime) {
  if (!runtime) return;
  if (el("statSolved")) {
    el("statSolved").textContent = runtime.solved ? "Yes" : "No";
  }
  if (el("statAttempts")) {
    el("statAttempts").textContent = String(runtime.attempts || 0);
  }
  if (el("statHints")) {
    el("statHints").textContent = String(runtime.hintsUsed || 0);
  }
}

function getActionMeta(action) {
  switch (action) {
    case "update-profile":
      return {
        method: "POST",
        path: "/user/update",
        defaultBody: '{\n  "name": "Operator",\n  "role": "admin"\n}'
      };
    case "admin-export":
      return {
        method: "POST",
        path: "/admin/export",
        defaultBody: "{}"
      };
    case "get-profile":
    default:
      return {
        method: "GET",
        path: "/user/profile",
        defaultBody: ""
      };
  }
}

function setActiveTab(action) {
  currentProfileAction = action;
  ["tabGetProfile", "tabUpdateProfile", "tabAdminExport"].forEach((id) => {
    const node = el(id);
    if (node) {
      const isActive = node.dataset.action === action;
      node.classList.toggle("active", isActive);
    }
  });

  const bodyInput = el("profilePayload");
  const inputRow = el("profileInputRow");
  const meta = getActionMeta(action);
  if (!bodyInput || !inputRow) return;

  if (meta.method === "GET") {
    inputRow.style.display = "none";
  } else {
    inputRow.style.display = "flex";
    if (!bodyInput.value.trim() || bodyInput.dataset.lastAction !== action) {
      bodyInput.value = meta.defaultBody;
      bodyInput.dataset.lastAction = action;
    }
  }
}

async function fetchIdentity() {
  try {
    const resp = await fetch(`${AUTH_API}/me`, { credentials: "include" });
    if (resp.status === 401) {
      window.location.href = "/";
      return;
    }

    const data = await resp.json();
    if (data.authenticated && data.user) {
      if (el("userIdentity")) {
        el("userIdentity").textContent = `${data.user.name} (${data.user.role})`;
      }
      if (el("loginEmail") && !el("loginEmail").value) {
        el("loginEmail").value = data.user.email || "";
      }
    }
  } catch {
    // no-op
  }
}

async function loadDetails() {
  const resp = await fetch(`${API_BASE}/details`, { credentials: "include" });

  if (resp.status === 401) {
    window.location.href = "/";
    return;
  }

  if (resp.status === 403) {
    const { data } = await readJsonSafe(resp);
    document.body.innerHTML = `
      <main class="adv-shell" style="padding:3rem 1.5rem;max-width:760px;margin:0 auto;text-align:center;">
        <h2 style="color:#f87171;">Advanced Track Access Blocked</h2>
        <p style="color:#94a3b8;">${(data && data.message) || "Start the advanced track from dashboard first."}</p>
        <a href="/" class="btn" style="margin-top:1rem;display:inline-block;">Back to Dashboard</a>
      </main>`;
    return;
  }

  const payload = await resp.json();
  if (!payload.success) return;

  const challenge = payload.challenge || {};
  if (el("challengeTitle")) el("challengeTitle").textContent = challenge.title || "Phantom Execution";
  if (el("challengeDescription")) el("challengeDescription").textContent = challenge.description || "";
  if (el("challengeStory")) el("challengeStory").textContent = challenge.story || "";
  if (el("challengeObjective")) el("challengeObjective").textContent = challenge.objective || "";
  if (el("pointsBadge")) {
    const parsedPoints = Number(challenge.points);
    el("pointsBadge").textContent = Number.isFinite(parsedPoints) ? `${parsedPoints} pts` : "-- pts";
  }

  applyRuntime(payload.runtime || {});

  if (payload.runtime && payload.runtime.solved) {
    setResult("Challenge already solved.", true);
    if (el("flagSubmitBtn")) el("flagSubmitBtn").disabled = true;
  }
}

async function handlePortalLogin() {
  const email = (el("loginEmail") && el("loginEmail").value.trim()) || "";
  const password = (el("loginPassword") && el("loginPassword").value.trim()) || "";

  const resp = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const { data, rawText } = await readJsonSafe(resp);
  writeOutput("loginOutput", data.message ? data : rawText || "Login response", resp.status);
  await loadDetails();
}

async function handleProfileAction() {
  const meta = getActionMeta(currentProfileAction);
  let body;

  if (meta.method !== "GET") {
    const payloadText = (el("profilePayload") && el("profilePayload").value.trim()) || "{}";
    try {
      body = JSON.parse(payloadText);
    } catch {
      writeOutput("profileOutput", { success: false, message: "Invalid JSON body." }, 400);
      return;
    }
  }

  const resp = await fetch(`${API_BASE}${meta.path}`, {
    method: meta.method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const { data, rawText } = await readJsonSafe(resp);
  const payload = data && Object.keys(data).length ? data : rawText || "No content";
  writeOutput("profileOutput", payload, resp.status);

  if (data && data.auditToken && el("flagInput")) {
    el("flagInput").value = data.auditToken;
    setResult("Audit token captured from admin export. Submit it as flag.", true);
  }

  await loadDetails();
}

async function submitFlag() {
  if (submittingFlag) return;

  const flagInput = el("flagInput");
  const flag = flagInput ? flagInput.value.trim() : "";
  if (!flag) {
    setResult("Please enter a flag.", false);
    return;
  }

  submittingFlag = true;
  if (el("flagSubmitBtn")) {
    el("flagSubmitBtn").disabled = true;
    el("flagSubmitBtn").textContent = "SUBMITTING...";
  }

  try {
    const resp = await fetch(`${API_BASE}/submit`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag })
    });

    const { data, rawText } = await readJsonSafe(resp);
    if (resp.ok && data.success && data.correct) {
      setResult(data.message || "Correct flag.", true);
    } else {
      const msg = (data && data.message) || rawText || "Submission failed.";
      setResult(msg, false);
    }

    await loadDetails();
  } finally {
    submittingFlag = false;
    if (el("flagSubmitBtn")) {
      el("flagSubmitBtn").disabled = false;
      el("flagSubmitBtn").textContent = "SUBMIT";
    }
  }
}

function bindEvents() {
  const logoutBtn = el("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch(`${AUTH_API}/logout`, { method: "POST", credentials: "include" });
      } finally {
        window.location.href = "/";
      }
    });
  }

  const loginBtn = el("loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", handlePortalLogin);

  const sendBtn = el("profileSendBtn");
  if (sendBtn) sendBtn.addEventListener("click", handleProfileAction);

  ["tabGetProfile", "tabUpdateProfile", "tabAdminExport"].forEach((id) => {
    const node = el(id);
    if (node) {
      node.addEventListener("click", () => setActiveTab(node.dataset.action));
    }
  });

  if (el("flagSubmitBtn")) {
    el("flagSubmitBtn").addEventListener("click", submitFlag);
  }

  if (el("flagInput")) {
    el("flagInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitFlag();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  setActiveTab("get-profile");
  await fetchIdentity();
  await loadDetails();
});
