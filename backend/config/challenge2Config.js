const path = require("path");

module.exports = {
  challengeId: 2,
  challengesDbPath: path.resolve(__dirname, "../../database/challenges.json"),
  completionLogPath: path.resolve(__dirname, "../../database/challenge2_completions.log")
};
