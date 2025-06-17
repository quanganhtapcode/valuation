# 🚀 Deployment Guide for Vietnam Stock Valuation Tool

## Option 1: Vercel (Recommended - Free & Easy)

Vercel is perfect for full-stack applications with Python backend.

### Steps:
1. **Create Vercel Account**
   - Go to [vercel.com](https://vercel.com)
   - Sign up with GitHub account

2. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/vietnam-stock-valuation.git
   git push -u origin main
   ```

3. **Deploy on Vercel**
   - Connect your GitHub repository
   - Vercel will auto-detect the Python backend
   - Your site will be live at `https://projectname.vercel.app`

---

## Option 2: GitHub Pages (Frontend Only)

Free static hosting, but backend won't work.

### Steps:
1. **Push to GitHub** (same as above)

2. **Enable GitHub Pages**
   - Go to repository Settings > Pages
   - Select source: Deploy from branch `main`
   - Your site: `https://yourusername.github.io/repository-name`

⚠️ **Note**: Backend API won't work on GitHub Pages. You'll need to deploy backend separately.

---

## Option 3: Heroku (Full Stack)

Free tier available, supports Python backend.

### Steps:
1. **Install Heroku CLI**
   - Download from [heroku.com](https://devcenter.heroku.com/articles/heroku-cli)

2. **Login and Create App**
   ```bash
   heroku login
   heroku create your-app-name
   ```

3. **Deploy**
   ```bash
   git add .
   git commit -m "Deploy to Heroku"
   git push heroku main
   ```

4. **Set Environment Variables**
   ```bash
   heroku config:set FLASK_ENV=production
   ```

---

## Option 4: Netlify (Frontend Only)

Great for static sites with excellent performance.

### Steps:
1. **Create Netlify Account**
   - Go to [netlify.com](https://netlify.com)
   - Sign up with GitHub

2. **Deploy from Git**
   - Connect GitHub repository
   - Auto-deploy on every push
   - Custom domain available

---

## 🔧 Configuration for Production

### Update API URLs
If deploying frontend and backend separately, update the API URLs in your JavaScript:

```javascript
// In app.js, update the base URL
const API_BASE_URL = 'https://your-backend-url.vercel.app';

// Replace localhost URLs with your backend URL
const response = await fetch(`${API_BASE_URL}/api/stock/${symbol}`);
```

### Environment Variables
For production deployment, set these environment variables:
- `FLASK_ENV=production`
- `PORT=5000` (or as required by hosting platform)

---

## 📋 Pre-Deployment Checklist

- [ ] All files committed to Git
- [ ] `requirements.txt` includes all dependencies  
- [ ] `Procfile` configured for Heroku
- [ ] API URLs updated for production
- [ ] `.gitignore` excludes sensitive files
- [ ] README.md updated with live URL

---

## 🌐 Recommended Deployment Strategy

**For Full Functionality:**
1. **Backend**: Deploy to Vercel/Heroku
2. **Frontend**: Can be same platform or separate (Netlify)
3. **Update API URLs** in frontend to point to backend

**For Demo/Portfolio:**
1. **GitHub Pages**: Free and easy for showcasing
2. **Note**: Add disclaimer that backend features require separate deployment

---

## 🆘 Troubleshooting

**Common Issues:**
1. **CORS Errors**: Ensure `flask-cors` is configured
2. **Module Not Found**: Check `requirements.txt`
3. **Port Issues**: Use `os.environ.get('PORT', 5000)`
4. **Build Failures**: Check Python version compatibility

**Need Help?**
- Check platform-specific documentation
- Review deployment logs for errors
- Test locally first with `python backend_server.py`

---

## 💡 Quick Start (Vercel)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel

# Follow prompts, and you're live! 🎉
```

Your Vietnam Stock Valuation Tool will be accessible worldwide!
