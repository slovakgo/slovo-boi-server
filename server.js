// Slovo Boi — простой сервер на Express + Socket.IO
// Поддержка русских слов (6 или 8 букв), комнаты до 5 игроков.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// --- Словари ---
const RU_PATH = path.join(__dirname, 'dict', 'ru.txt');
let RU_WORDS = new Set();
function loadDict() {
  try {
    const text = fs.readFileSync(RU_PATH, 'utf8')
      .split(/\r?\n/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    RU_WORDS = new Set(text);
    console.log(`RU dict loaded: ${RU_WORDS.size} words`);
  } catch (e) {
    console.error('Failed to load dictionary:', e.message);
    RU_WORDS = new Set();
  }
}
loadDict();

// --- Утилиты ---
const LETTERS_RE = /^[А-ЯЁа-яё]+$/;
const normalize = (s) => s.toLowerCase().replace(/ё/g, 'е');
function inDict(word, lang, len) {
  if (lang !== 'ru') return false;
  if (![6,8].includes(len)) return false;
  const w = normalize(word);
  return RU_WORDS.has(w);
}
function scoreGuess(guess, secret) {
  const g = normalize(guess);
  const s = normalize(secret);
  let bulls = 0, cows = 0;
  const scount = new Map();

  for (let i = 0; i < s.length; i++) {
    if (g[i] === s[i]) bulls++;
    else scount.set(s[i], (scount.get(s[i])||0)+1);
  }
  for (let i = 0; i < s.length; i++) {
    if (g[i] !== s[i]) {
      const c = scount.get(g[i])||0;
      if (c > 0) { cows++; scount.set(g[i], c-1); }
    }
  }
  return {bulls, cows};
}

// --- Комнаты ---
/** room: { id, lang:'ru', wordLen:number, word:string, players: Map<socketId,name> } */
const rooms = new Map();

function emitRoomUpdate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('roomUpdate', {
    players: room.players.size,
    wordLen: room.wordLen,
    lang: room.lang
  });
}

// --- HTTP ---
app.get('/', (_req, res) => {
  res.type('text/plain').send('Slovo Boi (RU) server is LIVE');
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  // Создать комнату
  socket.on('createRoom', ({ roomId, word, name }, cb) => {
    try {
      if (!roomId) return cb?.({ok:false, error:'Нужен ID комнаты'});
      if (!word)   return cb?.({ok:false, error:'Нужно слово'});
      word = String(word).trim();
      if (!LETTERS_RE.test(word)) return cb?.({ok:false, error:'Слово: только русские буквы'});
      const len = word.length;
      if (![6,8].includes(len)) return cb?.({ok:false, error:'Длина слова должна быть 6 или 8'});
      if (!inDict(word, 'ru', len)) return cb?.({ok:false, error:`Слова нет в словаре (${len})`});

      let room = rooms.get(roomId);
      if (!room) {
        room = { id: roomId, lang:'ru', wordLen: len, word, players: new Map() };
        rooms.set(roomId, room);
      } else {
        room.word = word;
        room.wordLen = len;
        room.lang = 'ru';
      }
      cb?.({ok:true, wordLen: room.wordLen, lang: room.lang});
      emitRoomUpdate(roomId);
    } catch (e) {
      cb?.({ok:false, error: e.message || 'Ошибка'});
    }
  });

  // Войти в комнату
  socket.on('joinRoom', ({ roomId, name }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ok:false, error:'Комната не найдена'});
    if (room.players.size >= 5) return cb?.({ok:false, error:'Комната заполнена (5)'});
    socket.join(roomId);
    room.players.set(socket.id, String(name || 'Игрок'));
    cb?.({ok:true, wordLen: room.wordLen, lang: room.lang});
    emitRoomUpdate(roomId);
  });

  // Угадать
  socket.on('guess', ({ roomId, guess }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ok:false, error:'Комната не найдена'});
    guess = String(guess||'').trim();
    if (!LETTERS_RE.test(guess)) return cb?.({ok:false, error:'Только русские буквы'});
    if (guess.length !== room.wordLen) return cb?.({ok:false, error:`Длина должна быть ${room.wordLen}`});
    if (!inDict(guess, room.lang, room.wordLen)) return cb?.({ok:false, error:'Слова нет в словаре'});

    const {bulls, cows} = scoreGuess(guess, room.word);
    const name = rooms.get(roomId)?.players.get(socket.id) || 'Игрок';
    io.to(roomId).emit('guessResult', { name, guess, bulls, cows });
    cb?.({ok:true});

    if (bulls === room.wordLen) {
      io.to(roomId).emit('gameOver', { winner: name, word: room.word });
    }
  });

  // Новый раунд
  socket.on('newRound', ({ roomId, word }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ok:false, error:'Комната не найдена'});
    word = String(word||'').trim();
    if (!LETTERS_RE.test(word)) return cb?.({ok:false, error:'Слово: только русские буквы'});
    const len = word.length;
    if (![6,8].includes(len)) return cb?.({ok:false, error:'Длина слова должна быть 6 или 8'});
    if (!inDict(word, 'ru', len)) return cb?.({ok:false, error:`Слова нет в словаре (${len})`});
    room.word = word; room.wordLen = len; room.lang = 'ru';
    io.to(roomId).emit('roundReset', { wordLen: room.wordLen, lang: room.lang });
    cb?.({ok:true});
  });

  // Отключение
  socket.on('disconnect', () => {
    for (const [rid, room] of rooms.entries()) {
      if (room.players.delete(socket.id)) {
        emitRoomUpdate(rid);
        if (room.players.size === 0) {
          // Через минуту удаляем пустую комнату
          setTimeout(() => { const r = rooms.get(rid); if (r && r.players.size===0) rooms.delete(rid); }, 60_000);
        }
      }
    }
  });
});

// --- Запуск ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('Server on :' + PORT);
});
