const { ADVANCED_TRACK_DURATION_MS } = require("./lib/trackLogic");
const { getTrackRecord, setTrackRecord } = require("./lib/trackStore");
const { computeTrackStatus } = require("./lib/trackLogic");

console.log("=== Node Runtime Timing Verification ===");
console.log("Current Unix MS:", Date.now());
console.log("Current ISO:", new Date().toISOString());
console.log("ADVANCED_TRACK_DURATION_MS:", ADVANCED_TRACK_DURATION_MS);
console.log("Type of Duration:", typeof ADVANCED_TRACK_DURATION_MS);
console.log("Hours:", ADVANCED_TRACK_DURATION_MS / 1000 / 60 / 60);

console.log("\n=== Checking specific trackLogic edge cases ===");
const currentMs = Date.now();
const record = {
    status: "active",
    startedAt: new Date(currentMs - (5 * 60 * 60 * 1000)).toISOString(), // 5 hours ago
    expiresAt: new Date(currentMs - (1 * 60 * 60 * 1000)).toISOString()  // 1 hour ago
};

console.log("Mock Record:", record);
const resolved = computeTrackStatus(record, true, currentMs);
console.log("Resolved Status:", resolved.status);
console.log("Remaining Seconds:", resolved.remainingSeconds);
