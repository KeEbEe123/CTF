const API_BASE = `${window.location.origin}/api/challenge4`;

let timerId = null;
let elapsedSeconds = 0;
let solved = false;
let promptValue = "kali@ctf-lab:~$";
let localCommandHistory = [];
let historyCursor = -1;

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

function appendTerminalLine(text, lineClass = "") {
  const output = document.getElementById("terminalOutput");
  const line = document.createElement("div");
  line.className = `terminal-line ${lineClass}`.trim();
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function clearTerminalOutput() {
  const output = document.getElementById("terminalOutput");
  output.innerHTML = "";
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

function showPostSolve(postSolve) {
  if (!postSolve) {
    return;
  }

  document.getElementById("postSolveSummary").textContent = postSolve.summary || "";
  const outcomesList = document.getElementById("postSolveOutcomes");
  outcomesList.innerHTML = "";

  (postSolve.outcomes || []).forEach((outcome) => {
    const li = document.createElement("li");
    li.textContent = outcome;
    outcomesList.appendChild(li);
  });

  document.getElementById("postSolvePanel").classList.remove("hidden");
}

function setPrompt(prompt) {
  promptValue = prompt || "kali@ctf-lab:~$";
  document.getElementById("terminalPrompt").textContent = promptValue;
}

function applyChallengeData(challenge) {
  const difficulty = challenge.difficulty || "Beginner-Intermediate";
  document.getElementById("challengeTitle").textContent = challenge.title || "The Forgotten Server";
  document.getElementById("difficultyBadge").textContent = difficulty;
  applyDifficultyBadgeStyle(difficulty);
  document.getElementById("categoryValue").textContent = challenge.category || "Ethical Hacking / Kali";
  document.getElementById("pointsValue").textContent = String(challenge.points || 0);
  document.getElementById("flagFormatValue").textContent = challenge.flagFormat || "CTF{...}";
  document.getElementById("challengeStory").textContent = challenge.description || "";
  document.getElementById("objectiveText").textContent = challenge.objective || "";
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
  setPrompt(sessionState.terminal?.prompt || "kali@ctf-lab:~$");

  document.getElementById("hintBtn").disabled = solved || Number(sessionState.hintsRemaining || 0) <= 0;
  document.getElementById("flag").disabled = solved;

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

    if (payload.sessionState?.solved && payload.postSolve) {
      showPostSolve(payload.postSolve);
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

async function executeTerminalCommand(command) {
  appendTerminalLine(`${promptValue} ${command}`, "terminal-command");

  try {
    const response = await fetch(`${API_BASE}/command`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ command })
    });
    if (response.status === 401) {
      redirectToLogin();
      return;
    }
    const result = await response.json();

    if (!result.success) {
      appendTerminalLine(result.message || "Command failed.", "terminal-error");
      document.getElementById("terminalInput").focus();
      return;
    }

    if (result.clear) {
      clearTerminalOutput();
    } else {
      (result.output || []).forEach((line) => {
        appendTerminalLine(line);
      });
    }

    applySessionState(result.sessionState);
    document.getElementById("terminalInput").focus();
  } catch (error) {
    appendTerminalLine("Command failed. Try again.", "terminal-error");
    document.getElementById("terminalInput").focus();
  }
}

async function submitFlag() {
  const flag = document.getElementById("flag").value.trim();
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

    if (result.success && result.postSolve) {
      showPostSolve(result.postSolve);
    }
  } catch (error) {
    showMessage("Submission failed. Try again.", false);
  }
}

function moveHistoryCursor(direction) {
  if (!localCommandHistory.length) {
    return;
  }

  historyCursor += direction;
  if (historyCursor < 0) {
    historyCursor = -1;
    document.getElementById("terminalInput").value = "";
    return;
  }

  if (historyCursor >= localCommandHistory.length) {
    historyCursor = localCommandHistory.length - 1;
  }

  const command = localCommandHistory[localCommandHistory.length - 1 - historyCursor];
  document.getElementById("terminalInput").value = command;
}

function setupTerminal() {
  const terminalForm = document.getElementById("terminalForm");
  const terminalInput = document.getElementById("terminalInput");
  const terminalShell = document.getElementById("terminalShell");

  terminalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const command = terminalInput.value.trim();
    if (!command) {
      return;
    }

    localCommandHistory.push(command);
    historyCursor = -1;
    terminalInput.value = "";
    await executeTerminalCommand(command);
  });

  terminalInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHistoryCursor(1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHistoryCursor(-1);
    }
  });

  terminalShell.addEventListener("click", () => {
    terminalInput.focus();
  });
}

function setupEvents() {
  setupTerminal();
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
  appendTerminalLine("Kali network investigation terminal initialized.");
  appendTerminalLine("Run 'help' to view available commands.");
  await loadChallenge();
});
