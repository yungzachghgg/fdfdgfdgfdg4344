const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Session setup for Google OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// URL rewriting to hide .html extensions - MUST come before static
app.use((req, res, next) => {
  // If path has .html extension, redirect to clean URL
  if (req.path.endsWith('.html')) {
    const cleanPath = req.path.slice(0, -5); // Remove .html
    return res.redirect(301, cleanPath);
  }
  // If path doesn't have an extension and isn't a file, try adding .html
  if (!path.extname(req.path) && req.path !== '/') {
    const htmlPath = path.join(__dirname, req.path + '.html');
    if (require('fs').existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
  }
  next();
});

// Serve static files (but not .html files - they're handled above)
app.use(express.static(path.join(__dirname), {
  extensions: ['html']
}));

// Database setup for Railway
let pool = null;
let dbConnected = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
  });
  
  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });
} else {
  console.log('⚠️ No DATABASE_URL - using in-memory storage');
}

// Initialize database tables
async function initDatabase() {
  if (!pool) {
    console.log('⚠️ No database pool - using in-memory storage');
    return;
  }
  
  try {
    // Test connection first
    await pool.query('SELECT NOW()');
    dbConnected = true;
    console.log('✅ Database connected');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(50) PRIMARY KEY,
        password VARCHAR(100) NOT NULL,
        robux INTEGER DEFAULT 100,
        isadmin BOOLEAN DEFAULT FALSE,
        banned BOOLEAN DEFAULT FALSE,
        banreason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reported_user VARCHAR(50) NOT NULL,
        reporter VARCHAR(50) NOT NULL,
        reason TEXT NOT NULL,
        message_id BIGINT,
        status VARCHAR(20) DEFAULT 'pending',
        action VARCHAR(20),
        handled_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        handled_at TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        crypto VARCHAR(10) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        fee DECIMAL(15,2) NOT NULL,
        net_amount DECIMAL(15,2) NOT NULL,
        crypto_amount VARCHAR(50) NOT NULL,
        wallet_address TEXT NOT NULL,
        rate DECIMAL(20,10) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        tx_hash VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Create default admin Flux18459 if not exists
    const adminResult = await pool.query('SELECT * FROM users WHERE username = $1', ['Flux18459']);
    if (adminResult.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (username, password, robux, isadmin) VALUES ($1, $2, $3, $4)',
        ['Flux18459', 'Flux18459', 999999999, true]
      );
      console.log('✅ Admin account Flux18459 created');
    }
    
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
    console.log('⚠️ Falling back to in-memory storage');
    dbConnected = false;
  }
}

// In-memory fallback storage
const memoryUsers = new Map();

// User storage wrapper with fallback
const users = {
  async get(username) {
    if (!dbConnected) {
      return memoryUsers.get(username) || null;
    }
    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      return result.rows[0] || null;
    } catch (err) {
      console.error('Error getting user:', err);
      return memoryUsers.get(username) || null;
    }
  },
  
  async set(username, data) {
    if (!dbConnected) {
      memoryUsers.set(username, { ...data, username });
      return data;
    }
    try {
      const result = await pool.query(
        `INSERT INTO users (username, password, robux, isadmin, banned, banreason) 
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (username) 
         DO UPDATE SET password = $2, robux = $3, isadmin = $4, banned = $5, banreason = $6
         RETURNING *`,
        [username, data.password, data.robux || 100, data.isadmin || false, data.banned || false, data.banreason || null]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Error setting user:', err);
      memoryUsers.set(username, { ...data, username });
      return data;
    }
  },
  
  async getAll() {
    if (!dbConnected) {
      return Array.from(memoryUsers.values());
    }
    try {
      const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return result.rows;
    } catch (err) {
      console.error('Error getting all users:', err);
      return Array.from(memoryUsers.values());
    }
  }
};

