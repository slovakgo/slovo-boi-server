const express = require('express');
const http = require('http');
const cors = require('cors'); // добавили
const { Server } = require('socket.io');

const app = express();
app.use(cors({ origin: '*', credentials: true })); // разрешаем CORS

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // можно поставить конкретный Netlify URL, если хочешь
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// HTTP проверка
app.get('/', (_, res) => {
  res.send('Slovo Boi (RU) server is LIVE');
});

// -------------------- ОСНОВНАЯ ЛОГИКА -------------------- //
let rooms = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', ({ roomId, playerName, lang, wordLength }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        lang,
        wordLength,
        word: null
      };
    }
    const room = rooms[roomId];
    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', room);
    console.log(`Room ${roomId} created/joined by ${playerName}`);
  });

// Вспомогательная функция для выбора случайного слова
function pickRandomWord(lang, len) {
  const arr = DICT[lang]?.[len] || [];
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

socket.on('startGame', ({ roomId, word }, cb) => {
  const room = rooms[roomId];
  if (!room) return cb?.({ ok: false, error: 'Комната не найдена' });

  const len = room.wordLength || 6;
  const lang = room.lang || 'ru';

  // Если слово не введено — сервер сам выбирает
  let secret = (typeof word === 'string' && word.length === len)
    ? word.toLowerCase()
    : pickRandomWord(lang, len);

  if (!secret) return cb?.({ ok: false, error: 'Нет слов нужной длины' });

  room.word = secret;
  room.guesses = [];
  io.to(roomId).emit('gameStarted', { wordLength: len });
  console.log(`Room ${roomId}: Game started with word ${secret}`);
  cb?.({ ok: true });
}); 

  socket.on('guessWord', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (room && room.word) {
      const word = room.word;
      let result = [];
      for (let i = 0; i < guess.length; i++) {
        if (guess[i] === word[i]) result.push('green');
        else if (word.includes(guess[i])) result.push('yellow');
        else result.push('gray');
      }
      io.to(roomId).emit('guessResult', { guess, result });
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
    }
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Your service is live on port ${PORT}`);
});
