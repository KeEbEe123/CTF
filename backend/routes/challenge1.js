const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { hintLimiter, submitLimiter } = require("../middleware/rateLimit");
const {
  getChallengeDetails,
  issueDownloadToken,
  downloadChallengeFile,
  revealHint,
  submitFlag
} = require("../controllers/challengeController");

const router = express.Router();
router.use(requireAuth);

router.get("/", getChallengeDetails);
router.get("/download-token", issueDownloadToken);
router.get("/download", downloadChallengeFile);
router.post("/hint", hintLimiter, revealHint);
router.post("/submit", submitLimiter, submitFlag);

module.exports = router;
