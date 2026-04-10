# Railway Deployment Guide

## Prerequisites
- A Railway account (sign up at https://railway.app)
- Git repository with your code

## Deployment Steps

### 1. Push Your Code to Git
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Deploy to Railway

#### Option A: Using Railway CLI
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up
```

#### Option B: Using Railway Dashboard
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will auto-detect the Dockerfile and deploy

### 3. Configure Environment Variables

In Railway dashboard, go to your project → Variables tab and add:

**Required Variables:**
```
NODE_ENV=production
PORT=3123
SESSION_SECRET=<generate-a-strong-random-secret-here>
COOKIE_SECURE=true
BCRYPT_ROUNDS=12
```

**Admin Credentials (change these!):**
```
SEED_ADMIN_EMAIL=admin@zerotrace.local
SEED_ADMIN_PASSWORD=<your-secure-password>
SEED_ADMIN_NAME=ZeroTrace Admin
```

**Instructor Credentials (change these!):**
```
SEED_INSTRUCTOR_EMAIL=instructor@zerotrace.local
SEED_INSTRUCTOR_PASSWORD=<your-secure-password>
SEED_INSTRUCTOR_NAME=ZeroTrace Instructor
```

**Optional (if you need CORS):**
```
CORS_ORIGIN=https://your-railway-domain.railway.app
```

### 4. Generate a Strong Session Secret

Run this command to generate a secure session secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output and use it as your `SESSION_SECRET` value.

### 5. Access Your Application

Railway will provide a public URL like:
```
https://your-app-name.up.railway.app
```

Your CTF platform will be accessible at this URL.

## Important Security Notes

1. **Change Default Passwords**: The default admin/instructor passwords in `.env` are for development only
2. **Use Strong Session Secret**: Generate a cryptographically secure random string
3. **HTTPS is Automatic**: Railway provides SSL certificates automatically
4. **Data Persistence**: Railway provides ephemeral storage. For production, consider:
   - Using Railway's volume mounts for the `database/` folder
   - Migrating to a proper database (PostgreSQL, MongoDB)

## Monitoring & Logs

View logs in Railway dashboard:
1. Go to your project
2. Click on the deployment
3. View "Logs" tab

## Updating Your Deployment

```bash
# Make changes to your code
git add .
git commit -m "Update description"
git push

# Railway will automatically redeploy
```

## Troubleshooting

### App won't start
- Check logs in Railway dashboard
- Verify all environment variables are set
- Ensure `SESSION_SECRET` is configured

### Can't access the app
- Check if deployment is "Active" in Railway
- Verify the public URL is generated
- Check if port 3123 is exposed (should be automatic)

### Database resets on redeploy
- Railway uses ephemeral storage by default
- Add a volume mount for `/app/database` in Railway settings
- Or migrate to a persistent database service

## Cost Considerations

Railway offers:
- Free tier with $5 credit/month
- Pay-as-you-go pricing after free tier
- Typical CTF platform usage: ~$5-10/month

## Support

For Railway-specific issues: https://railway.app/help
For CTF platform issues: Check the main README.md
