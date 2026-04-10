"use strict";

const express = require("express");
const controller = require("./controller");

const router = express.Router();

router.get("/details", controller.details);
router.post("/connect", controller.connect);
router.post("/send", controller.send);
router.post("/reset", controller.resetConnection);
router.post("/submit", controller.submit);

module.exports = router;
