const API_BASE = `${window.location.origin}/api/admin`;
const AUTH_API = `${window.location.origin}/api/auth`;
const REFRESH_INTERVAL_MS = 30_000;

let refreshTimer = null;

function withAdminToken(url) {
  return url;
}

function redirectToLogin() {
  const redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/pages/login.html?redirect=${redirect}`;
}

function formatDuration(totalSeconds) {
  const safeSeconds = Number.isFinite(Number(totalSeconds)) ? Math.max(0, Number(totalSeconds)) : 0;
  const seconds = Math.floor(safeSeconds % 60);
  const minutes = Math.floor((safeSeconds / 60) % 60);
  const hours = Math.floor(safeSeconds / 3600);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function setStatusMessage(message, success) {
  const node = document.getElementById("adminStatusMessage");
  node.textContent = message;
  node.classList.remove("result-ok", "result-bad");

  if (message) {
    node.classList.add(success ? "result-ok" : "result-bad");
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  node.textContent = String(value);
}

function appendCell(row, value, options = {}) {
  const cell = document.createElement("td");
  if (options.className) {
    cell.className = options.className;
  }
  if (options.title) {
    cell.title = options.title;
  }
  cell.textContent = String(value ?? "");
  row.appendChild(cell);
}

function renderSummary(summary) {
  setText("totalSolvesValue", summary.totalSolves || 0);
  setText("totalStudentsValue", summary.totalStudents || 0);
  setText("totalHintsValue", summary.totalHintsUsed || 0);
  setText("avgSolveTimeValue", formatDuration(summary.averageSolveTime || 0));
  setText("avgAttemptsValue", Number(summary.averageAttempts || 0).toFixed(2));
  setText("totalCommandsValue", summary.totalCommandCount || 0);
  setText("lastUpdatedValue", `Last updated: ${new Date().toLocaleTimeString()}`);
}

function renderChallengeStats(stats) {
  const tableBody = document.getElementById("challengeStatsRows");
  tableBody.innerHTML = "";

  if (!Array.isArray(stats) || stats.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No challenge statistics available yet.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  stats.forEach((item) => {
    const row = document.createElement("tr");
    appendCell(row, item.title || item.challengeId);
    appendCell(row, Number(item.solves || 0));
    appendCell(row, formatDuration(item.avgSolveTime || 0));
    appendCell(row, Number(item.avgAttempts || 0).toFixed(2));
    appendCell(row, Number(item.commandUsageCount || 0));
    tableBody.appendChild(row);
  });
}

function renderSolvesChart(stats) {
  const chart = document.getElementById("solvesChart");
  chart.innerHTML = "";

  if (!Array.isArray(stats) || stats.length === 0) {
    const note = document.createElement("p");
    note.className = "meta-label";
    note.textContent = "No challenge solve data yet.";
    chart.appendChild(note);
    return;
  }

  const maxSolves = Math.max(...stats.map((item) => Number(item.solves || 0)), 1);

  stats.forEach((item) => {
    const solveCount = Number(item.solves || 0);
    const wrapper = document.createElement("div");
    wrapper.className = "bar-row";

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = `${item.title || item.challengeId} (${solveCount})`;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    const widthPercent = solveCount === 0 ? 0 : Math.max(8, Math.round((solveCount / maxSolves) * 100));
    fill.style.width = `${widthPercent}%`;
    fill.textContent = solveCount === 0 ? "" : String(solveCount);

    track.appendChild(fill);
    wrapper.appendChild(label);
    wrapper.appendChild(track);
    chart.appendChild(wrapper);
  });
}

function renderRecentActivity(entries) {
  const tableBody = document.getElementById("recentRows");
  tableBody.innerHTML = "";

  if (!Array.isArray(entries) || entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No recent completion activity found.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  entries.forEach((entry) => {
    const attempts = entry.attempts || {};
    const attemptsText = `${Number(attempts.total || 0)} (C:${Number(attempts.correct || 0)} / I:${Number(
      attempts.incorrect || 0
    )})`;
    const identityLabel =
      entry.userName && entry.userEmail
        ? `${entry.userName} (${entry.userEmail})`
        : entry.userName || entry.userEmail || entry.sessionId || "-";

    const row = document.createElement("tr");
    appendCell(row, formatTimestamp(entry.timestamp));
    appendCell(row, entry.challengeId);
    appendCell(row, identityLabel, {
      className: "session-cell",
      title: entry.sessionId || ""
    });
    appendCell(row, Number(entry.score || 0));
    appendCell(row, Number(entry.hintsUsed || 0));
    appendCell(row, attemptsText);
    tableBody.appendChild(row);
  });
}

async function loadAdminData() {
  const refreshButton = document.getElementById("refreshBtn");
  refreshButton.disabled = true;
  setStatusMessage("", true);

  try {
    const [summaryResponse, statsResponse, recentResponse] = await Promise.all([
      fetch(withAdminToken(`${API_BASE}/summary`), { credentials: "include" }),
      fetch(withAdminToken(`${API_BASE}/challenge-stats`), { credentials: "include" }),
      fetch(withAdminToken(`${API_BASE}/recent`), { credentials: "include" })
    ]);

    if ([summaryResponse, statsResponse, recentResponse].some((response) => response.status === 401)) {
      redirectToLogin();
      return;
    }

    if (!summaryResponse.ok || !statsResponse.ok || !recentResponse.ok) {
      throw new Error("One or more admin API requests failed.");
    }

    const [summary, challengeStats, recent] = await Promise.all([
      summaryResponse.json(),
      statsResponse.json(),
      recentResponse.json()
    ]);

    renderSummary(summary || {});
    renderChallengeStats(challengeStats || []);
    renderSolvesChart(challengeStats || []);
    renderRecentActivity(recent || []);
  } catch (error) {
    setStatusMessage("Unable to load admin analytics. Check backend status and admin access settings.", false);
  } finally {
    refreshButton.disabled = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    loadAdminData();
  }, REFRESH_INTERVAL_MS);
}

async function loadAdminIdentity() {
  try {
    const response = await fetch(`${AUTH_API}/me`, { credentials: "include" });
    if (!response.ok) {
      document.getElementById("adminUserInfo").textContent = "Instructor session";
      return;
    }

    const payload = await response.json();
    if (payload.authenticated && payload.user) {
      document.getElementById("adminUserInfo").textContent = `${payload.user.name} (${payload.user.role})`;
      return;
    }

    document.getElementById("adminUserInfo").textContent = "Instructor session";
  } catch (error) {
    document.getElementById("adminUserInfo").textContent = "Instructor session";
  }
}

async function logout() {
  try {
    await fetch(`${AUTH_API}/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch (error) {
    // Ignore logout errors and redirect anyway.
  }
  redirectToLogin();
}

