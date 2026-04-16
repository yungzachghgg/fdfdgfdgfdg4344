# BloxFlip Clone

A full-stack Roblox gambling platform clone with real-time chat.

## Features

- **8 Working Games**: Mines, Crash, Plinko, Blackjack, Slots, Roll, Slide, Cups
- **Real-time Chat**: Socket.io powered live chat with online user count
- **User Authentication**: LocalStorage-based auth system
- **Balance System**: Robux currency with persistent storage
- **Responsive Dashboard**: Modern dark theme with game cards and stats

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Deployment**: Railway (recommended)

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or start production server
npm start
```

Open http://localhost:3000

## Railway Deployment

### Step 1: Create Railway Account
1. Go to https://railway.app/
2. Sign up with GitHub

### Step 2: Deploy
Option A - GitHub:
1. Push this code to a GitHub repo
2. In Railway: New Project → Deploy from GitHub repo

Option B - CLI:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Step 3: Environment Variables
No environment variables required - the app uses port 3000 by default (Railway assigns automatically).

### Step 4: Domain
Railway automatically provides a domain like `https://your-project.up.railway.app`

To use a custom domain:
1. Go to Settings in Railway
2. Add Custom Domain
3. Configure DNS

## Default Accounts

- **Admin**: `admin` / `admin123` (100,000 R$)
- **New users** get 100 R$ signup bonus

## Project Structure

```
├── server.js          # Express + Socket.io server
├── package.json       # Dependencies
├── index.html         # Landing page
├── login.html         # Login page
├── register.html      # Registration page
├── dashboard.html     # Main dashboard with chat
├── js/
│   └── auth.js        # Authentication system
├── games/             # Game pages
│   ├── mines.html
│   ├── crash.html
│   ├── blackjack.html
│   ├── slots.html
│   ├── roll.html
│   ├── cups.html
│   ├── slide.html
│   └── plinko.html
└── wp-content/        # Assets folder
```

## Chat System

The real-time chat uses Socket.io:
- Messages persist in memory (resets on server restart)
- Shows online user count
- Guest usernames generated automatically
- Messages limited to 200 characters
- Keeps last 100 messages in history

## Notes

- Chat history is in-memory only (lost on server restart)
- User data stored in browser localStorage
- For production, consider adding:
  - MongoDB for persistent data
  - Redis for chat history
  - User authentication database
