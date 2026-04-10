"use strict";

const express = require("express");
const controller = require("../controllers/scoreboardController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/overview", controller.getOverview);
router.get("/leaderboard", controller.getRankings);
router.get("/user/:id", controller.getUserDetail);
router.get("/challenges", controller.getChallenges);

module.exports = router;
