const challengeCatalog = [
  { id: 1, api: "/api/challenge1", page: "/pages/challenge1.html", category: "Networking" },
  { id: 2, api: "/api/challenge2", page: "/pages/challenge2.html", category: "Web" },
  { id: 3, api: "/api/challenge3", page: "/pages/challenge3.html", category: "Linux" },
  { id: 4, api: "/api/challenge4", page: "/pages/challenge4.html", category: "Ethical Hacking" }
];

const AUTH_API = "/api/auth";

function setDashboardMessage(message, success) {
  const node = document.getElementById("dashboardMessage");
  node.textContent = message;
  node.classList.remove("result-ok", "result-bad");
  if (message) {
    node.classList.add(success ? "result-ok" : "result-bad");
  }
}

function statusBadge(solved) {
  const statusClass = solved ? "status-solved" : "status-unsolved";
  const statusText = solved ? "Solved" : "Unsolved";
  return `<span class="status-pill ${statusClass}">${statusText}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function difficultyClass(difficulty) {
  const text = String(difficulty || "").toLowerCase();
  if (text.includes("beginner") || text.includes("easy")) {
    return "chip-easy";
  }
  if (text.includes("medium") || text.includes("intermediate")) {
    return "chip-medium";
  }
  if (text.includes("hard")) {
    return "chip-hard";
  }
  return "chip-neutral";
}

function categoryClass(category) {
  const text = String(category || "").toLowerCase();
  if (text.includes("network")) {
    return "category-networking";
  }
  if (text.includes("web")) {
    return "category-web";
  }
  if (text.includes("linux")) {
    return "category-linux";
  }
  if (text.includes("ethical") || text.includes("kali")) {
    return "category-ethical";
  }
  return "category-generic";
}

function categoryIcon(category) {
  const text = String(category || "").toLowerCase();
  if (text.includes("network")) {
    return "NW";
  }
  if (text.includes("web")) {
    return "WEB";
  }
  if (text.includes("linux")) {
    return "LNX";
  }
  if (text.includes("ethical") || text.includes("kali")) {
    return "KALI";
  }
  return "CTF";
}

function renderAuthState(authenticated, user) {
  const greeting = document.getElementById("authGreeting");
  const loginLink = document.getElementById("loginLink");
  const registerLink = document.getElementById("registerLink");
  const scoreboardLink = document.getElementById("scoreboardLink");
  const adminLink = document.getElementById("adminLink");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!authenticated || !user) {
    greeting.textContent = "Guest mode";
    loginLink.classList.remove("hidden");
    registerLink.classList.remove("hidden");
    scoreboardLink.classList.add("hidden");
    adminLink.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    return;
  }

  greeting.textContent = `${user.name} (${user.role})`;
  loginLink.classList.add("hidden");
  registerLink.classList.add("hidden");
  scoreboardLink.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");

  if (user.role === "instructor" || user.role === "admin") {
    adminLink.classList.remove("hidden");
  } else {
    adminLink.classList.add("hidden");
  }
}

function renderRows(items) {
  const rows = document.getElementById("challengeRows");
  rows.innerHTML = "";

  items.forEach((item) => {
    if (!item.success) {
      const card = document.createElement("article");
      card.className = "challenge-card challenge-card-disabled";
      card.innerHTML = `
        <div class="challenge-card-head">
          <div class="challenge-card-head-left">
            <span class="challenge-icon">ERR</span>
            <p class="challenge-category">Challenge ${item.id}</p>
          </div>
          <span class="status-pill status-locked">Unavailable</span>
        </div>
        <h3>Service Temporarily Unavailable</h3>
        <p class="meta-label">Challenge data could not be loaded right now.</p>
        <div class="card-chip-row">
          <span class="card-chip chip-neutral">Unavailable</span>
        </div>
        <div class="card-meta">Please open the challenge page directly.</div>
        <div class="card-actions">
          <a class="btn btn-secondary" href="${item.page}">Open Page</a>
        </div>
      `;
      rows.appendChild(card);
      return;
    }

    const challenge = item.payload.challenge || {};
    const state = item.payload.sessionState || {};
    const solved = Boolean(state.solved);
    const earned = Number(state.pointsAwarded || 0);
    const points = Number(challenge.points || 0);
    const attempts = Number(state.attempts?.total || 0);
    const hintsUsed = Number(state.hintsUsed || 0);
    const actionLabel = solved ? "Review Challenge" : "Start Challenge";
    const difficulty = challenge.difficulty || "Unknown";
    const category = challenge.category || "General";
    const card = document.createElement("article");
    card.className = `challenge-card ${categoryClass(category)} ${solved ? "challenge-card-solved" : ""}`.trim();
    card.innerHTML = `
      <div class="challenge-card-head">
        <div class="challenge-card-head-left">
          <span class="challenge-icon">${categoryIcon(category)}</span>
          <p class="challenge-category">${escapeHtml(category)}</p>
        </div>
        ${statusBadge(solved)}
      </div>
      <h3>${escapeHtml(challenge.title || `Challenge ${item.id}`)}</h3>
      <div class="card-chip-row">
        <span class="card-chip ${difficultyClass(difficulty)}">${escapeHtml(difficulty)}</span>
        <span class="card-chip chip-neutral">Points ${points}</span>
        <span class="card-chip chip-neutral">Earned ${earned}</span>
      </div>
      <div class="card-meta">Attempts: ${attempts} | Hints used: ${hintsUsed}</div>
      <div class="card-actions">
        <a class="btn ${solved ? "btn-secondary" : ""}" href="${item.page}">${actionLabel}</a>
      </div>
    `;
    rows.appendChild(card);
  });
}

function renderLoggedOutState() {
  document.getElementById("summarySolved").textContent = "0 / 8";
  document.getElementById("summaryScore").textContent = "0";
  document.getElementById("summaryMaxScore").textContent = "2400";

  const rows = document.getElementById("challengeRows");
  rows.innerHTML = "";
  challengeCatalog.forEach((challenge) => {
    const card = document.createElement("article");
    card.className = `challenge-card challenge-card-locked ${categoryClass(challenge.category)}`.trim();
    card.innerHTML = `
      <div class="challenge-card-head">
        <div class="challenge-card-head-left">
          <span class="challenge-icon">${categoryIcon(challenge.category)}</span>
          <p class="challenge-category">${escapeHtml(challenge.category)}</p>
        </div>
        <span class="status-pill status-locked">Locked</span>
      </div>
      <h3>Login Required</h3>
      <p class="meta-label">Sign in to track progress, score, attempts, and hint usage.</p>
      <div class="card-chip-row">
        <span class="card-chip chip-neutral">Progress Locked</span>
      </div>
      <div class="card-actions">
        <a class="btn" href="/pages/login.html?redirect=${encodeURIComponent(challenge.page)}">Login to Start</a>
      </div>
    `;
    rows.appendChild(card);
  });
}

async function renderSummary() {
  try {
    const response = await fetch("/api/tracks/summary", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.success) {
      document.getElementById("summarySolved").textContent = `${data.solvedCount} / ${data.totalChallenges}`;
      document.getElementById("summaryScore").textContent = String(data.totalScore);
      document.getElementById("summaryMaxScore").textContent = String(data.maxScore);
    }
  } catch (e) {
    console.error("Failed to load dashboard summary metrics.");
  }
}

async function fetchCurrentUser() {
  try {
    const response = await fetch(`${AUTH_API}/me`, { credentials: "include" });
    if (!response.ok) {
      return { authenticated: false };
    }
    return await response.json();
  } catch (error) {
    return { authenticated: false };
  }
}

async function logout() {
  hideAdvancedTrackForGuest();
  try {
    await fetch(`${AUTH_API}/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch (error) {
    // Ignore network errors and still refresh UI state.
  }
  window.location.replace('/');
}

