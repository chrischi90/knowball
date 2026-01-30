# Render.com Deployment Guide

## Quick Start

1. **Push to GitHub** (if not already done):
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

2. **Deploy on Render**:
   - Go to https://dashboard.render.com/
   - Click "New" → "Blueprint"
   - Connect your GitHub account
   - Select this repository
   - Render will auto-detect `render.yaml` and create both services
   - Click "Apply"

3. **Set Environment Variables** (after services are created):
   
   **For `nba-wheel-app` service:**
   - `NBA_SERVICE_URL`: Set to your Python service URL
     - Format: `https://nba-wheel-api.onrender.com`
     - Get this from the Python service dashboard after deployment
   
   **For `nba-wheel-api` service:**
   - `NEXT_PUBLIC_APP_ORIGIN`: Set to your Next.js app URL
     - Format: `https://nba-wheel-app.onrender.com`
     - Get this from the Next.js service dashboard after deployment

4. **Update URLs** (one-time):
   After both services are deployed, update the environment variables:
   - Go to each service → Settings → Environment
   - Add the URLs from step 3
   - Click "Save Changes" (services will auto-redeploy)

## Important Notes

### Free Tier Limitations
- **Spin down after 15 minutes** of inactivity
- **Cold start**: ~30 seconds when accessing after spin-down
- **750 hours/month**: Plenty for testing (31 days = 744 hours)

### Expected Behavior
- First request after inactivity: Slow (~30s)
- Subsequent requests: Fast
- Perfect for MVP/testing with friends

### Monitoring
- View logs: Service dashboard → "Logs" tab
- Check health: Service dashboard → "Events" tab
- Free uptime monitoring: https://uptimerobot.com/

## Troubleshooting

### Issue: Services fail to start
**Solution**: Check logs in Render dashboard
- Next.js: Verify `npm install` and `npm run build` succeeded
- Python: Verify `pip install` succeeded

### Issue: CORS errors
**Solution**: Update `NEXT_PUBLIC_APP_ORIGIN` in Python service to match your Next.js URL

### Issue: Socket.io connection fails
**Solution**: 
1. Check that both services are running
2. Verify `NBA_SERVICE_URL` in Next.js service
3. Wait for cold start to complete (~30s)

### Issue: NBA API calls fail
**Solution**: Python service may be rate-limited by NBA API
- Free tier is fine for testing
- Errors are expected for very old/inactive players

## Upgrading to Paid Tier

When ready to remove spin-down (always-on):
1. Go to service → Settings → Plan
2. Select "Starter" ($7/month per service)
3. Click "Change Plan"
4. Services restart and stay online 24/7

## Next Steps

After successful deployment:
- [ ] Test the app with your Render URL
- [ ] Share with friends for testing
- [ ] Monitor free tier usage in dashboard
- [ ] Set up custom domain (optional, free on Render)
