const express = require("express");
const router = express.Router();
const controller = require("../controllers/challenge2Controller");
const { requireAuth } = require("../middleware/auth");
const { hintLimiter, submitLimiter } = require("../middleware/rateLimit");

router.use(requireAuth);

router.get("/", controller.getChallenge);
router.post("/hint", hintLimiter, controller.revealHint);
router.post("/submit", submitLimiter, controller.submitFlag);

module.exports = router;
