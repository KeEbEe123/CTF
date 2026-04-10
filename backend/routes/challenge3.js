const express = require("express");
const controller = require("../controllers/challenge3Controller");
const { requireAuth } = require("../middleware/auth");
const { hintLimiter, submitLimiter, commandLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(requireAuth);

router.get("/", controller.getChallenge);
router.post("/hint", hintLimiter, controller.revealHint);
router.post("/command", commandLimiter, controller.runCommand);
router.post("/submit", submitLimiter, controller.submitFlag);

module.exports = router;