// Initialize admin in memory if no database
if (!process.env.DATABASE_URL) {
  memoryUsers.set('Flux18459', {
    username: 'Flux18459',
    password: 'Flux18459',
    robux: 999999999,
    isadmin: true,
    banned: false
  });
  console.log('✅ Admin account Flux18459 created in memory');
}

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const username = email.split('@')[0]; // Use email prefix as username
      
      // Check if user exists
      let user = await users.get(username);
      
      if (!user) {
        // Create new user from Google
        user = {
          username: username,
          password: 'google-oauth-' + uuidv4(), // Random password
          robux: 100, // Starting bonus
          isadmin: false,
          banned: false,
          email: email,
          googleId: profile.id
        };
        await users.set(username, user);
        console.log('✅ New Google user created:', username);
      }
      
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }));
  
  passport.serializeUser((user, done) => {
    done(null, user.username);
  });
  
  passport.deserializeUser(async (username, done) => {
    try {
      const user = await users.get(username);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
  
  console.log('✅ Google OAuth configured');
}

// Google OAuth Routes
app.get('/auth/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).send('Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
    }
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
      if (err) {
        console.error('Google auth error:', err);
        return res.status(500).send('Authentication error: ' + err.message);
      }
      if (!user) {
        return res.redirect('/login.html?error=google_failed');
      }
      req.logIn(user, (err) => {
        if (err) {
          console.error('Login error:', err);
          return res.status(500).send('Login error: ' + err.message);
        }
        res.redirect('/dashboard.html?login=success&username=' + encodeURIComponent(user.username));
      });
    })(req, res, next);
  }
);

// Check Google OAuth status
app.get('/api/auth/google-status', (req, res) => {
  res.json({
    enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    clientId: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'missing'
  });
});

// Chat history (in-memory, resets on server restart)
const chatHistory = [];
const maxHistory = 100;

// Connected users
const connectedUsers = new Map();

// Generate random username for guests
function generateGuestName() {
  const adjectives = ['Lucky', 'Pro', 'Swift', 'Mega', 'Super', 'Hyper', 'Cool', 'Fast'];
  const nouns = ['Gamer', 'Player', 'Winner', 'Roller', 'Bettor', 'Spinner', 'Flipper'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999);
  return `${adj}${noun}${num}`;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  const guestName = generateGuestName();
  const userId = uuidv4();
  
  connectedUsers.set(socket.id, {
    id: userId,
    username: guestName,
    socketId: socket.id
  });
  
  console.log(`User connected: ${guestName} (${socket.id})`);
  
  // Send chat history to new user
  socket.emit('chat history', chatHistory);
  
  // Send online count
  io.emit('online count', connectedUsers.size);
  
  // Broadcast user joined (without showing in chat, just for admin)
  socket.broadcast.emit('user joined', { username: guestName });
  
  // Handle chat message
  socket.on('chat message', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    const message = {
      id: Date.now(),
      username: user.username,
      text: data.text.substring(0, 200), // Limit message length
      timestamp: new Date().toISOString(),
      avatar: data.avatar || '👤'
    };
    
    // Add to history
    chatHistory.push(message);
    if (chatHistory.length > maxHistory) {
      chatHistory.shift();
    }
    
    // Broadcast to all users
    io.emit('chat message', message);
  });
  
  // Handle win announcement
  socket.on('win', (data) => {
    const winMessage = {
      id: Date.now(),
      type: 'win',
      username: data.username,
      game: data.game,
      amount: data.amount,
      multiplier: data.multiplier,
      text: `🎉 ${data.username} won ${data.amount} R$ in ${data.game}! (${data.multiplier})`,
      timestamp: new Date().toISOString()
    };
    
    chatHistory.push(winMessage);
    if (chatHistory.length > maxHistory) chatHistory.shift();
    
    io.emit('win', winMessage);
  });
  
  // Handle username change
  socket.on('set username', (username) => {
    const user = connectedUsers.get(socket.id);
    if (user && username && username.length >= 3 && username.length <= 20) {
      const oldName = user.username;
      user.username = username.substring(0, 20);
      
      // Notify user of change
      socket.emit('username changed', user.username);
      
      // Notify others
      socket.broadcast.emit('user renamed', {
        oldName: oldName,
        newName: user.username
      });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      console.log(`User disconnected: ${user.username}`);
      connectedUsers.delete(socket.id);
      io.emit('online count', connectedUsers.size);
    }
  });
});

// Game storage
const activeGames = new Map();
const gameHistory = [];

// Middleware to parse JSON
app.use(express.json());

// Auth middleware
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const username = authHeader.substring(7);
  const user = await users.get(username);
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  req.user = user;
  next();
}

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  // Check if user exists
  const existingUser = await users.get(username);
  if (existingUser) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  
  await users.set(username, {
    username,
    password,
    robux: 100, // Starting bonus
    created: new Date().toISOString()
  });
  
  res.json({ success: true, message: 'Account created!' });
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await users.get(username);
  
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  res.json({
    success: true,
    username: user.username,
    robux: user.robux
  });
});

// Get balance
app.get('/api/user/balance', authMiddleware, (req, res) => {
  res.json({ balance: req.user.robux });
});

