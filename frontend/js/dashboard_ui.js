/**
 * dashboard_ui.js
 * 
 * UI bridge: syncs dashboard.js outputs → new dark theme dashboard elements.
 * Runs AFTER dashboard.js. Handles:
 *   - Progress bar update
 *   - Advanced Track KPI card (timer/status in the stats row)
 *   - Auth state → nav adjustments
 */

(function () {
  "use strict";

  // ── Progress Bar ────────────────────────────────────────────
  function updateProgressBar() {
    const solvedEl = document.getElementById("summarySolved");
    const progressFill = document.getElementById("progressFill");
    const progressText = document.getElementById("progressText");

    if (!solvedEl || !progressFill) return;

    const text = solvedEl.textContent || "0 / 8";
    const match = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return;

    const solved = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    const pct = total > 0 ? Math.round((solved / total) * 100) : 0;

    progressFill.style.width = pct + "%";
    if (progressText) progressText.textContent = `${solved} / ${total}`;
  }

  // Watch summarySolved changes
  const solvedEl = document.getElementById("summarySolved");
  if (solvedEl) {
    const observer = new MutationObserver(updateProgressBar);
    observer.observe(solvedEl, { childList: true, subtree: true, characterData: true });
    updateProgressBar(); // run once on load
  }

  // ── Advanced Track KPI Sync ─────────────────────────────────
  // dashboard.js renders advanced track into #advancedTrackInner.
  // We hook into its polling to also update the KPI card at the top.

  function syncAdvancedKpi(payload) {
    const kpiCard = document.getElementById("advancedKpiCard");
    const timerEl = document.getElementById("advancedCountdownDisplay");
    const statusEl = document.getElementById("advancedKpiStatus");
    const metaEl = document.getElementById("advancedKpiMeta");

    if (!kpiCard) return;

    const status = (payload && payload.status) || "locked";

    // Show card for non-locked states
    if (status === "locked") {
      kpiCard.style.display = "none";
      return;
    }

    kpiCard.style.display = "flex";

    // Pill status text
    const pillMap = {
      available:  "Available",
      active:     "Active",
      expired:    "Expired",
      completed:  "Completed"
    };

    if (statusEl) {
      statusEl.textContent = pillMap[status] || status;
      statusEl.className = "db-adv-pill " + status;
    }

    // Timer display
    if (status === "active") {
      if (timerEl) timerEl.textContent = formatCountdown(payload.remainingSeconds || 0);
      if (metaEl) {
        const start = payload.startedAt ? new Date(payload.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
        const exp   = payload.expiresAt  ? new Date(payload.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
        metaEl.textContent = `Started: ${start} | Expires: ${exp}`;
      }
    } else if (status === "available") {
      if (timerEl) { timerEl.textContent = "Ready"; timerEl.style.fontSize = "1.25rem"; timerEl.style.color = "#3b82f6"; }
      if (metaEl) metaEl.textContent = "All beginner challenges solved!";
    } else if (status === "expired") {
      if (timerEl) { timerEl.textContent = "Expired"; timerEl.style.fontSize = "1.25rem"; timerEl.style.color = "#ef4444"; }
      if (metaEl) metaEl.textContent = "Ask instructor to reset";
    } else if (status === "completed") {
      if (timerEl) { timerEl.textContent = "Done!"; timerEl.style.fontSize = "1.5rem"; timerEl.style.color = "#10b981"; }
      if (metaEl) metaEl.textContent = "Advanced Track complete 🎉";
    }
  }

  function formatCountdown(secs) {
    const s = Math.max(0, Math.floor(secs));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  }

  // Intercept /api/tracks/advanced/status fetch results
  // We patch window.fetch to observe the response when dashboard.js polls
  const _origFetch = window.fetch;
  window.fetch = function (url, opts) {
    const result = _origFetch.apply(this, arguments);
    if (typeof url === "string" && url.includes("/api/tracks/advanced")) {
      result.then(res => {
        if (!res.ok) return;
        res.clone().json().then(payload => {
          if (payload && payload.success) {
            syncAdvancedKpi(payload);
            // Live-tick the KPI timer in sync with dashboard.js countdown
            if (payload.status === "active") {
              const timerEl = document.getElementById("advancedCountdownDisplay");
              if (timerEl && typeof advancedRemainingSeconds !== "undefined") {
                // Mirror the global advancedRemainingSeconds from dashboard.js
                const kpiTick = setInterval(() => {
                  if (typeof advancedRemainingSeconds === "undefined") {
                    clearInterval(kpiTick);
                    return;
                  }
                  timerEl.textContent = formatCountdown(advancedRemainingSeconds);
                  if (advancedRemainingSeconds < 1800) {
                    timerEl.classList.add("timer-warning");
                  } else {
                    timerEl.classList.remove("timer-warning");
                  }
                }, 1000);
              }
            }
          }
        }).catch(() => {});
      }).catch(() => {});
    }
    return result;
  };

  // ── Auth → nav greeting ─────────────────────────────────────
  const loginLink = document.getElementById("loginLink");
  if (loginLink) {
    const navObserver = new MutationObserver(() => {
      const loggedIn = loginLink.classList.contains("hidden");
      const scoreboardLink = document.getElementById("scoreboardLink");
      if (scoreboardLink) {
        scoreboardLink.classList.toggle("hidden", !loggedIn);
      }
    });
    navObserver.observe(loginLink, { attributes: true, attributeFilter: ["class"] });
  }

  // ── Advanced grid: override dashboard.js rendering location ──
  // dashboard.js renders beginner cards into #challengeRows (existing id)
  // Advanced track renders into #advancedTrackInner already
  // So the wiring is already handled by the existing dashboard.js logic.

})();