function setTrackStatusMessage(message, success) {
  const node = document.getElementById("trackStatusMessage");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.classList.remove("result-ok", "result-bad");
  if (message) {
    node.classList.add(success ? "result-ok" : "result-bad");
  }
}

function trackStatusPill(status) {
  const map = {
    locked: ["Locked", "status-locked"],
    available: ["Available", "status-available"],
    active: ["Active", "status-active"],
    expired: ["Expired", "status-expired"],
    completed: ["Completed", "status-solved"]
  };
  const [label, cls] = map[status] || ["Unknown", "status-locked"];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function renderAdvancedTrackTable(users) {
  const tbody = document.getElementById("advancedTrackRows");
  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

  if (!Array.isArray(users) || users.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "No student users found.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  users
    .filter((u) => u.role === "student")
    .forEach((user) => {
      const row = document.createElement("tr");

      // Student name/email
      const identityCell = document.createElement("td");
      identityCell.textContent = `${user.userName} (${user.userEmail})`;
      row.appendChild(identityCell);

      // Status
      const statusCell = document.createElement("td");
      statusCell.innerHTML = trackStatusPill(user.status);
      row.appendChild(statusCell);

      // Eligible
      const eligibleCell = document.createElement("td");
      eligibleCell.textContent = user.eligible ? "✓ Yes" : "No";
      eligibleCell.style.color = user.eligible ? "#9fffc4" : "#ffafbc";
      row.appendChild(eligibleCell);

      // Started at
      const startedCell = document.createElement("td");
      startedCell.textContent = user.startedAt ? formatTimestamp(user.startedAt) : "—";
      row.appendChild(startedCell);

      // Expires / expired at
      const expiresCell = document.createElement("td");
      if (user.status === "active" && user.expiresAt) {
        const remaining = user.remainingSeconds;
        expiresCell.textContent =
          typeof remaining === "number"
            ? `${formatTimestamp(user.expiresAt)} (${Math.floor(remaining / 60)}m left)`
            : formatTimestamp(user.expiresAt);
      } else if (user.expiresAt) {
        expiresCell.textContent = formatTimestamp(user.expiresAt);
      } else {
        expiresCell.textContent = "—";
      }
      row.appendChild(expiresCell);

      // Attempt count
      const attemptsCell = document.createElement("td");
      attemptsCell.textContent = Number(user.attemptCount || 0);
      row.appendChild(attemptsCell);

      // Action: Reset button
      const actionCell = document.createElement("td");
      const canReset = ["active", "expired", "completed", "available"].includes(user.status);
      if (canReset) {
        const resetBtn = document.createElement("button");
        resetBtn.className = "btn btn-secondary btn-reset-track";
        resetBtn.type = "button";
        resetBtn.textContent = "Reset";
        resetBtn.dataset.userId = String(user.userId);
        resetBtn.dataset.userName = user.userName;
        resetBtn.addEventListener("click", (e) => {
          const uid = Number(e.currentTarget.dataset.userId);
          const uname = e.currentTarget.dataset.userName;
          handleResetAdvancedTrack(uid, uname, resetBtn);
        });
        actionCell.appendChild(resetBtn);
      } else {
        actionCell.textContent = "—";
      }
      row.appendChild(actionCell);

      tbody.appendChild(row);
    });
}

async function loadAdvancedTrackUsers() {
  setTrackStatusMessage("", true);
  try {
    const response = await fetch(`${API_BASE}/tracks/advanced/users`, {
      credentials: "include"
    });

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.success) {
      renderAdvancedTrackTable(payload.users || []);
    } else {
      setTrackStatusMessage("Unable to load advanced track data.", false);
    }
  } catch (error) {
    setTrackStatusMessage("Failed to load Advanced Track user data.", false);
  }
}

async function handleResetAdvancedTrack(targetUserId, userName, btn) {
  if (!confirm(`Are you certain you want to completely erase and rollback the Advanced Track status natively for [${userName}]?`)) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Resetting…";
  }
  setTrackStatusMessage("", true);

  try {
    const response = await fetch(`${API_BASE}/tracks/advanced/reset`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId })
    });

    const payload = await response.json();
    if (response.ok && payload.success) {
      setTrackStatusMessage(
        payload.message || `Advanced Track reset for ${userName}.`,
        true
      );
      await loadAdvancedTrackUsers();
    } else {
      setTrackStatusMessage(payload.message || "Reset failed.", false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Reset";
      }
    }
  } catch (error) {
    setTrackStatusMessage("Network error during reset.", false);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Reset";
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("refreshBtn").addEventListener("click", loadAdminData);
  document.getElementById("adminLogoutBtn").addEventListener("click", logout);
  const refreshTrackBtn = document.getElementById("refreshTrackBtn");
  if (refreshTrackBtn) {
    refreshTrackBtn.addEventListener("click", loadAdvancedTrackUsers);
  }
  await loadAdminIdentity();
  await loadAdminData();
  await loadAdvancedTrackUsers();
  startAutoRefresh();
});
