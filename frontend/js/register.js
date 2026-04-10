const AUTH_API = `${window.location.origin}/api/auth`;

function setMessage(text, success) {
  const node = document.getElementById("registerMessage");
  node.textContent = text;
  node.classList.remove("result-ok", "result-bad");
  if (text) {
    node.classList.add(success ? "result-ok" : "result-bad");
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  const mismatchError = document.getElementById("passwordMismatchError");

  if (!name || !email || !password || !confirmPassword) {
    setMessage("All fields are required.", false);
    return;
  }

  if (password !== confirmPassword) {
    if (mismatchError) {
      mismatchError.style.display = "block";
    }
    setMessage("Please correct the errors above.", false);
    return;
  } else if (mismatchError) {
    mismatchError.style.display = "none";
  }

  try {
    const response = await fetch(`${AUTH_API}/register`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, email, password, confirmPassword })
    });

    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch (parseError) {
      payload = null;
    }

    if (!response.ok || !payload?.success) {
      const retryAfterRaw = response.headers.get("Retry-After");
      const retryAfter = Number(payload?.retryAfterSeconds || retryAfterRaw || 0);
      const fallback = raw || `Registration failed (HTTP ${response.status}).`;

      if (response.status === 429) {
        const cooldownSuffix = Number.isFinite(retryAfter) && retryAfter > 0
          ? ` Please wait ${retryAfter}s before retrying.`
          : "";
        setMessage((payload?.message || "Too many registration attempts.") + cooldownSuffix, false);
      } else {
        setMessage(payload?.message || fallback, false);
      }

      document.getElementById("password").value = "";
      document.getElementById("confirmPassword").value = "";
      return;
    }

    setMessage("Registration successful. Redirecting to dashboard...", true);
    window.location.href = "/";
  } catch (error) {
    setMessage("Could not reach server. Please check backend status and try again.", false);
    document.getElementById("password").value = "";
    document.getElementById("confirmPassword").value = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const passwordInput = document.getElementById("password");
  const confirmInput = document.getElementById("confirmPassword");
  const mismatchError = document.getElementById("passwordMismatchError");
  const submitBtn = document.querySelector(".register-submit");

  const validatePasswords = () => {
    if (confirmInput.value && passwordInput.value !== confirmInput.value) {
      if (mismatchError) mismatchError.style.display = "block";
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (mismatchError) mismatchError.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
    }
  };

  if (passwordInput && confirmInput) {
    passwordInput.addEventListener("input", validatePasswords);
    confirmInput.addEventListener("input", validatePasswords);
  }

  document.getElementById("registerForm").addEventListener("submit", handleRegister);
});
