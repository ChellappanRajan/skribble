import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const isProduction = process.env.NODE_ENV === 'production';

const WORDS = [
  'rocket', 'island', 'guitar', 'castle', 'pizza', 'umbrella', 'dragon', 'camera',
  'bridge', 'scooter', 'volcano', 'robot', 'pancake', 'snowman', 'treasure',
  'wizard', 'bicycle', 'lighthouse', 'sandwich', 'spaceship', 'waterfall'
];

const COLORS = ['#2563eb', '#ef476f', '#118ab2', '#06d6a0', '#ffb703', '#8338ec', '#f97316', '#22c55e'];
const DEFAULT_SETTINGS = {
  players: 8,
  language: 'English',
  drawTime: 80,
  rounds: 3,
  mode: 'Normal',
  wordCount: 3,
  hints: 2,
  customWords: '',
  customOnly: false
};

const rooms = new Map();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

if (isProduction) {
  app.use(express.static(join(__dirname, 'dist')));
  app.get(/.*/, (_request, response) => response.sendFile(join(__dirname, 'dist', 'index.html')));
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, settings } = {}) => {
    const room = createRoom(settings);
    joinRoom(socket, room, name, true);
  });

  socket.on('room:join', ({ code, name } = {}) => {
    const room = rooms.get(cleanCode(code));
    if (!room) {
      socket.emit('room:error', 'Room not found. Create a new room or check the invite code.');
      return;
    }
    if (room.players.length >= room.settings.players) {
      socket.emit('room:error', 'That room is full.');
      return;
    }
    joinRoom(socket, room, name, false);
  });

  socket.on('room:updateSettings', (settings = {}) => {
    const room = getSocketRoom(socket);
    if (!room || room.ownerId !== socket.id) return;
    room.settings = normalizeSettings({ ...room.settings, ...settings });
    emitRoomState(room);
  });

  socket.on('game:chooseWord', (word) => {
    const room = getSocketRoom(socket);
    if (!room || room.phase !== 'choose') return;
    if (currentDrawer(room)?.id !== socket.id) return;
    if (!room.wordChoices.includes(word)) return;
    room.currentWord = word;
    room.phase = 'draw';
    room.seconds = room.settings.drawTime;
    room.strokes = [];
    room.players.forEach((player) => { player.guessed = false; });
    addMessage(room, 'System', `${currentDrawer(room).name} is drawing now.`, 'system');
    startTimer(room);
    emitRoomState(room);
  });

  socket.on('chat:message', (text) => {
    const room = getSocketRoom(socket);
    const player = getPlayer(room, socket.id);
    if (!room || !player || typeof text !== 'string') return;
    const message = text.trim().slice(0, 120);
    if (!message || room.phase !== 'draw') return;
    if (currentDrawer(room)?.id === socket.id) return;

    if (message.toLowerCase() === room.currentWord.toLowerCase()) {
      if (!player.guessed) {
        player.guessed = true;
        player.score += Math.max(25, room.seconds + 10);
      }
      addMessage(room, player.name, 'guessed the word!', 'correct');
    } else {
      addMessage(room, player.name, message);
    }
    emitRoomState(room);
  });

  socket.on('drawing:preview', (stroke) => {
    const room = getSocketRoom(socket);
    if (!canDraw(room, socket.id) || !isValidStroke(stroke)) return;
    socket.to(room.code).emit('drawing:preview', stroke);
  });

  socket.on('drawing:commit', (stroke) => {
    const room = getSocketRoom(socket);
    if (!canDraw(room, socket.id) || !isValidStroke(stroke)) return;
    room.strokes.push(trimStroke(stroke));
    io.to(room.code).emit('drawing:commit', trimStroke(stroke));
  });

  socket.on('drawing:undo', () => {
    const room = getSocketRoom(socket);
    if (!canDraw(room, socket.id)) return;
    room.strokes.pop();
    emitRoomState(room);
  });

  socket.on('drawing:clear', () => {
    const room = getSocketRoom(socket);
    if (!canDraw(room, socket.id)) return;
    room.strokes = [];
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const leavingPlayer = getPlayer(room, socket.id);
    const wasDrawer = leavingPlayer?.id === currentDrawer(room)?.id;
    room.players = room.players.filter((player) => player.id !== socket.id);
    socket.leave(room.code);
    if (!room.players.length) {
      clearInterval(room.timerId);
      rooms.delete(room.code);
      return;
    }
    if (room.ownerId === socket.id) {
      room.ownerId = room.players[0].id;
      room.players[0].owner = true;
    }
    room.drawerIndex = Math.min(room.drawerIndex, room.players.length - 1);
    addMessage(room, 'System', `${leavingPlayer?.name || 'A player'} left the room.`, 'system');
    if (wasDrawer) advanceTurn(room);
    emitRoomState(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Skribble clone running at http://localhost:${PORT}`);
});

function createRoom(settings = {}) {
  const code = makeRoomCode();
  const room = {
    code,
    settings: normalizeSettings(settings),
    players: [],
    ownerId: '',
    round: 1,
    drawerIndex: 0,
    phase: 'choose',
    currentWord: '',
    wordChoices: [],
    seconds: normalizeSettings(settings).drawTime,
    strokes: [],
    messages: [],
    timerId: null
  };
  room.wordChoices = sampleWords(room);
  rooms.set(code, room);
  return room;
}

function joinRoom(socket, room, name, owner) {
  socket.join(room.code);
  socket.data.roomCode = room.code;
  const player = {
    id: socket.id,
    name: cleanName(name),
    score: 0,
    color: COLORS[room.players.length % COLORS.length],
    owner,
    guessed: false
  };
  room.players.push(player);
  if (owner || !room.ownerId) {
    room.ownerId = socket.id;
    player.owner = true;
  }
  addMessage(room, 'System', `${player.name} joined the room.`, 'system');
  emitRoomState(room);
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return {
    players: clamp(Number(merged.players), 2, 20),
    language: String(merged.language || 'English').slice(0, 24),
    drawTime: clamp(Number(merged.drawTime), 30, 180),
    rounds: clamp(Number(merged.rounds), 1, 10),
    mode: String(merged.mode || 'Normal').slice(0, 24),
    wordCount: clamp(Number(merged.wordCount), 1, 5),
    hints: clamp(Number(merged.hints), 0, 5),
    customWords: String(merged.customWords || '').slice(0, 500),
    customOnly: Boolean(merged.customOnly)
  };
}

function emitRoomState(room) {
  room.players.forEach((player) => {
    io.to(player.id).emit('room:state', clientState(room, player.id));
  });
}

function clientState(room, playerId) {
  const drawer = currentDrawer(room);
  const isDrawer = drawer?.id === playerId;
  return {
    myId: playerId,
    roomCode: room.code,
    roomSettings: room.settings,
    players: room.players,
    round: room.round,
    drawerId: drawer?.id || '',
    drawerIndex: room.drawerIndex,
    phase: room.phase,
    currentWord: isDrawer ? room.currentWord : '',
    wordHint: wordHint(room.currentWord, room.settings.hints, room.phase, isDrawer),
    wordChoices: isDrawer && room.phase === 'choose' ? room.wordChoices : [],
    seconds: room.seconds,
    strokes: room.strokes,
    messages: room.messages
  };
}

function startTimer(room) {
  clearInterval(room.timerId);
  room.timerId = setInterval(() => {
    room.seconds -= 1;
    if (room.seconds <= 0) {
      addMessage(room, 'System', `The word was "${room.currentWord}".`, 'system');
      advanceTurn(room);
      return;
    }
    emitRoomState(room);
  }, 1000);
}

function advanceTurn(room) {
  clearInterval(room.timerId);
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  if (room.drawerIndex === 0) room.round += 1;
  if (room.round > room.settings.rounds) {
    room.phase = 'gameover';
    room.currentWord = '';
    room.wordChoices = [];
    room.strokes = [];
    room.players.sort((a, b) => b.score - a.score);
    addMessage(room, 'System', `${room.players[0]?.name || 'Nobody'} wins the game!`, 'system');
    emitRoomState(room);
    return;
  }
  room.phase = 'choose';
  room.currentWord = '';
  room.wordChoices = sampleWords(room);
  room.seconds = room.settings.drawTime;
  room.strokes = [];
  room.players.forEach((player) => { player.guessed = false; });
  addMessage(room, 'System', `${currentDrawer(room).name} is choosing a word.`, 'system');
  emitRoomState(room);
}

function sampleWords(room) {
  const custom = room.settings.customWords
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const pool = room.settings.customOnly && custom.length ? custom : [...custom, ...WORDS];
  return [...new Set(pool)].sort(() => Math.random() - 0.5).slice(0, room.settings.wordCount);
}

function wordHint(word, hints, phase, isDrawer) {
  if (!word) return 'Waiting for word';
  if (isDrawer || phase === 'gameover') return word.split('').join(' ');
  const revealed = Math.min(hints, Math.floor(word.length / 2));
  return word
    .split('')
    .map((letter, index) => index < revealed || letter === ' ' ? letter : '_')
    .join(' ');
}

function addMessage(room, name, text, kind = '') {
  room.messages.push({ name, text, kind });
  room.messages = room.messages.slice(-80);
}

function currentDrawer(room) {
  return room?.players[room.drawerIndex];
}

function getSocketRoom(socket) {
  return rooms.get(socket.data.roomCode);
}

function getPlayer(room, id) {
  return room?.players.find((player) => player.id === id);
}

function canDraw(room, playerId) {
  return Boolean(room && room.phase === 'draw' && currentDrawer(room)?.id === playerId);
}

function makeRoomCode() {
  let code = '';
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function cleanCode(code) {
  return String(code || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
}

function cleanName(name) {
  const value = String(name || '').trim().slice(0, 18);
  return value || 'Player';
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isValidStroke(stroke) {
  return stroke
    && typeof stroke.color === 'string'
    && Number.isFinite(stroke.size)
    && Array.isArray(stroke.points)
    && stroke.points.length > 0
    && stroke.points.length < 800;
}

function trimStroke(stroke) {
  return {
    tool: stroke.tool === 'eraser' ? 'eraser' : 'brush',
    color: String(stroke.color).slice(0, 24),
    size: clamp(Number(stroke.size), 1, 60),
    points: stroke.points.slice(0, 800).map((point) => ({
      x: clamp(Number(point.x), 0, 980),
      y: clamp(Number(point.y), 0, 620)
    }))
  };
}
