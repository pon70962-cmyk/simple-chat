const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const roomUsers = {};

io.on('connection', (socket) => {
  let username = 'Аноним';
  let room = 'general';

  socket.on('joinRoom', (data) => {
    username = data.username || 'Аноним';
    if (data.room) {
      socket.leave(room);
      room = data.room;
    }
    socket.join(room);
    if (!roomUsers[room]) roomUsers[room] = new Set();
    roomUsers[room].add(socket.id);
    updateUsersCount();
    socket.to(room).emit('message', { type: 'system', text: `${username} присоединился к ${room}` });
  });

  socket.on('leaveRoom', (data) => {
    if (roomUsers[room]) roomUsers[room].delete(socket.id);
    socket.leave(room);
    updateUsersCount();
  });

  socket.on('sendMessage', (data) => {
    io.to(room).emit('message', {
      user: username,
      text: data.message || '',
      image: data.image || '',
      time: Date.now(),
      type: 'user'
    });
  });

  socket.on('disconnect', () => {
    if (roomUsers[room]) roomUsers[room].delete(socket.id);
    updateUsersCount();
    io.to(room).emit('message', { type: 'system', text: `${username} покинул чат` });
  });

  function updateUsersCount() {
    const total = new Set();
    Object.values(roomUsers).forEach(set => set.forEach(id => total.add(id)));
    io.emit('users-count', total.size);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));
