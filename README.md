# Skincare Advisor — AWS Deployment Guide

## Architecture
- **Frontend**: AWS Amplify (React + Vite)
- **Backend**: AWS Elastic Beanstalk (Node.js + Express)
- **Database**: MongoDB Atlas
- **Storage**: AWS S3 (image uploads)
- **AI**: Google Gemini API

---

## Step 1 — Set up environment variables

Copy `.env.example` to `.env` and fill in all values.  
**Never commit `.env` to GitHub.**

---

## Step 2 — Deploy Backend (Elastic Beanstalk)

1. Go to AWS Console → Elastic Beanstalk → Create Application
2. Platform: **Node.js 20**
3. Upload your code as a ZIP (exclude `node_modules`, `dist`)
4. In **Configuration → Software → Environment Properties**, add all your env variables
5. Note your Beanstalk URL: `http://skincare-xxx.ap-south-1.elasticbeanstalk.com`

---

## Step 3 — Deploy Frontend (AWS Amplify)

1. Go to AWS Console → AWS Amplify → Host Web App
2. Connect to your GitHub repo: `https://github.com/tyageshdarmatics/skincare`
3. Branch: `main`
4. Amplify auto-detects `amplify.yml` — build settings are already configured
5. Add these Environment Variables in Amplify Console:
   - `GEMINI_API_KEY` = your key
   - `VITE_API_URL` = your Beanstalk URL
   - `VITE_LEADS_API_URL` = your Beanstalk URL + `/leads`
6. Deploy — your Amplify URL will be: `https://main.xxxxxxxx.amplifyapp.com`

---

## Step 4 — Update CORS on Beanstalk

After getting your Amplify URL, go to Elastic Beanstalk → Configuration → Environment Properties and update:
```
CORS_ORIGINS=https://main.xxxxxxxx.amplifyapp.com
```

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Fill in your .env values

# Run both frontend and backend together
npm run dev
```

Frontend runs at: http://localhost:5173  
Backend runs at: http://localhost:8080
