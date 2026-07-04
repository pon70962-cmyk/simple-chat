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
    users[user] = { pass, id: makeId(), friends: [], incoming: [], outgoing: [], theme: 'dark' };
    cb({ ok: true });
  });

  socket.on('login', (data, cb) => {
    const { user, pass } = data;
    if (!users[user] || users[user].pass !== pass) return cb({ ok: false, err: 'Неверный логин или пароль' });
    cb({ ok: true, userId: users[user].id, data: users[user] });
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
    [userSockets[username], userSockets[data.to]].filter(Boolean).forEach(id => { if (id) io.to(id).emit('dm', { room: dmRoom, msg }); });
  });

  socket.on('join-dm', (data) => {
    if (!username) return;
    const dmRoom = [username, data.with].sort().join(':');
    socket.join(dmRoom);
    socket.emit('history', roomHistory[dmRoom] || []);
  });

  socket.on('friend-req', (data, cb) => {
    if (!username || !users[data.to]) return cb?.({ ok: false });
    if (users[username].friends.includes(data.to)) return cb?.({ ok: false, err: 'Уже в друзьях' });
    if (users[data.to].incoming.includes(username)) return cb?.({ ok: false, err: 'Заявка уже отправлена' });
    users[data.to].incoming.push(username);
    users[username].outgoing.push(data.to);
    const targetSocket = userSockets[data.to];
    if (targetSocket) io.to(targetSocket).emit('friend-update', users[data.to]);
    socket.emit('friend-update', users[username]);
    cb?.({ ok: true });
  });

  socket.on('friend-accept', (data, cb) => {
    if (!username || !users[data.from]) return cb?.({ ok: false });
    users[username].incoming = users[username].incoming.filter(u => u !== data.from);
    users[data.from].outgoing = users[data.from].outgoing.filter(u => u !== username);
    if (!users[username].friends.includes(data.from)) users[username].friends.push(data.from);
    if (!users[data.from].friends.includes(username)) users[data.from].friends.push(username);
    [userSockets[username], userSockets[data.from]].filter(Boolean).forEach(id => { if (id) io.to(id).emit('friend-update', users[id === userSockets[username] ? username : data.from]); });
    cb?.({ ok: true });
  });

  socket.on('friend-decline', (data, cb) => {
    if (!username || !users[data.from]) return cb?.({ ok: false });
    users[username].incoming = users[username].incoming.filter(u => u !== data.from);
    users[data.from].outgoing = users[data.from].outgoing.filter(u => u !== username);
    socket.emit('friend-update', users[username]);
    cb?.({ ok: true });
  });

  socket.on('friend-remove', (data, cb) => {
    if (!username || !users[data.user]) return cb?.({ ok: false });
    users[username].friends = users[username].friends.filter(u => u !== data.user);
    users[data.user].friends = users[data.user].friends.filter(u => u !== username);
    socket.emit('friend-update', users[username]);
    const target = userSockets[data.user];
    if (target) io.to(target).emit('friend-update', users[data.user]);
    cb?.({ ok: true });
  });

  socket.on('get-user-data', (cb) => { if (username) cb(users[username]); });

  socket.on('save-theme', (theme) => { if (username && users[username]) users[username].theme = theme; });

  socket.on('get-all-users', (cb) => { cb(Object.keys(users)); });

  // Call + screen share
  socket.on('call-start', () => { io.to(room).emit('call-started', { username }); });
  socket.on('call-end', () => { io.to(room).emit('call-ended', { username }); });
  socket.on('call-join', (d) => { io.to(room).emit('call-joined', { username, callerUsername: d.callerUsername }); });
  socket.on('call-signal', (d) => { const t = userSockets[d.toUser]; if (t) io.to(t).emit('call-signal', { signal: d.signal, fromUser: username }); });
  socket.on('screen-signal', (d) => { const t = userSockets[d.toUser]; if (t) io.to(t).emit('screen-signal', { signal: d.signal, fromUser: username }); });
  socket.on('screen-start', () => { io.to(room).emit('screen-started', { username }); });
  socket.on('screen-stop', () => { io.to(room).emit('screen-stopped', { username }); });

  socket.on('disconnect', () => {
    onlineUsers.delete(username);
    delete userSockets[username];
    io.emit('online', [...onlineUsers]);
    if (room) io.to(room).emit('sys', `${username} вышел`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));
