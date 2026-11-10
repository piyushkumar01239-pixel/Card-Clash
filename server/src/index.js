import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import { Server } from 'socket.io';
import {
  addPlayer,
  createRoom,
  drawCard,
  playCard,
  roomForPlayer,
  startRoom,
} from './game.js';

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const jwtSecret = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploy');

if (!jwtSecret) throw new Error('JWT_SECRET is required when NODE_ENV=production');

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '20kb' }));

let databaseReady = false;
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 18 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  games: { type: Number, default: 0 },
}, { timestamps: true });
const matchSchema = new mongoose.Schema({
  roomCode: { type: String, required: true },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  durationSeconds: { type: Number, required: true },
  completedAt: { type: Date, default: Date.now },
}, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Match = mongoose.models.Match || mongoose.model('Match', matchSchema);

if (process.env.MONGODB_URI) {
  const dnsServers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,1.0.0.1')
    .split(',')
    .map(server => server.trim())
    .filter(Boolean);

  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      databaseReady = true;
      console.log('MongoDB connected');
    })
    .catch(async error => {
      if (error.code !== 'ECONNREFUSED' || !String(error.message).includes('querySrv')) {
        console.error('MongoDB connection failed:', error.message);
        return;
      }

      try {
        dns.setServers(dnsServers);
        console.warn('MongoDB SRV lookup failed with system DNS; retrying with configured DNS servers.');
        await mongoose.connect(process.env.MONGODB_URI);
        databaseReady = true;
        console.log('MongoDB connected');
      } catch (retryError) {
        console.error('MongoDB connection failed after DNS retry:', retryError.message);
      }
    });
}

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});
const rooms = new Map();
const sessions = new Map();
const disconnectTimers = new Map();
const pendingSaves = new Set();
const safeName = value => String(value || 'Guest').trim().slice(0, 18) || 'Guest';
const timerKey = (code, playerId) => `${code}:${playerId}`;
const tokenFor = user => jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '30d' });

app.get('/api/health', (request, response) => {
  response.json({ ok: true, database: databaseReady, rooms: rooms.size });
});

app.post('/api/auth/register', async (request, response) => {
  if (!databaseReady) {
    return response.status(503).json({ error: 'Database is not connected. Configure MONGODB_URI.' });
  }
  const name = safeName(request.body?.name);
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = request.body?.password;
  if (!request.body?.name?.trim?.() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return response.status(400).json({ error: 'Enter a player name, valid email and password of 8–72 characters.' });
  }

  try {
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
    });
    return response.status(201).json({
      token: tokenFor(user),
      user: { id: user.id, name: user.name, email: user.email, wins: user.wins, games: user.games },
    });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: 'Email already registered.' });
    console.error('Registration failed:', error.message);
    return response.status(500).json({ error: 'Account could not be created.' });
  }
});

app.post('/api/auth/login', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ error: 'Database is not connected.' });

  try {
    const email = String(request.body?.email || '').trim().toLowerCase();
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }
    return response.json({
      token: tokenFor(user),
      user: { id: user.id, name: user.name, email: user.email, wins: user.wins, games: user.games },
    });
  } catch (error) {
    console.error('Login failed:', error.message);
    return response.status(500).json({ error: 'Could not sign in.' });
  }
});

function requireUser(request, response, next) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return response.status(401).json({ error: 'Sign in to view this profile.' });
    const payload = jwt.verify(token, jwtSecret);
    request.userId = payload.id;
    return next();
  } catch {
    return response.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });
  }
}

app.get('/api/profile', requireUser, async (request, response) => {
  if (!databaseReady) return response.status(503).json({ error: 'Database is not connected.' });
  try {
    const user = await User.findById(request.userId).select('name email wins losses games createdAt');
    if (!user) return response.status(404).json({ error: 'Player profile not found.' });
    const matches = await Match.find({ players: user._id })
      .sort({ completedAt: -1 })
      .limit(10)
      .populate('winner', 'name')
      .select('roomCode winner durationSeconds completedAt');
    return response.json({
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        wins: user.wins,
        losses: user.losses,
        games: user.games,
        winRate: user.games ? Math.round((user.wins / user.games) * 100) : 0,
      },
      recentMatches: matches,
    });
  } catch (error) {
    console.error('Profile lookup failed:', error.message);
    return response.status(500).json({ error: 'Could not load player profile.' });
  }
});

app.get('/api/leaderboard', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ error: 'Leaderboard requires a database connection.' });
  try {
    const users = await User.find({ games: { $gt: 0 } })
      .sort({ wins: -1, games: 1, name: 1 })
      .limit(20)
      .select('name wins losses games');
    return response.json(users.map((user, index) => ({
      rank: index + 1,
      id: user.id,
      name: user.name,
      wins: user.wins,
      losses: user.losses,
      games: user.games,
      winRate: Math.round((user.wins / user.games) * 100),
    })));
  } catch (error) {
    console.error('Leaderboard lookup failed:', error.message);
    return response.status(500).json({ error: 'Could not load the leaderboard.' });
  }
});

async function authenticateSocket(socket) {
  const token = socket.handshake.auth?.token;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    return databaseReady ? await User.findById(payload.id) : null;
  } catch {
    return null;
  }
}

function emitRoom(room) {
  for (const player of room.players) {
    const playerSocket = player.socketId && io.sockets.sockets.get(player.socketId);
    if (playerSocket) playerSocket.emit('room:update', roomForPlayer(room, player.id));
  }
}

function removePlayer(room, player) {
  room.players = room.players.filter(candidate => candidate.id !== player.id);
  disconnectTimers.delete(timerKey(room.code, player.id));
  if (!room.players.length) {
    rooms.delete(room.code);
    return;
  }
  if (!room.players.some(candidate => candidate.host)) room.players[0].host = true;
}

