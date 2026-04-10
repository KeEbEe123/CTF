const path = require("path");

module.exports = {
  challengeId: 3,
  challengesDbPath: path.resolve(__dirname, "../../database/challenges.json"),
  completionLogPath: path.resolve(__dirname, "../../database/challenge3_completions.log"),
  commandMaxLength: 180
};
