const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const isProd = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isProd ? true : ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// roomCode -> { text: string, clients: Set<socketId> }
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

app.post('/api/create-room', (req, res) => {
  let code;
  do { code = generateCode(); } while (rooms.has(code));
  rooms.set(code, { text: '', clients: new Set() });
  res.json({ code });
});

app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code, clients: room.clients.size });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (rawCode) => {
    const code = String(rawCode).toUpperCase().slice(0, 6);
    if (!rooms.has(code)) {
      socket.emit('room-error', 'Room not found');
      return;
    }
    currentRoom = code;
    socket.join(code);
    rooms.get(code).clients.add(socket.id);

    socket.emit('text-update', rooms.get(code).text);
    io.to(code).emit('client-count', rooms.get(code).clients.size);
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
