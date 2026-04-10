# ZeroTrace CTF - Platform Starter

Welcome to the **ZeroTrace CTF** platform. This is a production-ready Capture The Flag environment designed for cybersecurity training.

## 🚀 Quick Start

To get the platform running locally or on a server, follow these steps:

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Check the `.env` file for configuration options such as `PORT`, `SESSION_SECRET`, and default admin credentials.

3. **Start the Platform**
   ```bash
   npm start
   ```
   The platform will be available at `http://localhost:3001` (default).

## 🛡 Features

- **8 Challenges**: 4 Beginner and 4 Advanced cybersecurity challenges.
- **Advanced Track**: A timed 4-hour challenge sequence that unlocks after the beginner track is complete.
- **Live Scoreboard**: Real-time rankings with tie-break logic based on solve speed and hint usage.
- **Instructor Dashboard**: Analytics on student progress, solve trends, and challenge performance.
- **Secure by Design**: Server-side flag validation, session-bound tokens, and hashed flag comparisons.

## 📁 Project Structure

- `backend/`: Express.js server, routes, and controllers.
- `frontend/`: Web interface, including the dashboard, scoreboard, and challenge pages.
- `database/`: JSON-based data storage for challenges and progress tracking.

## 🔑 Default Credentials

- **Admin**: `admin@zerotrace.local` / `ZTAdmin@2026`
- **Instructor**: `instructor@zerotrace.local` / `Instructor@2026`

---
*ZeroTrace CTF powered by Roblocksec*