function detach(socket, { reconnectable = false } = {}) {
  const code = sessions.get(socket.id);
  if (!code) return;
  sessions.delete(socket.id);
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.find(candidate => candidate.socketId === socket.id);
  if (!player) return;

  if (reconnectable && room.status === 'playing') {
    player.socketId = null;
    player.connected = false;
    const key = timerKey(code, player.id);
    clearTimeout(disconnectTimers.get(key));
    const timer = setTimeout(() => {
      const currentRoom = rooms.get(code);
      const disconnected = currentRoom?.players.find(candidate => candidate.id === player.id);
      if (!currentRoom || !disconnected || disconnected.connected) return;
      currentRoom.status = 'finished';
      currentRoom.message = `${disconnected.name} did not reconnect. This match has ended.`;
      removePlayer(currentRoom, disconnected);
      emitRoom(currentRoom);
    }, 60_000);
    disconnectTimers.set(key, timer);
    emitRoom(room);
    return;
  }

  if (room.status === 'playing') {
    room.status = 'finished';
    room.message = `${player.name} left. This match has ended.`;
  }
  removePlayer(room, player);
  emitRoom(room);
}

function identityFor(user, guestId, socketId) {
  if (user) return { id: user.id, name: safeName(user.name) };
  const id = typeof guestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(guestId)
    ? guestId
    : socketId;
  return { id, name: 'Guest' };
}

async function saveResult(room) {
  if (!databaseReady || !room.winner || room.saved || pendingSaves.has(room.code)) return;
  pendingSaves.add(room.code);
  try {
    const playerIds = room.players
      .map(player => mongoose.isValidObjectId(player.id) ? player.id : null)
      .filter(Boolean);
    const winnerId = playerIds.includes(room.winner) ? room.winner : null;
    if (playerIds.length) {
      await Match.create({
        roomCode: room.code,
        winner: winnerId,
        players: playerIds,
        durationSeconds: Math.max(0, Math.round((Date.now() - room.startedAt) / 1000)),
      });
      await Promise.all(playerIds.map(id => User.updateOne(
        { _id: id },
        { $inc: { games: 1, wins: id === winnerId ? 1 : 0, losses: id !== winnerId ? 1 : 0 } },
      )));
    }
    room.saved = true;
  } catch (error) {
    console.error(`Could not save result for room ${room.code}:`, error.message);
  } finally {
    pendingSaves.delete(room.code);
  }
}

io.on('connection', socket => {
  socket.on('room:create', async (payload = {}, callback = () => {}) => {
    try {
      detach(socket);
      const user = await authenticateSocket(socket);
      const identity = identityFor(user, payload.guestId, socket.id);
      let code;
      do {
        code = randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
      } while (rooms.has(code));
      const room = createRoom(code, {
        ...identity,
        name: user ? identity.name : safeName(payload.name),
        socketId: socket.id,
      });
      rooms.set(code, room);
      sessions.set(socket.id, code);
      socket.join(code);
      callback({ ok: true, room: roomForPlayer(room, identity.id) });
      emitRoom(room);
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', async (payload = {}, callback = () => {}) => {
    try {
      const room = rooms.get(String(payload.code || '').trim().toUpperCase());
      if (!room) throw new Error('Room not found');
      const user = await authenticateSocket(socket);
      const identity = identityFor(user, payload.guestId, socket.id);
      const existing = room.players.find(player => player.id === identity.id);
      if (existing) {
        if (existing.connected || room.status !== 'playing') {
          throw new Error('This player is already in the room');
        }
        const key = timerKey(room.code, existing.id);
        clearTimeout(disconnectTimers.get(key));
        disconnectTimers.delete(key);
        existing.socketId = socket.id;
        existing.connected = true;
      } else {
        addPlayer(room, {
          ...identity,
          name: user ? identity.name : safeName(payload.name),
          socketId: socket.id,
        });
      }

      detach(socket);
      sessions.set(socket.id, room.code);
      socket.join(room.code);
      callback({ ok: true, room: roomForPlayer(room, identity.id) });
      emitRoom(room);
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  socket.on('room:leave', (payload = {}, callback = () => {}) => {
    detach(socket);
    callback({ ok: true });
  });

  socket.on('game:start', (payload, callback = () => {}) => {
    try {
      const room = rooms.get(sessions.get(socket.id));
      if (!room) throw new Error('Room not found');
      if (!room.players.find(player => player.socketId === socket.id)?.host) {
        throw new Error('Only the host can start');
      }
      startRoom(room);
      emitRoom(room);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  socket.on('game:play', (payload = {}, callback = () => {}) => {
    try {
      const room = rooms.get(sessions.get(socket.id));
      if (!room) throw new Error('Room not found');
      const player = room.players.find(candidate => candidate.socketId === socket.id);
      if (!player) throw new Error('Player is not in this room');
      playCard(room, player.id, payload.cardId, payload.color);
      if (room.status === 'finished') void saveResult(room);
      emitRoom(room);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  socket.on('game:draw', (payload, callback = () => {}) => {
    try {
      const room = rooms.get(sessions.get(socket.id));
      if (!room) throw new Error('Room not found');
      const player = room.players.find(candidate => candidate.socketId === socket.id);
      if (!player) throw new Error('Player is not in this room');
      drawCard(room, player.id);
      emitRoom(room);
      callback({ ok: true });
    } catch (error) {
      callback({ ok: false, error: error.message });
    }
  });

  socket.on('disconnect', () => detach(socket, { reconnectable: true }));
});

const port = Number(process.env.PORT) || 4000;
server.listen(port, '0.0.0.0', () => console.log(`Card Clash server listening on ${port}`));
