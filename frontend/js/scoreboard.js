"use strict";

let currentUserId = null;
let currentMode = "overall";

function el(id) { return document.getElementById(id); }

async function init() {
  await fetchIdentity();
  await fetchOverview();
  await fetchLeaderboard();
  setupFilters();
}

async function fetchIdentity() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) {
      window.location.href = "/pages/login.html";
      return;
    }

    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUserId = data.user.id;
      const userEl = el("userIdentity");
      if (userEl) userEl.textContent = `[${data.user.role}] ${data.user.name || data.user.email}`;

      if (data.user.role === "admin" || data.user.role === "instructor") {
        const navActions = document.querySelector(".zt-nav-actions");
        if (navActions) {
          const adminBtn = document.createElement("a");
          adminBtn.href = "/pages/admin.html";
          adminBtn.className = "zt-nav-link";
          adminBtn.textContent = "Admin Panel";
          navActions.insertBefore(adminBtn, navActions.firstChild);
        }
      }
    }
  } catch (e) {
    console.error("Identity fetch failed.", e);
  }
}

async function fetchOverview() {
  try {
    const res = await fetch("/api/scoreboard/overview");
    const data = await res.json();
    if (data.success) {
      el("statParticipants").textContent = data.overview.totalParticipants;
      el("statSolves").textContent = data.overview.totalSolves;
      el("statHighest").textContent = data.overview.highestScore;
      el("statAvg").textContent = data.overview.averageScore;
    }
  } catch (e) {
    console.error("Failed calculating literal overview headers.");
  }
}

async function fetchLeaderboard() {
  const tbody = el("leaderboardBody");
  tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 3rem;">Synchronizing with Scoreboard Node Engine...</td></tr>`;

  try {
    const res = await fetch(`/api/scoreboard/leaderboard?mode=${currentMode}`);
    const data = await res.json();

    if (data.success && data.leaderboard.length > 0) {
      renderTable(data.leaderboard);
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 3rem; font-family:'JetBrains Mono',monospace; font-size:0.85rem;">No solve data yet — be the first to solve a challenge and claim #1!</td></tr>`;
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #f87171; padding: 3rem;">Backend Scoreboard Calculation Engine Disconnected.</td></tr>`;
  }
}

function renderTable(board) {
  const tbody = el("leaderboardBody");
  let html = "";

  board.forEach((u) => {
    const isCurrent = currentUserId && (Number(u.userId) === Number(currentUserId));
    const rowClass = isCurrent ? "current-user-row" : "";
    let nameHtml = `<span style="font-weight: 600;">${u.displayName}</span>`;
    if (isCurrent) nameHtml += ` <span class="badge" style="background: rgba(16,185,129,0.2); color: var(--primary); border: 1px solid rgba(16,185,129,0.5);">You</span>`;

    let rankClass = "rank";
    let rankBadge = `<span>#${u.rank}</span>`;
    if (u.rank === 1) { rankClass += " rank-1"; rankBadge = `<span class="badge-rank badge-gold">1st</span>`; }
    else if (u.rank === 2) { rankClass += " rank-2"; rankBadge = `<span class="badge-rank badge-silver">2nd</span>`; }
    else if (u.rank === 3) { rankClass += " rank-3"; rankBadge = `<span class="badge-rank badge-bronze">3rd</span>`; }

    html += `<tr class="${rowClass} ${rankClass}">
            <td class="col-rank">${rankBadge}</td>
            <td class="col-name">${nameHtml}</td>
            <td class="col-metrics score">${u.totalScore}</td>
            <td class="col-metrics" style="color:#e2e8f0;">${u.beginnerScore}</td>
            <td class="col-metrics" style="color:#c084fc; font-weight:600;">${u.advancedScore}</td>
            <td class="col-metrics meta">${u.completedChallengeCount}</td>
            <td class="col-metrics meta">${u.totalHintsUsed}</td>
            <td class="col-metrics meta">${u.totalAttempts}</td>
        </tr>`;
  });

  tbody.innerHTML = html;
}

function setupFilters() {
  const btns = document.querySelectorAll(".tab-btn[data-mode]");
  btns.forEach(b => {
    b.addEventListener("click", (e) => {
      btns.forEach(btn => btn.classList.remove("active"));
      e.currentTarget.classList.add("active");
      currentMode = e.currentTarget.dataset.mode;
      fetchLeaderboard();
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
