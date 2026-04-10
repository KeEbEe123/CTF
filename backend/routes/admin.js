const express = require("express");
const controller = require("../controllers/adminController");
const trackController = require("../controllers/trackController");
const { requireRoles } = require("../middleware/auth");

const router = express.Router();

router.use(requireRoles(["instructor", "admin"]));
router.get("/summary", controller.getSummary);
router.get("/challenge-stats", controller.getChallengeStats);
router.get("/recent", controller.getRecent);

// Advanced track management
router.get("/tracks/advanced/users", trackController.listAdvancedUsers);
router.post("/tracks/advanced/reset", trackController.adminResetAdvancedTrack);

module.exports = router;
