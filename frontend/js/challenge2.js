const API_BASE = `${window.location.origin}/api/challenge2`;
const defaultExplanation =
  "The hidden admin panel was discoverable through robots.txt. " +
  "Robots.txt is often misused and can leak sensitive paths. " +
  "Attackers frequently check robots.txt during reconnaissance.";

let timerId = null;
let elapsedSeconds = 0;
let solved = false;

function redirectToLogin() {
  const redirect = encodeURIComponent(window.location.pathname);
  window.location.href = `/pages/login.html?redirect=${redirect}`;
}

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateTimerDisplay() {
  document.getElementById("timerValue").textContent = formatTime(elapsedSeconds);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    if (solved) {
      return;
    }

    elapsedSeconds += 1;
    updateTimerDisplay();
  }, 1000);
}

function showMessage(message, success) {
  const result = document.getElementById("result");
  result.textContent = message;
  result.classList.remove("result-ok", "result-bad");
  result.classList.add(success ? "result-ok" : "result-bad");
}

function applyDifficultyBadgeStyle(difficultyText) {
  const badge = document.getElementById("difficultyBadge");
  const normalized = String(difficultyText || "").toLowerCase();
  badge.classList.remove("badge-easy", "badge-medium", "badge-hard");

  if (normalized.includes("hard")) {
    badge.classList.add("badge-hard");
    return;
  }

  if (normalized.includes("medium") || normalized.includes("intermediate")) {
    badge.classList.add("badge-medium");
    return;
  }

  badge.classList.add("badge-easy");
}

function renderHints(hints) {
  const hintList = document.getElementById("hintList");
  hintList.innerHTML = "";

  hints.forEach((hint, index) => {
    const li = document.createElement("li");
    li.textContent = `Hint ${index + 1}: ${hint}`;
    hintList.appendChild(li);
  });
}

function showPostSolveExplanation(explanationText) {
  const panel = document.getElementById("postSolvePanel");
  const text = document.getElementById("postSolveText");
  text.textContent = explanationText || defaultExplanation;
  panel.classList.remove("hidden");
}

function applyChallengeData(challenge) {
  const difficulty = challenge.difficulty || "Beginner";
  document.getElementById("challengeTitle").textContent = challenge.title || "The Hidden Admin";
  document.getElementById("difficultyBadge").textContent = difficulty;
  applyDifficultyBadgeStyle(difficulty);
  document.getElementById("categoryValue").textContent = challenge.category || "Web Application VAPT";
  document.getElementById("pointsValue").textContent = String(challenge.points || 0);
  document.getElementById("flagFormatValue").textContent = challenge.flagFormat || "CTF{...}";
}

function setControlsEnabled(enabled) {
  document.getElementById("flag").disabled = !enabled;
  document.getElementById("submitBtn").disabled = !enabled;
}

function applySessionState(sessionState) {
  if (!sessionState) {
    return;
  }

  solved = Boolean(sessionState.solved);
  elapsedSeconds = Number(sessionState.elapsedSeconds || 0);
  updateTimerDisplay();

  const statusNode = document.getElementById("statusValue");
  statusNode.textContent = solved ? "Solved" : "Unsolved";
  statusNode.classList.toggle("status-value-solved", solved);
  statusNode.classList.toggle("status-value-unsolved", !solved);
  document.getElementById("scoreValue").textContent = String(sessionState.pointsAwarded || 0);
  document.getElementById("attemptsValue").textContent = String(sessionState.attempts?.total || 0);
  document.getElementById("hintsUsedValue").textContent = String(sessionState.hintsUsed || 0);

  renderHints(sessionState.revealedHints || []);

  const hintsRemaining = Number(sessionState.hintsRemaining || 0);
  document.getElementById("hintBtn").disabled = solved || hintsRemaining <= 0;
  setControlsEnabled(!solved);

  if (solved) {
    stopTimer();
  } else if (!timerId) {
    startTimer();
  }
}

async function loadChallenge() {
  try {
    const response = await fetch(API_BASE, { credentials: "include" });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    const payload = await response.json();

    if (!payload.success) {
      showMessage(payload.message || "Unable to load challenge.", false);
      return;
    }

    applyChallengeData(payload.challenge || {});
    applySessionState(payload.sessionState);

    if (payload.sessionState?.solved && payload.explanation) {
      showPostSolveExplanation(payload.explanation);
    }
  } catch (error) {
    showMessage("Challenge service is unavailable. Please refresh after backend starts.", false);
  }
}

async function revealHint() {
  if (solved) {
    showMessage("Challenge already solved in this session.", true);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/hint`, {
      method: "POST",
      credentials: "include"
    });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    const result = await response.json();
    applySessionState(result.sessionState);
    showMessage(result.message, result.success);
  } catch (error) {
    showMessage("Hint request failed. Try again.", false);
  }
}

async function submitFlag() {
  const flagInput = document.getElementById("flag");
  const flag = flagInput.value.trim();

  if (!flag) {
    showMessage("Please enter a flag before submitting.", false);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/submit`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ flag })
    });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    const result = await response.json();

    applySessionState(result.sessionState);
    showMessage(result.message, result.success);

    if (result.success) {
      showPostSolveExplanation(result.explanation);
    }
  } catch (error) {
    showMessage("Submission failed. Try again.", false);
  }
}

function setupEvents() {
  document.getElementById("hintBtn").addEventListener("click", revealHint);
  document.getElementById("submitBtn").addEventListener("click", submitFlag);
  document.getElementById("flag").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitFlag();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupEvents();
  updateTimerDisplay();
  await loadChallenge();
});
