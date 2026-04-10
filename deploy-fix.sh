#!/bin/bash

# Quick deployment script for the session/cookie fix

echo "🔧 Deploying session/cookie fix for Render..."
echo ""

# Check if git is clean
if [[ -n $(git status -s) ]]; then
    echo "📝 Changes detected. Committing..."
    git add backend/server.js
    git add RENDER_TROUBLESHOOTING.md
    git add deploy-fix.sh
    git commit -m "Fix: Add trust proxy for Render deployment

- Added app.set('trust proxy', 1) to detect HTTPS behind reverse proxy
- Added debug endpoint /api/debug/session for troubleshooting
- Added logging for configuration values
- This fixes login/registration issues on Render, Railway, Heroku, etc."
    echo "✅ Changes committed"
else
    echo "✅ No changes to commit"
fi

echo ""
echo "🚀 Pushing to remote..."
git push

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "📋 Next steps:"
echo "1. Wait for Render to finish deploying (check dashboard)"
echo "2. Clear browser cookies for your Render domain"
echo "3. Visit: https://your-app.onrender.com/api/debug/session"
echo "   - Verify 'secure: true' and 'protocol: https'"
echo "4. Try registering a new account"
echo "5. Should see your username (not 'Guest mode')"
echo ""
echo "📖 For detailed troubleshooting, see: RENDER_TROUBLESHOOTING.md"
