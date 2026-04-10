const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getAdvancedStatus, startAdvancedTrack, getDashboardSummary } = require("../controllers/trackController");

const router = express.Router();

// All track routes require authentication
router.use(requireAuth);

// GET /api/tracks/summary
router.get("/summary", getDashboardSummary);

// GET /api/tracks/advanced/status
router.get("/advanced/status", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
}, getAdvancedStatus);

// POST /api/tracks/advanced/start
router.post("/advanced/start", startAdvancedTrack);

module.exports = router;
