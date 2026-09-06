/**
 * PrivateQR Chat - Express & Socket.IO Server
 * Main application entry point.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const roomManager = require('./roomManager');
const registerSocketHandlers = require('./socketHandler');
const { generateRoomId, isValidRoomId } = require('./cryptoUtils');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 1. Security Headers (Helmet) with tailored CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"]
      }
    }
  })
);

// 2. CORS setup (allows dynamic origins for public tunnels & LAN devices)
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  })
);

// 3. Rate limiting for general HTTP requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// API Route: Create room
app.post('/api/rooms', (req, res) => {
  try {
    const roomId = generateRoomId();
    roomManager.createRoom(roomId);
    res.status(201).json({ success: true, roomId });
  } catch (err) {
    console.error('Error creating room:', err);
    res.status(500).json({ success: false, error: 'Failed to create room.' });
  }
});

// API Route: Check room status
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ success: false, error: 'Invalid room ID format.' });
  }

  const room = roomManager.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found or expired.' });
  }

  res.json({
    success: true,
    roomId: room.roomId,
    userCount: room.users.size,
    maxUsers: room.maxUsers,
    isFull: room.users.size >= room.maxUsers
  });
});

// Route: Join Page (serve chat.html)
app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/chat.html'));
});

// Route: Fallback to index.html for root or unknown paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 4. Initialize Socket.IO with security settings
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e5 // 100 KB max message size limit
});

// Register socket handlers
registerSocketHandlers(io);

// Start server
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`==================================================`);
  console.log(` ⚡ Zethra Server Running`);
  console.log(` Environment : ${NODE_ENV}`);
  console.log(` URL         : http://localhost:${PORT}`);
  console.log(` LAN URL     : http://10.7.8.224:${PORT}`);
  console.log(` Max Users/Room : ${process.env.MAX_ROOM_USERS || 2}`);
  console.log(`==================================================`);
});

