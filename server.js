// --- БАЗА ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

// HTTP-проверка
app.get('/', (_, res) => {
  res.send('Slovo Boi (RU) server is LIVE');
});

const server = http.createServer(app);

// Разрешим запросы с Netlify (и локально)
const io = new Server(server, {
  cors: {
    origin: [
      '*',
      /\.netlify\.app$/,
      'http://localhost:5173',
      'http://localhost:3000'
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// --- ПАМЯТЬ СЕРВЕРА ---
/** rooms: {
 *   [roomId]: {
 *      players: [{ id, name, score }],
 *      lang: 'ru' | 'ua' | 'en',
 *      wordLength: 6,
 *      word: 'секрет',
 *      guesses: [] // массив строк
 *   }
 * }
 */
let rooms = {};

// ----- ВСПОМОГАТЕЛЬНОЕ: словари -----
const DICT = {
  ru: {
    5: ['мирок','пирог','молоко'.slice(0,5),'берег','ветер'],
    6: ['яблоко','молоко','ветрик'.slice(0,6),'школа'.padEnd(6,'а'),'рыбина']
  },
  ua: {
    6: ['молоко','кавава'.slice(0,6),'квітка','місток'.padEnd(6,'о')]
  },
  en: {
    5: ['apple','river','table','chair','green'],
    6: ['butter','bridge','planet','silver','orange']
  }
};

function pickRandomWord(lang, len) {
  const arr = (DICT[lang] && DICT[lang][len]) || [];
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)].toLowerCase();
}

// --- СОБЫТИЯ СОКЕТОВ ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('connected', { id: socket.id });

  // Создать комнату и сразу войти
  socket.on('createRoom', ({ roomId, playerName, lang, wordLength }) => {
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        lang,
        wordLength,
        word: '',
        guesses: []
      };
    }
    // Добавляем игрока
    rooms[roomId].players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomId);

    console.log(`Room ${roomId} created/joined by ${playerName}`);
    io.to(roomId).emit('roomUpdate', rooms[roomId]); // <- ОБНОВИТЬ "Игроков: ..."
  });

  // Войти в существующую комнату
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorMsg', 'Комната не найдена');
      return;
    }
    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', room);
  });

  // Старт раунда
  socket.on('startGame', ({ roomId, word }, cb) => {
    const room = rooms[roomId];
    if (!room) {
      cb && cb({ ok: false, error: 'Комната не найдена' });
      return;
    }
    // если слово не задано — выбираем случайно
    const len = room.wordLength || 6;
    const lang = room.lang || 'ru';
    room.word = (word && String(word).toLowerCase()) || pickRandomWord(lang, len);

    if (!room.word || room.word.length !== len) {
      cb && cb({ ok: false, error: 'Слово не выбрано или длина не совпадает' });
      return;
    }

    room.guesses = [];
    console.log(`Room ${roomId}: Game started with word "${room.word}"`);
    io.to(roomId).emit('gameStarted', { wordLength: len });
    cb && cb({ ok: true });
  });

  // Попытка игрока
  socket.on('guessWord', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || !room.word) return;

    const g = String(guess || '').toLowerCase();
    if (g.length !== room.word.length) return;

    // Подсветка
    const result = [];
    for (let i = 0; i < g.length; i++) {
      if (g[i] === room.word[i]) result.push('green');
      else if (room.word.includes(g[i])) result.push('yellow');
      else result.push('gray');
    }
    room.guesses.push(g);

    io.to(roomId).emit('guessResult', { guess: g, result });
    if (g === room.word) {
      io.to(roomId).emit('gameOver', { word: room.word });
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    // убрать игрока из всех комнат
for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', room);
    }
    console.log('Client disconnected:', socket.id);
  });
});

// --- СТАРТ СЕРВЕРА ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Your service is live on port ${PORT}`);
});
