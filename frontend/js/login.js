const AUTH_API = `${window.location.origin}/api/auth`;

function setMessage(text, success) {
  const node = document.getElementById("loginMessage");
  node.textContent = text;
  node.classList.remove("result-ok", "result-bad");
  if (text) {
    node.classList.add(success ? "result-ok" : "result-bad");
  }
}

function getRedirectTarget() {
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  if (!redirect || !redirect.startsWith("/")) {
    return "/";
  }
  return redirect;
}

async function checkAlreadyLoggedIn() {
  try {
    const response = await fetch(`${AUTH_API}/me`, { credentials: "include" });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload.authenticated) {
      window.location.href = getRedirectTarget();
    }
  } catch (error) {
    // Ignore background auth check errors.
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    setMessage("Email and password are required.", false);
    return;
  }

  try {
    const response = await fetch(`${AUTH_API}/login`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
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
      const fallback = raw || `Login failed (HTTP ${response.status}).`;

      if (response.status === 429) {
        const cooldownSuffix = Number.isFinite(retryAfter) && retryAfter > 0
          ? ` Please wait ${retryAfter}s before retrying.`
          : "";
        setMessage((payload?.message || "Too many login attempts.") + cooldownSuffix, false);
        return;
      }

      setMessage(payload?.message || fallback, false);
      return;
    }

    setMessage("Login successful. Redirecting...", true);
    window.location.href = getRedirectTarget();
  } catch (error) {
    setMessage("Could not reach server. Please try again.", false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const forgotBtn = document.getElementById("forgotBtn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", (e) => {
      e.preventDefault();
      setMessage("Password reset is instructor-managed in this lab environment.", false);
    });
  }
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  await checkAlreadyLoggedIn();
});
