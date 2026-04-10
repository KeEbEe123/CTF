const bcrypt = require("bcryptjs");
const {
  normalizeEmail,
  sanitizeUser,
  findUserByEmail,
  findUserById,
  createUser,
  updateLastLoginAt
} = require("../lib/userStore");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinLength = 8;
const hashRoundsRaw = Number(process.env.BCRYPT_ROUNDS || 12);
const hashRounds = Number.isInteger(hashRoundsRaw) && hashRoundsRaw >= 4 ? hashRoundsRaw : 12;

function hasPasswordComplexity(password) {
  const text = String(password || "");
  const hasLetter = /[A-Za-z]/.test(text);
  const hasNumber = /\d/.test(text);
  return text.length >= passwordMinLength && hasLetter && hasNumber;
}

function issueSession(req, user) {
  req.session.authUser = {
    id: Number(user.id),
    name: String(user.name || ""),
    email: String(user.email || ""),
    role: String(user.role || "student")
  };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function register(req, res) {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email || "");
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All registration fields are required."
      });
    }

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address."
      });
    }

    if (!hasPasswordComplexity(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters and include letters and numbers."
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and confirm password do not match."
      });
    }

    if (findUserByEmail(email)) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    const { getPublicProfiles } = require("../lib/userStore");
    const existingProfiles = getPublicProfiles();
    if (existingProfiles.some(u => String(u.name).toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({
        success: false,
        message: "Display name already taken."
      });
    }

    const passwordHash = await bcrypt.hash(password, hashRounds);
    const user = createUser({
      name,
      email,
      passwordHash,
      role: "student"
    });

    await regenerateSession(req);
    issueSession(req, user);

    return res.status(201).json({
      success: true,
      message: "Registration successful.",
      user: sanitizeUser(user)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to register account right now."
    });
  }
}

async function login(req, res) {
  try {
    const email = normalizeEmail(req.body.email || "");
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const matches = await bcrypt.compare(password, String(user.passwordHash || ""));
    if (!matches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const updatedUser = updateLastLoginAt(user.id) || user;
    await regenerateSession(req);
    issueSession(req, updatedUser);

    return res.json({
      success: true,
      message: "Login successful.",
      user: sanitizeUser(updatedUser)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to login right now."
    });
  }
}

function logout(req, res) {
  if (!req.session) {
    return res.json({ success: true, message: "Logged out." });
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to logout right now."
      });
    }

    res.clearCookie("ctf.sid");
    return res.json({
      success: true,
      message: "Logged out."
    });
  });
}

function me(req, res) {
  const sessionUser = req.session?.authUser;
  if (!sessionUser || !Number.isInteger(Number(sessionUser.id))) {
    return res.json({
      authenticated: false
    });
  }

  const user = findUserById(sessionUser.id);
  if (!user) {
    return res.json({
      authenticated: false
    });
  }

  return res.json({
    authenticated: true,
    user: sanitizeUser(user)
  });
}

module.exports = {
  register,
  login,
  logout,
  me
};
