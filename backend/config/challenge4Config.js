const path = require("path");

module.exports = {
  challengeId: 4,
  challengesDbPath: path.resolve(__dirname, "../../database/challenges.json"),
  completionLogPath: path.resolve(__dirname, "../../database/challenge4_completions.log"),
  commandMaxLength: 180
};