// Game betting endpoint
app.post('/api/game/bet', authMiddleware, (req, res) => {
  const { game, bet, ...gameData } = req.body;
  const user = req.user;
  
  if (!bet || bet < 1 || bet > user.robux) {
    return res.status(400).json({ error: 'Invalid bet amount' });
  }
  
  // Deduct bet
  user.robux -= bet;
  
  // Create game session
  const gameId = uuidv4();
  const gameSession = {
    id: gameId,
    username: user.username,
    game,
    bet,
    startTime: Date.now(),
    data: gameData,
    multiplier: 1,
    active: true
  };
  
  // Game-specific initialization
  switch(game) {
    case 'mines':
      const mineCount = gameData.mines || 3;
      const positions = Array.from({length: 25}, (_, i) => i);
      gameSession.mines = [];
      for (let i = 0; i < mineCount; i++) {
        const idx = Math.floor(Math.random() * positions.length);
        gameSession.mines.push(positions.splice(idx, 1)[0]);
      }
      gameSession.revealed = [];
      break;
      
    case 'crash':
      // Crash point between 1.01x and 20x with house edge
      gameSession.crashPoint = Math.max(1.01, 0.99 / Math.random());
      break;
      
    case 'dice':
    case 'roll':
      // Pre-determine result
      gameSession.result = Math.random();
      break;
      
    case 'cups':
      gameSession.winningCup = Math.floor(Math.random() * 2);
      break;
      
    case 'plinko':
      // Simulate path
      let position = Math.floor(Math.random() * 3);
      for (let i = 0; i < 12; i++) {
        position += Math.random() < 0.5 ? 0 : 1;
      }
      gameSession.finalPosition = position;
      break;
      
    case 'slide':
      gameSession.crashPoint = 1.5 + Math.random() * 13.5;
      break;
      
    case 'slots':
      // Generate results
      gameSession.reels = [
        Math.floor(Math.random() * 7),
        Math.floor(Math.random() * 7),
        Math.floor(Math.random() * 7)
      ];
      break;
      
    case 'blackjack':
      // Deal cards
      const deck = createDeck();
      gameSession.playerHand = [deck.pop(), deck.pop()];
      gameSession.dealerHand = [deck.pop(), deck.pop()];
      gameSession.deck = deck;
      break;
  }
  
  activeGames.set(gameId, gameSession);
  
  res.json({
    success: true,
    gameId,
    balance: user.robux,
    ...getGameState(gameSession)
  });
});

// Game cashout endpoint
app.post('/api/game/cashout', authMiddleware, (req, res) => {
  const { gameId, multiplier, ...data } = req.body;
  const user = req.user;
  
  const game = activeGames.get(gameId);
  if (!game || game.username !== user.username) {
    return res.status(400).json({ error: 'Game not found' });
  }
  
  if (!game.active) {
    return res.status(400).json({ error: 'Game already ended' });
  }
  
  game.active = false;
  
  // Calculate win
  const winMultiplier = multiplier || game.multiplier || 1;
  const winAmount = Math.floor(game.bet * winMultiplier);
  
  // Add winnings
  user.robux += winAmount;
  
  // Record history
  gameHistory.unshift({
    id: uuidv4(),
    username: user.username,
    game: game.game,
    bet: game.bet,
    win: winAmount,
    multiplier: winMultiplier,
    timestamp: new Date().toISOString()
  });
  
  activeGames.delete(gameId);
  
  res.json({
    success: true,
    winAmount,
    multiplier: winMultiplier,
    balance: user.robux
  });
});