async function loadDashboard() {
  setDashboardMessage("", true);
  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn.disabled = true;

  try {
    const me = await fetchCurrentUser();
    dashboardAuthenticated = Boolean(me.authenticated);
    renderAuthState(dashboardAuthenticated, me.user);

    if (!dashboardAuthenticated) {
      hideAdvancedTrackForGuest();
      renderLoggedOutState();
      setDashboardMessage("Login to track your progress and continue challenges.", false);
      return false;
    }

    const section = document.getElementById("advancedTrackSection");
    if (section) {
      section.style.display = "";
    }

    const fetches = challengeCatalog.map(async (item) => {
      try {
        const response = await fetch(item.api, { credentials: "include" });
        if (response.status === 401) {
          return {
            id: item.id,
            page: item.page,
            success: false,
            unauthorized: true
          };
        }
        const payload = await response.json();
        return {
          id: item.id,
          page: item.page,
          success: Boolean(payload.success),
          payload
        };
      } catch (error) {
        return {
          id: item.id,
          page: item.page,
          success: false
        };
      }
    });

    const results = await Promise.all(fetches);
    if (results.some((item) => item.unauthorized)) {
      dashboardAuthenticated = false;
      hideAdvancedTrackForGuest();
      renderLoggedOutState();
      renderAuthState(false, null);
      setDashboardMessage("Your session expired. Please login again.", false);
      return false;
    }

    renderRows(results);
    await renderSummary();

    const unavailableCount = results.filter((item) => !item.success).length;
    if (unavailableCount > 0) {
      setDashboardMessage(`${unavailableCount} challenge API endpoints are currently unavailable.`, false);
    }
    return true;
  } catch (error) {
    setDashboardMessage("Unable to load dashboard right now.", false);
    return false;
  } finally {
    refreshBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Advanced Track UI
// ---------------------------------------------------------------------------

const ADVANCED_TRACK_API = "/api/tracks/advanced";
let advancedCountdownInterval = null;
let advancedPollInterval = null;
let advancedRemainingSeconds = 0;
let dashboardAuthenticated = false;

function formatCountdown(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stopAdvancedCountdown() {
  if (advancedCountdownInterval) {
    clearInterval(advancedCountdownInterval);
    advancedCountdownInterval = null;
  }
}

function stopAdvancedPoll() {
  if (advancedPollInterval) {
    clearInterval(advancedPollInterval);
    advancedPollInterval = null;
  }
}

function hideAdvancedTrackForGuest() {
  stopAdvancedCountdown();
  stopAdvancedPoll();

  const section = document.getElementById("advancedTrackSection");
  if (section) {
    section.style.display = "none";
  }

  const kpiCard = document.getElementById("advancedKpiCard");
  if (kpiCard) {
    kpiCard.style.display = "none";
  }
}

function startAdvancedCountdown(initialSeconds, onExpire) {
  stopAdvancedCountdown();
  advancedRemainingSeconds = initialSeconds;

  advancedCountdownInterval = setInterval(() => {
    advancedRemainingSeconds -= 1;
    const timerEl = document.getElementById("advancedCountdownDisplay");
    if (timerEl) {
      timerEl.textContent = formatCountdown(advancedRemainingSeconds);
      // Dynamically apply warning class once under 30 minutes
      if (advancedRemainingSeconds < 1800) {
        timerEl.classList.add("timer-warning");
      } else {
        timerEl.classList.remove("timer-warning");
      }
    }
    if (advancedRemainingSeconds <= 0) {
      stopAdvancedCountdown();
      if (typeof onExpire === "function") {
        onExpire();
      }
    }
  }, 1000);
}


function renderAdvancedTrack(trackState, onStart) {
  const container = document.getElementById("advancedTrackInner");
  if (!container) {
    return;
  }

  const { status, remainingSeconds, startedAt, expiresAt, completedAt, attemptCount } = trackState;

  stopAdvancedCountdown();

  const badge = (text, cls) =>
    `<span class="status-pill ${cls}">${escapeHtml(text)}</span>`;

  if (status === "locked") {
    container.innerHTML = `
      <div class="advanced-track-header">
        <div>
          <h2 class="advanced-track-title">&#128274; Advanced Track</h2>
          <p class="meta-label">Complete all beginner challenges to unlock the Advanced Track.</p>
        </div>
        ${badge("Locked", "status-locked")}
      </div>
    `;
    return;
  }

  if (status === "available") {
    container.innerHTML = `
      <div class="advanced-track-header">
        <div>
          <h2 class="advanced-track-title">&#128275; Advanced Track Unlocked</h2>
          <p class="meta-label">You have completed all beginner challenges. You may now start the Advanced Track.</p>
        </div>
        ${badge("Available", "status-available")}
      </div>
      <div class="advanced-track-body">
        <div class="advanced-track-warning">
          <strong>&#9201; Timed Attempt Warning:</strong> Starting this track begins a strict <strong>4-hour countdown</strong>.
          Once started, you must complete all advanced challenges within the window.
          The timer cannot be paused. Only an instructor can reset your attempt.
        </div>
        <button id="startAdvancedBtn" class="btn advanced-start-btn" type="button">
          Start Advanced Track
        </button>
        ${attemptCount > 0 ? `<p class="meta-label">Previous attempts: ${Number(attemptCount)}</p>` : ""}
      </div>
    `;
    const btn = document.getElementById("startAdvancedBtn");
    if (btn) {
      btn.addEventListener("click", onStart);
    }
    return;
  }

  if (status === "active") {
    const initial = typeof remainingSeconds === "number" ? remainingSeconds : 0;
    container.innerHTML = `
      <div class="advanced-track-header">
        <div>
          <h2 class="advanced-track-title">&#9654;&#65039; Advanced Track Active</h2>
          <p class="meta-label">Your 4-hour window is running. Complete advanced challenges before time expires.</p>
        </div>
        ${badge("Active", "status-active")}
      </div>
      <div class="advanced-track-body">
        <div class="advanced-track-timer">
          <span class="timer-label">Time Remaining</span>
          <span id="advancedCountdownDisplay" class="timer-display ${initial < 1800 ? "timer-warning" : ""}">${formatCountdown(initial)}</span>
        </div>
        <div class="advanced-track-meta">
          <span>Started: ${startedAt ? new Date(startedAt).toLocaleString() : "—"}</span>
          <span>Expires: ${expiresAt ? new Date(expiresAt).toLocaleString() : "—"}</span>
        </div>
        
        <div class="advanced-challenge-list" style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap;">
          <a href="/pages/challenge_adv1.html" class="btn" style="flex: 1; text-align: center;">Advanced Challenge: Phantom Execution</a>
          <a href="/pages/challenge_adv2.html" class="btn btn-secondary" style="flex: 1; text-align: center;">Advanced Challenge: Protocol Collapse</a>
          <a href="/pages/challenge_adv3.html" class="btn" style="flex: 1; text-align: center; border: 1px solid #c084fc; color: #c084fc; background: rgba(192, 132, 252, 0.1);">Advanced Challenge: Ghost Logs</a>
          <a href="/pages/challenge_adv4.html" class="btn" style="flex: 1; text-align: center; border: 1px solid #f87171; color: #f87171; background: rgba(248, 113, 113, 0.05);">Advanced Challenge: Signal vs Noise</a>
        </div>
      </div>
    `;
    startAdvancedCountdown(initial, () => {
      // After local countdown hits 0, re-poll server to get authoritative expired state
      fetchAndRenderAdvancedTrack();
    });
    return;
  }

  if (status === "expired") {
    container.innerHTML = `
      <div class="advanced-track-header">
        <div>
          <h2 class="advanced-track-title">&#10060; Advanced Track Expired</h2>
          <p class="meta-label">Your 4-hour attempt window has expired. Advanced submissions are now locked.</p>
        </div>
        ${badge("Expired", "status-expired")}
      </div>
      <div class="advanced-track-body">
        <p class="meta-label">An instructor or admin must reset your attempt before you can try again.</p>
        ${attemptCount > 0 ? `<p class="meta-label">Attempts used: ${Number(attemptCount)}</p>` : ""}
      </div>
    `;
    return;
  }

  if (status === "completed") {
    container.innerHTML = `
      <div class="advanced-track-header">
        <div>
          <h2 class="advanced-track-title">&#127942; Advanced Track Completed</h2>
          <p class="meta-label">You completed the Advanced Track successfully${completedAt ? " on " + new Date(completedAt).toLocaleString() : ""}.</p>
        </div>
        ${badge("Completed", "status-solved")}
      </div>
    `;
    return;
  }

  // Fallback
  container.innerHTML = `<p class="meta-label">Advanced Track status is unavailable.</p>`;
}

async function fetchAndRenderAdvancedTrack() {
  if (!dashboardAuthenticated) {
    hideAdvancedTrackForGuest();
    return;
  }

  try {
    const response = await fetch(`${ADVANCED_TRACK_API}/status?_=${Date.now()}`, { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      // Not authenticated or server error — hide the section gracefully
      const section = document.getElementById("advancedTrackSection");
      if (section) {
        section.style.display = "none";
      }
      return;
    }

    const payload = await response.json();
    if (!payload.success) {
      return;
    }

    const section = document.getElementById("advancedTrackSection");
    if (section) {
      section.style.display = "";
    }

    renderAdvancedTrack(payload, handleStartAdvancedTrack);
  } catch (error) {
    // Network failure — silently skip advanced track UI
  }
}

async function handleStartAdvancedTrack() {
  const btn = document.getElementById("startAdvancedBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }

  try {
    const response = await fetch(`${ADVANCED_TRACK_API}/start`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setDashboardMessage(payload.message || "Could not start Advanced Track.", false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start Advanced Track";
      }
      return;
    }

    // Immediately render active state with the data from the start response
    renderAdvancedTrack(
      {
        status: "active",
        remainingSeconds: payload.remainingSeconds,
        startedAt: payload.startedAt,
        expiresAt: payload.expiresAt,
        completedAt: null,
        attemptCount: 0
      },
      handleStartAdvancedTrack
    );

    // Begin polling every 30 seconds
    startAdvancedPolling();
  } catch (error) {
    setDashboardMessage("Network error starting Advanced Track.", false);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start Advanced Track";
    }
  }
}

function startAdvancedPolling() {
  if (!dashboardAuthenticated) {
    stopAdvancedPoll();
    return;
  }

  stopAdvancedPoll();
  advancedPollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${ADVANCED_TRACK_API}/status?_=${Date.now()}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (payload.success) {
        // Re-sync remaining seconds from server, preserving smooth local tick
        if (payload.status === "active" && typeof payload.remainingSeconds === "number") {
          advancedRemainingSeconds = payload.remainingSeconds;
        }
        // If status changed (e.g., expired), re-render
        const timerEl = document.getElementById("advancedCountdownDisplay");
        if (!timerEl || payload.status !== "active") {
          renderAdvancedTrack(payload, handleStartAdvancedTrack);
        }
      }
    } catch (error) {
      // Ignore poll errors
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Original dashboard event wiring (updated to include advanced track)
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("refreshBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget || e.target;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = 'Syncing <span class="spinner"></span>';
    btn.disabled = true;
    try {
      const isAuthenticated = await loadDashboard();
      if (isAuthenticated) {
        await fetchAndRenderAdvancedTrack();
        startAdvancedPolling();
      }
    } finally {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  });
  const isAuthenticated = await loadDashboard();
  if (isAuthenticated) {
    await fetchAndRenderAdvancedTrack();
    startAdvancedPolling();
  }
});
