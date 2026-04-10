const API_BASE = `${window.location.origin}/api/challenge1`;

let challengeData = null;
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
  document.getElementById("timer").textContent = formatTime(elapsedSeconds);
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

function setChallengeControlsEnabled(enabled) {
  document.getElementById("flag").disabled = !enabled;
  document.getElementById("submitBtn").disabled = !enabled;
  document.getElementById("hintBtn").disabled = !enabled;
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

function renderPostSolveExplanation(postSolve) {
  if (!postSolve) {
    return;
  }

  document.getElementById("expSuspicious").textContent = postSolve.suspiciousPacket || "";
  document.getElementById("expBase64").textContent = postSolve.base64Concept || "";
  document.getElementById("expFilter").textContent = postSolve.wiresharkFilter || "";
  document.getElementById("expOutcome").textContent = postSolve.learningOutcome || "";
  document.getElementById("postSolvePanel").classList.remove("hidden");
}

function applySessionState(sessionState) {
  if (!sessionState) {
    return;
  }

  solved = Boolean(sessionState.solved);
  elapsedSeconds = Number(sessionState.elapsedSeconds || 0);
  updateTimerDisplay();

  const statusNode = document.getElementById("status");
  statusNode.textContent = solved ? "Solved" : "Unsolved";
  statusNode.classList.toggle("status-value-solved", solved);
  statusNode.classList.toggle("status-value-unsolved", !solved);
  document.getElementById("score").textContent = String(sessionState.pointsAwarded || 0);
  document.getElementById("attempts").textContent = String(sessionState.attempts?.total || 0);
  document.getElementById("hintsUsed").textContent = String(sessionState.hintsUsed || 0);
  renderHints(sessionState.revealedHints || []);

  setChallengeControlsEnabled(!solved);
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
      showMessage(payload.message || "Could not load challenge.", false);
      return;
    }

    challengeData = payload.challenge;
    document.getElementById("challengeTitle").textContent = challengeData.title;
    document.getElementById("challengeDescription").textContent = challengeData.description;
    document.getElementById("difficultyBadge").textContent = challengeData.difficulty;
    applyDifficultyBadgeStyle(challengeData.difficulty);
    document.getElementById("flagFormat").textContent = challengeData.flagFormat;
    const toolingNote = document.getElementById("toolRequirementNote");
    if (toolingNote && challengeData.requiresExternalTool) {
      toolingNote.textContent =
        challengeData.toolingNote ||
        "Tool requirement: This challenge requires Wireshark installed locally.";
    }
    applySessionState(payload.sessionState);

    if (payload.postSolve) {
      renderPostSolveExplanation(payload.postSolve);
    }
  } catch (error) {
    showMessage("Server is not reachable. Start backend and refresh.", false);
  }
}

async function revealHint() {
  if (!challengeData) {
    showMessage("Challenge data is not loaded yet.", false);
    return;
  }

  if (solved) {
    showMessage("Challenge already solved.", true);
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

async function downloadPcap() {
  const btn = document.getElementById("downloadBtn");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Preparing Download…";

  try {
    const tokenResponse = await fetch(`${API_BASE}/download-token`, {
      credentials: "include"
    });
    if (tokenResponse.status === 401) {
      redirectToLogin();
      return;
    }
    const tokenResult = await tokenResponse.json();

    if (!tokenResult.success) {
      showMessage(tokenResult.message || "Unable to get download token.", false);
      return;
    }

    window.location.href = `${API_BASE}/download?token=${encodeURIComponent(tokenResult.token)}`;
  } catch (error) {
    showMessage("Download request failed. Try again.", false);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function submitFlag() {
  if (solved) {
    showMessage("Challenge is already solved.", true);
    return;
  }

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
    showMessage(result.message, result.success);
    applySessionState(result.sessionState);

    if (result.success && result.postSolve) {
      renderPostSolveExplanation(result.postSolve);
    }
  } catch (error) {
    showMessage("Submission failed. Try again.", false);
  }
}

function setupEvents() {
  document.getElementById("downloadBtn").addEventListener("click", downloadPcap);
  document.getElementById("submitBtn").addEventListener("click", submitFlag);
  document.getElementById("hintBtn").addEventListener("click", revealHint);
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
