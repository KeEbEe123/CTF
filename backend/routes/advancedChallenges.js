/**
 * backend/routes/advancedChallenges.js
 *
 * Gated route surface for all Advanced Track challenges.
 *
 * ALL routes under /api/advanced/* are enforced by requireAdvancedTrackActive.
 * Any request hitting these routes when the user is not in an "active" advanced
 * track window is rejected with a 403 — including flag submissions, hints,
 * commands, and challenge details.
 *
 * When advanced challenge content is added in Part 3+, register those routers
 * as sub-routers here, e.g.:
 *   const challenge5Routes = require("./advancedChallenge5");
 *   router.use("/challenge5", challenge5Routes);
 *
 * All such endpoints automatically inherit the requireAdvancedTrackActive guard.
 */

"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requireAdvancedTrackActive } = require("../middleware/advancedTrack");
const phantomRoutes = require("../advanced/phantomExecution/routes");

const router = express.Router();

// ── Gate 1: must be authenticated ──────────────────────────────────────────
router.use(requireAuth);

// ── Gate 2: Advanced Track must be explicitly started and not expired ───────
//   reconcileAndPersistExpiry is called inside requireAdvancedTrackActive.
//   On active→expired detection: DB is written back + audit log fires.
router.use(requireAdvancedTrackActive);

// ── Status probe ─────────────────────────────────────────────────────────────
// Returns the caller's enforced advanced track state. Useful for health checks
// and proving the guard works end-to-end.
router.get("/status", (req, res) => {
    const state = req.advancedTrackState || {};
    return res.json({
        success: true,
        message: "Advanced Track access confirmed.",
        status: state.status,
        expiresAt: state.expiresAt || null,
        remainingSeconds: state.remainingSeconds != null ? state.remainingSeconds : null,
        serverNow: state.serverNow || new Date().toISOString()
    });
});

// ── Advanced Challenge #1: Phantom Execution ─────────────────────────────────
// All routes under /api/advanced/phantom/* inherit the two gates above.
const protocolRoutes = require("../advanced/protocolCollapse/routes");
const ghostRoutes = require("../advanced/ghostLogs/routes");
const signalRoutes = require("../advanced/signalNoise/routes");

// Sub-routers protected by requireAuth & requireAdvancedTrackActive
router.use("/phantom", phantomRoutes);
router.use("/protocol", protocolRoutes);
router.use("/ghost", ghostRoutes);
router.use("/siem", signalRoutes);

module.exports = router;
