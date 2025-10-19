// --- Slovo Boi server (Node + Express + Socket.IO) ---

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

// ---------- Basic app & CORS ----------
const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  credentials: true,
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Health-check route
app.get('/', (_req, res) => {
  res.send('Slovo Boi (RU) server is LIVE');
});

// ----------------- GAME LOGIC -----------------
/** Rooms storage:
 * roomId: {
 *    players: [{ id, name, score }],
 *    lang: 'ru',
 *    wordLength: 6,
 *    word: 'яблоко',
 *    guesses: [] // [{ playerId, guess, result[] }]
 * }
 */
const rooms = {};

// --- small built‑in dicts as a fallback (can be replaced by larger ones) ---
const RU_6 = [
  'яблоко','молоко','песням','береза','сердце','морозы','уроки','доскаа','паруса','мостик',
  'пироги','стекло','веснаа','столик','ручкаа','игрушк'
].filter(w => [...w].length === 6);

const DICT = {
  ru: { 6: RU_6 },
};

/** Pick a random word by language & length */
function pickRandomWord(lang, len) {
  const arr = (DICT[lang] && DICT[lang][len]) ? DICT[lang][len] : [];
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Compare guess against word; return result array of 'green'|'yellow'|'gray' */
function checkGuess(word, guess) {
  const res = [];
  const target = [...word];
  const g = [...guess];
  const used = Array(target.length).fill(false);

  // greens
  for (let i = 0; i < g.length; i++) {
    if (g[i] === target[i]) {
      res[i] = 'green';
      used[i] = true;
    }
  }
  // yellows / grays
  for (let i = 0; i < g.length; i++) {
    if (res[i] === 'green') continue;
    let found = -1;
    for (let j = 0; j < target.length; j++) {
      if (!used[j] && g[i] === target[j]) { found = j; break; }
    }
    if (found >= 0) {
      res[i] = 'yellow';
      used[found] = true;
    } else {
      res[i] = 'gray';
    }
  }
  return res;
}

// ------------- Socket events --------------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', ({ roomId, playerName, lang, wordLength }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        lang,
        wordLength,
        word: '',
        guesses: [],
      };
    }
    rooms[roomId].players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
    console.log(`Room ${roomId} created/joined by ${playerName}`);
  });

  // Start game: if no word given, server picks one
  socket.on('startGame', ({ roomId, word }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ ok: false, error: 'Комната не найдена' });

    const len = room.wordLength || 6;
    const lang = room.lang || 'ru';

    let chosen = (word && [...word].length === len) ? word.toLowerCase() : pickRandomWord(lang, len);
    if (!chosen) return cb && cb({ ok: false, error: 'Нет слова выбранной длины' });

    room.word = chosen.toLowerCase();
    room.guesses = [];

    io.to(roomId).emit('gameStarted', { wordLength: len });
    console.log(`Room ${roomId}: Game started with word "${room.word}"`);
    cb && cb({ ok: true });
  });

  socket.on('guessWord', ({ roomId, guess }, cb) => {
    const room = rooms[roomId];
    if (!room || !room.word) return cb && cb({ ok: false, error: 'Игра не начата' });
    const g = (guess || '').toLowerCase();

    if ([...g].length !== room.wordLength) {
      return cb && cb({ ok: false, error: 'Неверная длина слова' });
    }

    const result = checkGuess(room.word, g);
    room.guesses.push({ playerId: socket.id, guess: g, result });
    io.to(roomId).emit('guessResult', { guess: g, result, playerId: socket.id });

    const win = result.every(c => c === 'green');
    cb && cb({ ok: true, win });
    if (win) {
      io.to(roomId).emit('gameFinished', { word: room.word, winner: socket.id });
    }
  });

  socket.on('disconnect', () => {
    // remove player from any rooms
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', room);
    }
    console.log('Client disconnected:', socket.id);
  });
});

// ---------- Start server ----------
const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
