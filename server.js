const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const roomHistory = {};
const userSockets = {};
const onlineUsers = new Set();

function makeId() { return crypto.randomUUID().slice(0, 8); }

io.on('connection', (socket) => {
  let username = '';
  let room = 'general';

  socket.on('register', (data, cb) => {
    const { user, pass } = data;
    if (!user || !pass || user.length < 2) return cb({ ok: false, err: 'Неверные данные' });
    if (users[user]) return cb({ ok: false, err: 'Пользователь уже существует' });
    users[user] = { pass, id: makeId() };
    cb({ ok: true });
  });

  socket.on('login', (data, cb) => {
    const { user, pass } = data;
    if (!users[user] || users[user].pass !== pass) return cb({ ok: false, err: 'Неверный логин или пароль' });
    cb({ ok: true, userId: users[user].id });
  });

  socket.on('join', (data) => {
    username = data.username;
    room = data.room || 'general';
    socket.join(room);
    onlineUsers.add(username);
    userSockets[username] = socket.id;
    if (!roomHistory[room]) roomHistory[room] = [];
    socket.emit('history', roomHistory[room]);
    socket.to(room).emit('sys', `${username} вошёл`);
    io.emit('online', [...onlineUsers]);
  });

  socket.on('msg', (data) => {
    if (!username) return;
    const msg = { user: username, text: data.text || '', file: data.file || '', time: Date.now() };
    if (!roomHistory[room]) roomHistory[room] = [];
    roomHistory[room].push(msg);
    if (roomHistory[room].length > 200) roomHistory[room].shift();
    io.to(room).emit('msg', msg);
  });

  socket.on('dm', (data) => {
    if (!username) return;
    const dmRoom = [username, data.to].sort().join(':');
    const msg = { user: username, text: data.text || '', file: data.file || '', time: Date.now() };
    if (!roomHistory[dmRoom]) roomHistory[dmRoom] = [];
    roomHistory[dmRoom].push(msg);
    if (roomHistory[dmRoom].length > 200) roomHistory[dmRoom].shift();
    const sockets = [userSockets[username], userSockets[data.to]].filter(Boolean);
    sockets.forEach(id => { if (id) io.to(id).emit('dm', { room: dmRoom, msg }); });
  });

  socket.on('join-dm', (data) => {
    if (!username) return;
    const dmRoom = [username, data.with].sort().join(':');
    socket.join(dmRoom);
    socket.emit('history', roomHistory[dmRoom] || []);
  });

  socket.on('get-users', () => {
    socket.emit('online', [...onlineUsers]);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(username);
    delete userSockets[username];
    io.emit('online', [...onlineUsers]);
    if (room) io.to(room).emit('sys', `${username} вышел`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));