// Game action endpoint (hit, stand, reveal, etc)
app.post('/api/game/action', authMiddleware, (req, res) => {
  const { gameId, action, data } = req.body;
  const user = req.user;
  
  const game = activeGames.get(gameId);
  if (!game || game.username !== user.username) {
    return res.status(400).json({ error: 'Game not found' });
  }
  
  if (!game.active) {
    return res.status(400).json({ error: 'Game already ended' });
  }
  
  let result = {};
  
  switch(game.game) {
    case 'mines':
      if (action === 'reveal') {
        const index = data.index;
        if (game.mines.includes(index)) {
          // Hit mine - game over
          game.active = false;
          result = { hitMine: true, mines: game.mines };
          activeGames.delete(gameId);
        } else {
          game.revealed.push(index);
          // Calculate multiplier
          const safeTiles = 25 - game.mines.length;
          const mineBonus = Math.pow(1.15, game.mines.length);
          const progressBonus = 1 + (game.revealed.length / safeTiles) * 2;
          game.multiplier = mineBonus * progressBonus;
          result = { 
            safe: true, 
            multiplier: game.multiplier,
            revealed: game.revealed
          };
        }
      }
      break;
      
    case 'blackjack':
      if (action === 'hit') {
        game.playerHand.push(game.deck.pop());
        const value = calculateHandValue(game.playerHand);
        if (value > 21) {
          game.active = false;
          result = { bust: true, value, dealerHand: game.dealerHand };
          activeGames.delete(gameId);
        } else {
          result = { hand: game.playerHand, value };
        }
      } else if (action === 'stand') {
        // Dealer plays
        let dealerValue = calculateHandValue(game.dealerHand);
        while (dealerValue < 17) {
          game.dealerHand.push(game.deck.pop());
          dealerValue = calculateHandValue(game.dealerHand);
        }
        
        const playerValue = calculateHandValue(game.playerHand);
        
        let win = null;
        if (dealerValue > 21) win = true;
        else if (playerValue > dealerValue) win = true;
        else if (playerValue < dealerValue) win = false;
        else win = null; // Push
        
        game.active = false;
        result = {
          win,
          playerValue,
          dealerValue,
          playerHand: game.playerHand,
          dealerHand: game.dealerHand
        };
        activeGames.delete(gameId);
      }
      break;
  }
  
  res.json({
    success: true,
    active: game.active,
    balance: user.robux,
    ...result
  });
});

// Get game history
app.get('/api/game/history', authMiddleware, (req, res) => {
  const { game, limit = 20 } = req.query;
  const userGames = gameHistory
    .filter(h => h.username === req.user.username && (!game || h.game === game))
    .slice(0, parseInt(limit));
  res.json(userGames);
});

