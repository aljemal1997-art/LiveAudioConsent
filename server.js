const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const LISTENER_PASSWORD = process.env.LISTENER_PASSWORD;
const ADMIN_TOKEN = crypto.randomBytes(24).toString('hex');
if (!LISTENER_PASSWORD || LISTENER_PASSWORD.length < 12) {
  console.error('Set LISTENER_PASSWORD to a strong password of at least 12 characters before starting.');
  process.exit(1);
}
app.use(express.static('public', { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const listenerSessions = new Set();
const senders = new Map();
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

io.on('connection', socket => {
  socket.on('listener-auth', ({ password } = {}, cb = () => {}) => {
    if (!safeEqual(password || '', LISTENER_PASSWORD)) return cb({ ok: false, error: 'كلمة المرور غير صحيحة' });
    listenerSessions.add(socket.id);
    socket.data.listener = true;
    cb({ ok: true });
    socket.emit('devices', [...senders.entries()].map(([id, info]) => ({ id, label: info.label, sharing: true })));
  });
  socket.on('sender-register', ({ label, consent } = {}, cb = () => {}) => {
    if (consent !== true) return cb({ ok: false, error: 'يلزم تأكيد الموافقة أولاً' });
    // One active stream per sender socket. The sender must explicitly start sharing in the UI.
    const cleanLabel = String(label || 'جهاز مشارك').slice(0, 50);
    senders.set(socket.id, { label: cleanLabel, startedAt: Date.now() });
    socket.data.sender = true;
    cb({ ok: true, id: socket.id });
    io.emit('devices', [...senders.entries()].map(([id, info]) => ({ id, label: info.label, sharing: true })));
  });
  socket.on('webrtc-request', ({ to } = {}) => {
    if (!socket.data.listener || !senders.has(to)) return;
    io.to(to).emit('webrtc-request', { from: socket.id });
  });
  socket.on('webrtc-offer', ({ to, offer } = {}) => {
    if (!socket.data.sender || !listenerSessions.has(to) || !offer) return;
    io.to(to).emit('webrtc-offer', { from: socket.id, offer, label: senders.get(socket.id)?.label || 'جهاز مشارك' });
  });
  socket.on('webrtc-answer', ({ to, answer } = {}) => {
    if (!socket.data.listener || !senders.has(to) || !answer) return;
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });
  socket.on('webrtc-ice', ({ to, candidate } = {}) => {
    if (!candidate || typeof to !== 'string') return;
    if (socket.data.sender && listenerSessions.has(to)) io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
    else if (socket.data.listener && senders.has(to)) io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });
  socket.on('stop-sharing', () => {
    if (senders.delete(socket.id)) io.emit('devices', [...senders.entries()].map(([id, info]) => ({ id, label: info.label, sharing: true })));
    socket.data.sender = false;
  });
  socket.on('disconnect', () => {
    listenerSessions.delete(socket.id);
    if (senders.delete(socket.id)) io.emit('devices', [...senders.entries()].map(([id, info]) => ({ id, label: info.label, sharing: true })));
  });
});
server.listen(PORT, () => console.log(`Aljammal listening on port ${PORT}`));
