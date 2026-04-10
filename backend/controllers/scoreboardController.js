"use strict";

const { getLeaderboard, getUserStats, getChallengeStats } = require("../lib/scoreboard");
const { getPublicProfileById } = require("../lib/userStore");

function getOverview(req, res) {
  try {
    const board = getLeaderboard("overall");
    // Overview maps explicitly standard metric requirements
    const totalParticipants = board.length;
    const totalSolves = board.reduce((acc, u) => acc + u.completedChallengeCount, 0);

    let highestScore = 0;
    let totalScoreSum = 0;
    let totalBeginnerSolves = 0;
    let totalAdvancedSolves = 0;

    board.forEach(u => {
      if (u.totalScore > highestScore) highestScore = u.totalScore;
      totalScoreSum += u.totalScore;

      u.breakdown.forEach(b => {
        if (b.valid) {
          if (b.track === "advanced") totalAdvancedSolves++;
          else totalBeginnerSolves++;
        }
      });
    });

    const avgScore = totalParticipants > 0 ? (totalScoreSum / totalParticipants).toFixed(1) : 0;

    return res.json({
      success: true,
      overview: {
        totalParticipants,
        totalSolves,
        totalBeginnerSolves,
        totalAdvancedSolves,
        averageScore: avgScore,
        highestScore
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to calculate overview metrics." });
  }
}

function getRankings(req, res) {
  try {
    const mode = String(req.query.mode || "overall");
    const board = getLeaderboard(mode);

    // Sanitize output explicitly
    const safeBoard = board.map(u => ({
      rank: u.rank,
      userId: u.userId,
      displayName: u.displayName,
      beginnerScore: u.beginnerScore,
      advancedScore: u.advancedScore,
      totalScore: u.totalScore,
      totalHintsUsed: u.totalHintsUsed,
      totalAttempts: u.totalAttempts,
      lastSolveAt: u.lastSolveAt,
      completedChallengeCount: u.completedChallengeCount,
      advancedTrackStatus: u.advancedTrackStatus
    }));

    return res.json({
      success: true,
      mode,
      leaderboard: safeBoard
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to retrieve leaderboard data." });
  }
}

function getUserDetail(req, res) {
  try {
    const targetUserId = Number(req.params.id);
    const stats = getUserStats(targetUserId);

    if (!stats) {
      return res.status(404).json({ success: false, message: "User score calculations not found or user does not exist." });
    }

    const safeDetail = {
      userId: stats.userId,
      displayName: stats.displayName,
      role: stats.role,
      rank: stats.rank,
      beginnerScore: stats.beginnerScore,
      advancedScore: stats.advancedScore,
      totalScore: stats.totalScore,
      totalHintsUsed: stats.totalHintsUsed,
      totalAttempts: stats.totalAttempts,
      lastSolveAt: stats.lastSolveAt,
      completedChallengeCount: stats.completedChallengeCount,
      advancedTrackStatus: stats.advancedTrackStatus,
      breakdown: stats.breakdown
    };

    return res.json({
      success: true,
      user: safeDetail
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to fetch specific user mapping." });
  }
}

function getChallenges(req, res) {
  try {
    const statsArray = getChallengeStats();

    // Filter out unused challenges safely
    const safeArray = statsArray.map(c => ({
      challengeId: c.challengeId,
      title: c.title,
      track: c.track,
      solveCount: c.solveCount,
      avgAttempts: c.avgAttempts,
      avgHintsUsed: c.avgHintsUsed
    }));

    return res.json({
      success: true,
      challenges: safeArray
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load challenge score metrics." });
  }
}

module.exports = {
  getOverview,
  getRankings,
  getUserDetail,
  getChallenges
};
