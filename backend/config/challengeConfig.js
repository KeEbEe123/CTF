const path = require("path");

module.exports = {
  challengeId: 1,
  challengesDbPath: path.resolve(__dirname, "../../database/challenges.json"),
  challengeFilesDir: path.resolve(__dirname, "../challenges"),
  completionLogPath: path.resolve(__dirname, "../../database/challenge1_completions.log"),
  downloadTokenTtlMs: 5 * 60 * 1000
};
