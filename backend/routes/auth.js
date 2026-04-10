const express = require("express");
const controller = require("../controllers/authController");
const { authIpLimiter, authAccountLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/register", authAccountLimiter, authIpLimiter, controller.register);
router.post("/login", authAccountLimiter, authIpLimiter, controller.login);
router.post("/logout", controller.logout);
router.get("/me", controller.me);

module.exports = router;