// Helper functions
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let suit of suits) {
    for (let value of values) {
      deck.push({ suit, value, numValue: getCardValue(value) });
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(value) {
  if (['J', 'Q', 'K'].includes(value)) return 10;
  if (value === 'A') return 11;
  return parseInt(value);
}

function calculateHandValue(hand) {
  let value = hand.reduce((sum, card) => sum + card.numValue, 0);
  let aces = hand.filter(c => c.value === 'A').length;
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function getGameState(game) {
  switch(game.game) {
    case 'mines':
      return { mines: game.mines.length, revealed: game.revealed };
    case 'blackjack':
      return { 
        playerHand: game.playerHand,
        dealerHand: [game.dealerHand[0]], // Hide second card
        playerValue: calculateHandValue(game.playerHand)
      };
    default:
      return {};
  }
}

// Public API routes
app.get('/api/online', (req, res) => {
  res.json({ count: connectedUsers.size });
});

app.get('/api/chat', (req, res) => {
  res.json(chatHistory);
});

// Chat API for Railway (POST message)
app.post('/api/chat/send', (req, res) => {
  const { username, text, avatar } = req.body;
  
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Message required' });
  }
  
  const message = {
    id: uuidv4(),
    username: username || 'Guest',
    text: text.substring(0, 200),
    avatar: avatar || '👤',
    timestamp: new Date().toISOString()
  };
  
  // Add to history
  chatHistory.push(message);
  if (chatHistory.length > maxHistory) {
    chatHistory.shift();
  }
  
  // Broadcast via Socket.io if available
  io.emit('chat message', message);
  
  res.json({ success: true, message });
});

// Serve dashboard as main page when logged in
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Reports & Bans System
const reports = [];
const reportIdCounter = { value: 1 };
const bans = new Map(); // username -> ban info

// Reports API Routes
app.post('/api/report', (req, res) => {
  const { reportedUser, reporter, reason, messageId } = req.body;
  
  if (!reportedUser || !reporter || !reason) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const report = {
    id: reportIdCounter.value++,
    reportedUser,
    reporter,
    reason,
    messageId: messageId || null,
    status: 'pending',
    timestamp: new Date().toISOString(),
    handledBy: null,
    handledAt: null,
    action: null
  };
  
  reports.unshift(report);
  
  // Keep only last 100 reports
  if (reports.length > 100) {
    reports.pop();
  }
  
  res.json({ success: true, reportId: report.id });
});

app.get('/api/reports', (req, res) => {
  const { status } = req.query;
  let result = reports;
  
  if (status) {
    result = reports.filter(r => r.status === status);
  }
  
  res.json(result.slice(0, 50));
});

app.post('/api/reports/:id/resolve', async (req, res) => {
  const { action, adminUsername } = req.body;
  const reportId = parseInt(req.params.id);
  
  const report = reports.find(r => r.id === reportId);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  
  report.status = 'resolved';
  report.action = action;
  report.handledBy = adminUsername;
  report.handledAt = new Date().toISOString();
  
  // If banning, add to bans
  if (action === 'ban') {
    const user = await users.get(report.reportedUser);
    if (user) {
      user.banned = true;
      user.banReason = `Banned for: ${report.reason}`;
      await users.set(report.reportedUser, user);
      bans.set(report.reportedUser, {
        username: report.reportedUser,
        reason: report.reason,
        bannedBy: adminUsername,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  res.json({ success: true, report });
});

// Bans API Routes
app.get('/api/bans', (req, res) => {
  const bannedUsers = Array.from(bans.values());
  res.json(bannedUsers);
});

app.post('/api/bans/:username', async (req, res) => {
  const { reason, bannedBy } = req.body;
  const username = req.params.username;
  
  const user = await users.get(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  user.banned = true;
  user.banReason = reason;
  await users.set(username, user);
  
  bans.set(username, {
    username,
    reason,
    bannedBy,
    timestamp: new Date().toISOString()
  });
  
  res.json({ success: true });
});

app.delete('/api/bans/:username', async (req, res) => {
  const username = req.params.username;
  const user = await users.get(username);
  
  if (user) {
    delete user.banned;
    delete user.banReason;
    await users.set(username, user);
  }
  
  bans.delete(username);
  res.json({ success: true });
});

app.get('/api/bans/:username', async (req, res) => {
  const username = req.params.username;
  const user = await users.get(username);
  
  if (user && user.banned) {
    res.json({
      banned: true,
      reason: user.banReason,
      username
    });
  } else {
    res.json({ banned: false });
  }
});

// Admin Give R$ API
app.post('/api/admin/give-robux', async (req, res) => {
  try {
    const { username, amount, adminUsername } = req.body;
    
    if (!username || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid username or amount' });
    }
    
    // Check if admin exists and is actually admin
    const admin = await users.get(adminUsername);
    if (!admin) {
      return res.status(403).json({ error: 'Admin not found' });
    }
    if (!admin.isadmin) {
      return res.status(403).json({ error: 'Not authorized - not an admin' });
    }
    
    const user = await users.get(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Add R$ to user
    user.robux = (user.robux || 0) + amount;
    await users.set(username, user);
    
    res.json({ 
      success: true, 
      message: `Gave ${amount} R$ to ${username}`,
      newBalance: user.robux
    });
  } catch (err) {
    console.error('Give R$ error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Get all users (for admin)
app.get('/api/admin/users', async (req, res) => {
  const { admin } = req.query;
  const adminUser = await users.get(admin);
  
  if (!adminUser || !adminUser.isadmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const allUsersDb = await users.getAll();
  const allUsers = allUsersDb.map(u => ({
    username: u.username,
    robux: u.robux,
    isAdmin: u.isadmin || false,
    banned: u.banned || false,
    created: u.created_at
  }));
  
  res.json(allUsers);
});

// Withdrawal System
const withdrawals = [];
const withdrawalIdCounter = { value: 1 };

// Withdrawal API Routes
app.post('/api/withdraw', async (req, res) => {
  const { username, crypto, amount, walletAddress, rate, token } = req.body;
  
  if (!username || !crypto || !amount || !walletAddress || !rate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Validate minimum amount
  if (amount < 10) {
    return res.status(400).json({ error: 'Minimum withdrawal is 10 R$' });
  }
  
  // Check user balance
  const user = await users.get(username);
  if (!user || user.robux < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  
  // Calculate crypto amount (1% fee)
  const fee = amount * 0.01;
  const netAmount = amount - fee;
  const cryptoAmount = (netAmount * rate).toFixed(8);
  
  // Create withdrawal record
  const withdrawal = {
    id: withdrawalIdCounter.value++,
    username,
    crypto,
    amount,
    fee,
    netAmount,
    cryptoAmount,
    walletAddress,
    rate,
    status: 'pending',
    txHash: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  
  withdrawals.unshift(withdrawal);
  
  // Deduct balance and save
  user.robux -= amount;
  await users.set(username, user);
  
  // Simulate processing - auto-complete after 30 seconds (for demo)
  setTimeout(() => {
    const w = withdrawals.find(x => x.id === withdrawal.id);
    if (w && w.status === 'pending') {
      w.status = 'completed';
      w.txHash = generateTxHash(crypto);
      w.completedAt = new Date().toISOString();
    }
  }, 30000);
  
  res.json({
    success: true,
    withdrawalId: withdrawal.id,
    cryptoAmount,
    status: 'pending',
    message: 'Withdrawal submitted successfully'
  });
});

app.get('/api/withdraw/history', (req, res) => {
  const { username, token } = req.query;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  const userWithdrawals = withdrawals
    .filter(w => w.username === username)
    .slice(0, 20);
  
  res.json(userWithdrawals);
});

app.get('/api/withdraw/status/:id', (req, res) => {
  const withdrawal = withdrawals.find(w => w.id === parseInt(req.params.id));
  
  if (!withdrawal) {
    return res.status(404).json({ error: 'Withdrawal not found' });
  }
  
  res.json({
    id: withdrawal.id,
    status: withdrawal.status,
    txHash: withdrawal.txHash,
    completedAt: withdrawal.completedAt
  });
});

// Helper function to generate fake transaction hash
function generateTxHash(crypto) {
  const chars = '0123456789abcdef';
  let hash = '';
  const length = crypto === 'BTC' ? 64 : crypto === 'ETH' || crypto === 'USDT' ? 66 : 64;
  for (let i = 0; i < length; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

// Baccarat Games
const baccaratHistory = [];
const maxBaccaratHistory = 50;

// Baccarat Helper Functions
function createBaccaratDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (let suit of suits) {
    for (let value of values) {
      let numValue = 0;
      if (value === 'A') numValue = 1;
      else if (['J', 'Q', 'K', '10'].includes(value)) numValue = 0;
      else numValue = parseInt(value);
      
      deck.push({ suit, value, numValue });
    }
  }
  
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

function calculateBaccaratValue(hand) {
  let value = 0;
  for (let card of hand) {
    value += card.numValue;
  }
  return value % 10;
}

// Baccarat API Routes
app.post('/api/baccarat/deal', (req, res) => {
  const { username, bet, betAmount, token } = req.body;
  
  if (!username || !bet || !betAmount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const deck = createBaccaratDeck();
  
  // Deal initial hands
  let playerHand = [deck.pop(), deck.pop()];
  let bankerHand = [deck.pop(), deck.pop()];
  
  const playerValue = calculateBaccaratValue(playerHand);
  const bankerValue = calculateBaccaratValue(bankerHand);
  
  // Natural win check
  let gameOver = false;
  let result = null;
  
  if (playerValue >= 8 || bankerValue >= 8) {
    gameOver = true;
    if (playerValue > bankerValue) result = 'player';
    else if (bankerValue > playerValue) result = 'banker';
    else result = 'tie';
  }
  
  // Player third card rule
  if (!gameOver && playerValue <= 5) {
    playerHand.push(deck.pop());
  }
  
  const finalPlayerValue = calculateBaccaratValue(playerHand);
  
  // Banker third card rule (simplified)
  if (!gameOver) {
    if (bankerValue <= 5) {
      bankerHand.push(deck.pop());
    }
  }
  
  const finalBankerValue = calculateBaccaratValue(bankerHand);
  
  // Determine winner
  if (!gameOver) {
    if (finalPlayerValue > finalBankerValue) result = 'player';
    else if (finalBankerValue > finalPlayerValue) result = 'banker';
    else result = 'tie';
  }
  
  // Calculate win
  let win = false;
  let winAmount = 0;
  
  if (bet === result) {
    win = true;
    if (result === 'player') winAmount = betAmount * 2;
    else if (result === 'banker') winAmount = Math.floor(betAmount * 1.95);
    else if (result === 'tie') winAmount = betAmount * 9;
  }
  
  // Add to history
  baccaratHistory.unshift({
    username,
    playerHand: playerHand.length,
    bankerHand: bankerHand.length,
    playerValue: finalPlayerValue,
    bankerValue: finalBankerValue,
    result,
    bet,
    betAmount,
    win,
    winAmount,
    timestamp: new Date().toISOString()
  });
  
  if (baccaratHistory.length > maxBaccaratHistory) {
    baccaratHistory.shift();
  }
  
  res.json({
    success: true,
    playerHand,
    bankerHand,
    playerValue: finalPlayerValue,
    bankerValue: finalBankerValue,
    result,
    win,
    winAmount
  });
});

app.get('/api/baccarat/history', (req, res) => {
  res.json(baccaratHistory.slice(0, 20));
});

// Roulette Games
const rouletteHistory = [];
const maxRouletteHistory = 50;

// Roulette API Routes
app.post('/api/roulette/spin', (req, res) => {
  const { username, bet, betType, betAmount, token } = req.body;
  
  if (!username || !bet || !betAmount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Roulette wheel numbers
  const wheelNumbers = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  
  // Spin
  const result = wheelNumbers[Math.floor(Math.random() * wheelNumbers.length)];
  const resultColor = result === 0 ? 'green' : redNumbers.includes(result) ? 'red' : 'black';
  
  // Check win
  let win = false;
  let multiplier = 0;
  
  if (bet === 'red' && resultColor === 'red') {
    win = true;
    multiplier = 2;
  } else if (bet === 'black' && resultColor === 'black') {
    win = true;
    multiplier = 2;
  } else if (bet === 'even' && result !== 0 && result % 2 === 0) {
    win = true;
    multiplier = 2;
  } else if (bet === 'odd' && result % 2 === 1) {
    win = true;
    multiplier = 2;
  } else if (bet == result) {
    win = true;
    multiplier = 36;
  }
  
  const winAmount = win ? Math.floor(betAmount * multiplier) : 0;
  
  // Add to history
  rouletteHistory.unshift({
    username,
    result,
    color: resultColor,
    bet,
    betAmount,
    win,
    winAmount,
    timestamp: new Date().toISOString()
  });
  
  if (rouletteHistory.length > maxRouletteHistory) {
    rouletteHistory.shift();
  }
  
  res.json({
    success: true,
    result,
    color: resultColor,
    win,
    winAmount,
    multiplier
  });
});

app.get('/api/roulette/history', (req, res) => {
  res.json(rouletteHistory.slice(0, 20));
});

// Blackjack Multiplayer Games
const blackjackGames = new Map();
const waitingPlayers = [];

// Create deck for blackjack
function createBlackjackDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  
  for (let suit of suits) {
    for (let value of values) {
      let numValue = parseInt(value);
      if (['J', 'Q', 'K'].includes(value)) numValue = 10;
      if (value === 'A') numValue = 11;
      deck.push({ suit, value, numValue });
    }
  }
  
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

// Blackjack Multiplayer API Routes
app.post('/api/blackjack/join', (req, res) => {
  const { username, token } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  
  // Check if there's a waiting player
  if (waitingPlayers.length > 0 && waitingPlayers[0].username !== username) {
    const opponent = waitingPlayers.shift();
    const gameId = uuidv4();
    
    // Create new game
    const deck = createBlackjackDeck();
    const player1Hand = [deck.pop(), deck.pop()];
    const player2Hand = [deck.pop(), deck.pop()];
    
    blackjackGames.set(gameId, {
      id: gameId,
      player1: opponent.username,
      player2: username,
      player1Hand: player1Hand,
      player2Hand: player2Hand,
      deck: deck,
      currentPlayer: opponent.username,
      gameOver: false,
      winner: null,
      player1Stand: false,
      player2Stand: false
    });
    
    // Notify both players via socket if possible
    io.emit('blackjack match found', { gameId, opponent: opponent.username });
    
    res.json({
      success: true,
      gameId: gameId,
      opponentJoined: true,
      opponentName: opponent.username,
      playerHand: player2Hand,
      opponentHand: player1Hand,
      currentPlayer: opponent.username
    });
  } else {
    // Add to waiting list
    waitingPlayers.push({ username, timestamp: Date.now() });
    
    res.json({
      success: true,
      gameId: null,
      opponentJoined: false
    });
  }
});

app.get('/api/blackjack/status/:gameId', (req, res) => {
  const { gameId } = req.params;
  const game = blackjackGames.get(gameId);
  
  if (!game) {
    // Check if still waiting
    const waiting = waitingPlayers.find(p => p.username === req.query.username);
    if (waiting) {
      return res.json({ waiting: true });
    }
    return res.status(404).json({ error: 'Game not found' });
  }
  
  res.json({
    opponentJoined: true,
    opponentName: game.player1 === req.query.username ? game.player2 : game.player1,
    playerHand: req.query.username === game.player1 ? game.player1Hand : game.player2Hand,
    opponentHand: req.query.username === game.player1 ? game.player2Hand : game.player1Hand,
    currentPlayer: game.currentPlayer,
    gameOver: game.gameOver,
    winner: game.winner
  });
});

app.get('/api/blackjack/state/:gameId', (req, res) => {
  const { gameId } = req.params;
  const game = blackjackGames.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  const username = req.query.username;
  const isPlayer1 = username === game.player1;
  
  res.json({
    playerHand: isPlayer1 ? game.player1Hand : game.player2Hand,
    opponentHand: isPlayer1 ? game.player2Hand : game.player1Hand,
    currentPlayer: game.currentPlayer,
    gameOver: game.gameOver,
    winner: game.winner
  });
});

app.post('/api/blackjack/hit', (req, res) => {
  const { gameId, username } = req.body;
  const game = blackjackGames.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (game.currentPlayer !== username) {
    return res.status(400).json({ error: 'Not your turn' });
  }
  
  const isPlayer1 = username === game.player1;
  const hand = isPlayer1 ? game.player1Hand : game.player2Hand;
  
  // Deal card
  hand.push(game.deck.pop());
  
  // Check for bust
  let value = 0;
  let aces = 0;
  for (let card of hand) {
    value += card.numValue;
    if (card.value === 'A') aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  const bust = value > 21;
  
  if (bust) {
    game.gameOver = true;
    game.winner = isPlayer1 ? game.player2 : game.player1;
  } else {
    // Switch turns
    game.currentPlayer = isPlayer1 ? game.player2 : game.player1;
  }
  
  res.json({
    success: true,
    hand: hand,
    bust: bust,
    currentPlayer: game.currentPlayer
  });
});

app.post('/api/blackjack/stand', (req, res) => {
  const { gameId, username } = req.body;
  const game = blackjackGames.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  const isPlayer1 = username === game.player1;
  
  if (isPlayer1) {
    game.player1Stand = true;
  } else {
    game.player2Stand = true;
  }
  
  // Check if both stood
  if (game.player1Stand && game.player2Stand) {
    // Calculate final values
    let p1Value = 0, p2Value = 0, p1Aces = 0, p2Aces = 0;
    
    for (let card of game.player1Hand) {
      p1Value += card.numValue;
      if (card.value === 'A') p1Aces++;
    }
    while (p1Value > 21 && p1Aces > 0) {
      p1Value -= 10;
      p1Aces--;
    }
    
    for (let card of game.player2Hand) {
      p2Value += card.numValue;
      if (card.value === 'A') p2Aces++;
    }
    while (p2Value > 21 && p2Aces > 0) {
      p2Value -= 10;
      p2Aces--;
    }
    
    game.gameOver = true;
    
    if (p1Value > 21 && p2Value > 21) {
      game.winner = 'tie';
    } else if (p1Value > 21) {
      game.winner = game.player2;
    } else if (p2Value > 21) {
      game.winner = game.player1;
    } else if (p1Value === p2Value) {
      game.winner = 'tie';
    } else if (p1Value > p2Value) {
      game.winner = game.player1;
    } else {
      game.winner = game.player2;
    }
  } else {
    // Switch turns
    game.currentPlayer = isPlayer1 ? game.player2 : game.player1;
  }
  
  res.json({
    success: true,
    currentPlayer: game.currentPlayer,
    gameOver: game.gameOver,
    winner: game.winner
  });
});

app.post('/api/blackjack/leave/:gameId', (req, res) => {
  const { gameId } = req.params;
  const { username } = req.body;
  
  // Remove from waiting list if present
  const waitingIndex = waitingPlayers.findIndex(p => p.username === username);
  if (waitingIndex > -1) {
    waitingPlayers.splice(waitingIndex, 1);
  }
  
  // End game if in progress
  const game = blackjackGames.get(gameId);
  if (game) {
    game.gameOver = true;
    game.winner = game.player1 === username ? game.player2 : game.player1;
    blackjackGames.delete(gameId);
  }
  
  res.json({ success: true });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Setup endpoint - creates admin account if missing
app.get('/api/setup', async (req, res) => {
  try {
    // Check if admin exists
    const adminResult = await pool.query('SELECT * FROM users WHERE username = $1', ['Flux18459']);
    if (adminResult.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (username, password, robux, isadmin) VALUES ($1, $2, $3, $4)',
        ['Flux18459', 'Flux18459', 999999999, true]
      );
      res.json({ success: true, message: 'Admin account Flux18459 created' });
    } else {
      res.json({ success: true, message: 'Admin account already exists' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server after database init
async function startServer() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`✅ LuckBlox server running on port ${PORT}`);
    console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
    console.log(`🎮 Games: http://localhost:${PORT}/dashboard.html`);
  });
}

startServer();
