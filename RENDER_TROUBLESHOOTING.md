# Render Deployment - Session/Cookie Troubleshooting

## The Fix: Trust Proxy

The main issue was **missing `trust proxy` configuration**. This has been added to `backend/server.js`.

### Why This Matters

Render uses a reverse proxy (like nginx) in front of your app:

```
User (HTTPS) → Render Proxy (HTTPS) → Your App (HTTP)
```

Without `app.set("trust proxy", 1)`:
- Express thinks all requests are HTTP
- Sets cookies with `secure: true` 
- But thinks connection is HTTP
- Cookie gets rejected ❌

With `app.set("trust proxy", 1)`:
- Express reads `X-Forwarded-Proto: https` header
- Knows the original request was HTTPS
- Sets secure cookies correctly ✅

## Deploy the Fix

### Step 1: Deploy Updated Code

```bash
git add backend/server.js
git commit -m "Fix: Add trust proxy for Render deployment"
git push
```

Render will auto-deploy.

### Step 2: Verify Environment Variables

In Render dashboard, ensure these are set:

```
NODE_ENV=production
COOKIE_SECURE=true
SESSION_SECRET=<your-secret-here>
```

### Step 3: Test

1. Wait for deployment to complete (check Render logs)
2. Clear browser cookies for your Render domain
3. Go to your app URL
4. Register a new account
5. Should see your username (not "Guest mode")

## Debug Endpoint

A new debug endpoint has been added: `/api/debug/session`

Visit `https://your-app.onrender.com/api/debug/session` to see:

```json
{
  "hasSession": true,
  "sessionID": "abc123...",
  "authUser": null,
  "secure": true,
  "protocol": "https",
  "headers": {
    "x-forwarded-proto": "https",
    "x-forwarded-host": "your-app.onrender.com"
  },
  "cookieSecure": true
}
```

### What to Check:

- ✅ `secure: true` - Express detects HTTPS
- ✅ `protocol: "https"` - Request is HTTPS
- ✅ `cookieSecure: true` - Cookies require HTTPS
- ✅ `hasSession: true` - Session middleware working

If `secure: false`, the trust proxy setting didn't work.

## Testing After Login

After logging in, visit `/api/debug/session` again:

```json
{
  "hasSession": true,
  "sessionID": "abc123...",
  "authUser": {
    "id": 1,
    "name": "Your Name",
    "email": "you@example.com",
    "role": "student"
  },
  "secure": true,
  "protocol": "https",
  "headers": {...},
  "cookieSecure": true
}
```

If `authUser` is populated, authentication is working! ✅

## Browser DevTools Check

### 1. Check Cookie is Set

After login:
1. Open DevTools (F12)
2. Application tab → Cookies → Your domain
3. Look for `ctf.sid` cookie
4. Verify these attributes:
   - ✅ `Secure` checkbox is checked
   - ✅ `SameSite` is `Lax`
   - ✅ `HttpOnly` is checked
   - ✅ `Path` is `/`

### 2. Check Network Request

1. DevTools → Network tab
2. Try logging in
3. Find the `POST /api/auth/login` request
4. Check Response Headers:
   ```
   Set-Cookie: ctf.sid=...; Path=/; HttpOnly; Secure; SameSite=Lax
   ```

If you don't see `Secure` in the Set-Cookie header, trust proxy isn't working.

### 3. Check Request Headers

After login, any API request should include:
```
Cookie: ctf.sid=...
```

If the cookie isn't being sent, check:
- Is the cookie domain correct?
- Is the cookie expired?
- Is the cookie marked Secure but you're on HTTP?

## Common Issues

### Issue 1: Cookie Not Being Set

**Symptoms**: No `ctf.sid` cookie in DevTools

**Causes**:
- Trust proxy not configured → Deploy the fix
- COOKIE_SECURE mismatch → Check environment variables
- Browser blocking third-party cookies → Not applicable (same domain)

**Fix**: Deploy the updated `server.js` with trust proxy

### Issue 2: Cookie Set But Not Sent

**Symptoms**: Cookie exists in DevTools but not sent with requests

**Causes**:
- SameSite=Strict (we use Lax, so not the issue)
- Domain mismatch
- Path mismatch

**Fix**: Check cookie attributes in DevTools

### Issue 3: Session Exists But authUser is Null

**Symptoms**: `/api/debug/session` shows session but no authUser

**Causes**:
- Login failed (check response)
- Session was cleared
- Different session on each request (SESSION_SECRET changing)

**Fix**: 
1. Ensure SESSION_SECRET is set and doesn't change
2. Check login response for errors
3. Try registering a new account

### Issue 4: Works Locally But Not on Render

**Symptoms**: Everything works on `localhost` but fails on Render

**Cause**: Trust proxy not configured (now fixed)

**Verification**:
```bash
# Local (works without trust proxy)
curl http://localhost:3123/api/debug/session

# Render (needs trust proxy)
curl https://your-app.onrender.com/api/debug/session
```

Compare the `secure` and `protocol` values.

## Render-Specific Configuration

### Environment Variables

Required:
```
NODE_ENV=production
COOKIE_SECURE=true
SESSION_SECRET=<generate-with-crypto>
PORT=3123
BCRYPT_ROUNDS=12
```

Optional but recommended:
```
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=<strong-password>
SEED_INSTRUCTOR_EMAIL=instructor@yourdomain.com
SEED_INSTRUCTOR_PASSWORD=<strong-password>
```

### Persistent Disk (Recommended)

To prevent database resets:

1. Render Dashboard → Your Service → Settings
2. Scroll to **Persistent Disks**
3. Add Disk:
   - Mount Path: `/app/database`
   - Size: 1 GB
4. Save and redeploy

### Health Check

Render can use the health endpoint:

1. Render Dashboard → Your Service → Settings
2. Health Check Path: `/health`
3. Save

## Still Not Working?

### Step 1: Check Render Logs

```
Render Dashboard → Your Service → Logs
```

Look for:
```
[config] NODE_ENV: production
[config] COOKIE_SECURE: true
[config] Trust proxy: enabled (required for Render/Railway/Heroku)
[config] CORS origin: all origins (reflect)
CTF server running on port 3123
```

### Step 2: Test the Debug Endpoint

```bash
curl https://your-app.onrender.com/api/debug/session
```

Should return JSON with `secure: true`.

### Step 3: Test Registration

```bash
curl -X POST https://your-app.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "Test1234",
    "confirmPassword": "Test1234"
  }' \
  -v
```

Look for `Set-Cookie` header in response with `Secure` flag.

### Step 4: Contact Support

If still failing:
1. Share Render logs
2. Share output from `/api/debug/session`
3. Share browser DevTools screenshots (Network + Application tabs)
4. Share curl output from Step 3

## Security Notes

- ✅ `trust proxy: 1` only trusts the first proxy (Render's)
- ✅ This is safe because Render controls the proxy
- ✅ Don't use `trust proxy: true` (trusts all proxies - unsafe)
- ✅ Secure cookies prevent MITM attacks
- ✅ HttpOnly cookies prevent XSS attacks
- ✅ SameSite=Lax prevents CSRF attacks

## Summary

The fix is simple: **`app.set("trust proxy", 1)`**

This tells Express to trust Render's proxy headers, allowing it to correctly detect HTTPS connections and set secure cookies properly.

Deploy the updated code and your login/registration should work! 🎉
