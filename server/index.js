const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1); // needed to get real client IP behind Render's proxy
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isProd ? true : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// roomCode -> { text: string, clients: Set<socketId>, allowedIPs: Set<string> | null }
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function cleanupRoom(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (room && room.clients.size === 0) rooms.delete(code);
  }, 30 * 60 * 1000);
}

// Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:1.2.3.4 → 1.2.3.4)
function normalizeIP(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

function isIPAllowed(room, ip) {
  if (!room.allowedIPs) return true;
  return room.allowedIPs.has(normalizeIP(ip));
}

app.get('/api/my-ip', (req, res) => {
  res.json({ ip: normalizeIP(req.ip) });
});

app.post('/api/create-room', (req, res) => {
  const rawName = req.body?.name;
  const rawIPs = req.body?.allowedIps;
  let code;
  if (rawName) {
    code = String(rawName).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    if (!code) return res.status(400).json({ error: 'Invalid room name' });
    if (rooms.has(code)) return res.status(409).json({ error: 'Room name already taken' });
  } else {
    do { code = generateCode(); } while (rooms.has(code));
  }

  let allowedIPs = null;
  if (Array.isArray(rawIPs) && rawIPs.length > 0) {
    const creatorIP = normalizeIP(req.ip);
    const extras = rawIPs.map(ip => normalizeIP(String(ip).trim())).filter(Boolean);
    allowedIPs = new Set([creatorIP, ...extras]);
  }

  rooms.set(code, { text: '', clients: new Set(), allowedIPs });
  res.json({ code });
});

app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!isIPAllowed(room, req.ip)) return res.status(403).json({ error: 'Your IP address is not allowed in this room' });
  res.json({ code, clients: room.clients.size });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (rawCode) => {
    const code = String(rawCode).toUpperCase().slice(0, 20);
    if (!rooms.has(code)) {
      socket.emit('room-error', 'Room not found');
      return;
    }
    const room = rooms.get(code);
    if (!isIPAllowed(room, socket.handshake.address)) {
      socket.emit('room-error', 'Your IP address is not allowed in this room');
      return;
    }
    currentRoom = code;
    socket.join(code);
    room.clients.add(socket.id);

    socket.emit('text-update', room.text);
    io.to(code).emit('client-count', room.clients.size);
  });

  socket.on('update-text', (text) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    rooms.get(currentRoom).text = String(text).slice(0, 500_000);
    socket.to(currentRoom).emit('text-update', rooms.get(currentRoom).text);
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;
    rooms.get(currentRoom).clients.delete(socket.id);
    io.to(currentRoom).emit('client-count', rooms.get(currentRoom).clients.size);
    cleanupRoom(currentRoom);
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (isProd) {
  const distPath = path.join(__dirname, '../client/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`ClipSync server running on http://localhost:${PORT}`));
