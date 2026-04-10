/**
 * backend/advanced/phantomExecution/routes.js
 *
 * Express router for Phantom Execution (adv-1).
 * Mounted at /api/advanced/phantom/* via advancedChallenges.js.
 *
 * Auth + Advanced Track active enforcement is applied at the parent router.
 * All endpoints here are automatically gated.
 *
 * Full endpoint surface (Part 2):
 *
 *   GET  /details              Safe challenge overview + runtime status
 *   POST /submit               Flag submission
 *
 *   POST /auth/login           Challenge-local session init
 *   POST /auth/logout          Clear challenge session
 *
 *   GET  /user/profile         Read persistent portal profile
 *   POST /user/update          Update profile [VULNERABLE — session role sync]
 *
 *   POST /admin/check          Admin gate check (trusts session role)
 *   POST /admin/export         Admin export -> auditToken (the flag)
 *
 *   GET  /audit/logs           Audit log context (with decoy filter param)
 *   GET  /system/info          App info [DECOY — JWT field looks relevant, isn't]
 *   GET  /debug/env            Debug env probe [DECOY — looks like config leak]
 */

"use strict";

const express = require("express");
const {
    getDetails,
    submitFlag,
    authLogin,
    authLogout,
    getUserProfile,
    updateUserProfile,
    adminCheck,
    adminExport,
    getAuditLogs,
    getSystemInfo,
    getDebugEnv
} = require("./controller");

const router = express.Router();

// ── Foundation endpoints ───────────────────────────────────────────────────────
router.get("/details", getDetails);
router.post("/submit", submitFlag);

// ── Challenge-local auth ───────────────────────────────────────────────────────
router.post("/auth/login", authLogin);
router.post("/auth/logout", authLogout);

// ── Portal user endpoints ──────────────────────────────────────────────────────
router.get("/user/profile", getUserProfile);
router.post("/user/update", updateUserProfile);

// ── Admin endpoints (gated by transient session role inside controller) ────────
router.post("/admin/check", adminCheck);
router.post("/admin/export", adminExport);

// ── Context / decoy endpoints ──────────────────────────────────────────────────
router.get("/audit/logs", getAuditLogs);
router.get("/system/info", getSystemInfo);
router.get("/debug/env", getDebugEnv);

module.exports = router;
