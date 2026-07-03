const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  let username = 'Аноним';
  let room = 'general';

  socket.on('joinRoom', (data) => {
    username = data.username || 'Аноним';
    room = data.room || 'general';
    socket.join(room);
    socket.to(room).emit('message', { user: 'Система', text: `${username} присоединился к чату` });
  });

  socket.on('sendMessage', (data) => {
    io.to(room).emit('message', { user: username, text: data.message });
  });

  socket.on('disconnect', () => {
    socket.to(room).emit('message', { user: 'Система', text: `${username} покинул чат` });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));
