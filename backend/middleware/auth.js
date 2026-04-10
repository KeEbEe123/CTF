function getSessionUser(req) {
  const user = req.session?.authUser;
  if (!user || !Number.isInteger(Number(user.id))) {
    return null;
  }
  return {
    id: Number(user.id),
    name: String(user.name || ""),
    email: String(user.email || ""),
    role: String(user.role || "student")
  };
}

function hasRole(user, roles) {
  return Boolean(user && Array.isArray(roles) && roles.includes(user.role));
}

function isAdminTokenValid(req) {
  const requiredToken = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();
  if (!requiredToken) {
    return false;
  }

  const providedToken = String(req.get("x-admin-token") || "").trim();
  return Boolean(providedToken) && providedToken === requiredToken;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  req.authUser = user;
  return next();
}

function requireRoles(roles, options = {}) {
  const safeRoles = Array.isArray(roles) ? roles : [];

  return (req, res, next) => {
    const user = getSessionUser(req);
    if (hasRole(user, safeRoles)) {
      req.authUser = user;
      return next();
    }

    if (options.allowAdminToken && isAdminTokenValid(req)) {
      req.authUser = user || null;
      return next();
    }

    const statusCode = user ? 403 : 401;
    return res.status(statusCode).json({
      success: false,
      message: user ? "Forbidden." : "Authentication required."
    });
  };
}

function requirePageRoles(roles, options = {}) {
  const safeRoles = Array.isArray(roles) ? roles : [];
  const redirectPath = options.redirectPath || "/pages/login.html";

  return (req, res, next) => {
    const user = getSessionUser(req);
    if (hasRole(user, safeRoles)) {
      req.authUser = user;
      return next();
    }

    if (options.allowAdminToken && isAdminTokenValid(req)) {
      req.authUser = user || null;
      return next();
    }

    if (!user) {
      const redirectTo = `${redirectPath}?redirect=${encodeURIComponent(req.originalUrl)}`;
      return res.redirect(302, redirectTo);
    }

    return res.status(403).send("Access denied.");
  };
}

module.exports = {
  getSessionUser,
  requireAuth,
  requireRoles,
  requirePageRoles,
  isAdminTokenValid
};
