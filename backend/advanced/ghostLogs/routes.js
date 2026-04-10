"use strict";

const express = require("express");
const controller = require("./controller");

const router = express.Router();

router.get("/details", controller.details);
router.get("/download", controller.download);
router.post("/submit", controller.submit);

module.exports = router;
