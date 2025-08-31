/**
 * 7LM tv — Matchmaking WebRTC (OmiTV-like)
 * Features:
 * - Random 1:1 matchmaking with preferences (language, country, gender)
 * - Next button (re-queue)
 * - Online user counter
 * - WebSocket signaling and simple room management
 *
 * Note: For production use TURN servers and HTTPS.
 */
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

// waiting queue entries: { id, ws, prefs }
const waiting = [];

// rooms: roomId -> { a: ws, b: ws }
const rooms = new Map();

function broadcastOnlineCount() {
  const msg = JSON.stringify({ type: 'onlineCount', count: wss.clients.size });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function tryMatchForWaiting() {
  if (waiting.length < 2) return;
  // simple FIFO: try to match first waiting with any compatible later
  for (let i = 0; i < waiting.length; i++) {
    const a = waiting[i];
    for (let j = i+1; j < waiting.length; j++) {
      const b = waiting[j];
      if (compatible(a.prefs, b.prefs)) {
        // remove both from queue
        waiting.splice(j,1);
        waiting.splice(i,1);
        createRoom(a, b);
        return;
      }
    }
  }
}

function compatible(p1, p2) {
  // compare language preference: 'any' or match same language
  const lang_ok = (p1.language === 'any' || p2.language === 'any' || p1.language === p2.language);
  const gender_ok = (p1.gender === 'any' || p2.gender === 'any' || p1.gender === p2.gender);
  const country_ok = (p1.country === 'any' || p2.country === 'any' || p1.country === p2.country);
  return lang_ok && gender_ok && country_ok;
}

function createRoom(a, b) {
  try {
    const roomId = uuidv4();
    rooms.set(roomId, { a: a.ws, b: b.ws });
    // attach room info
    a.ws.roomId = roomId; b.ws.roomId = roomId;
    // tell both peers matched
    const payloadA = JSON.stringify({ type: 'matchFound', roomId, partnerId: b.id });
    const payloadB = JSON.stringify({ type: 'matchFound', roomId, partnerId: a.id });
    if (a.ws.readyState === 1) a.ws.send(payloadA);
    if (b.ws.readyState === 1) b.ws.send(payloadB);
    broadcastRoomCount();
  } catch (e) { console.error(e); }
}

function broadcastRoomCount() {
  const roomsCount = rooms.size;
  const msg = JSON.stringify({ type: 'roomsCount', roomsCount });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function removeFromWaitingById(id) {
  const idx = waiting.findIndex(x => x.id === id);
  if (idx !== -1) waiting.splice(idx,1);
}

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  broadcastOnlineCount();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch(e) { return; }
    switch (msg.type) {
      case 'joinQueue':
        // msg.prefs: {language, country, gender}
        removeFromWaitingById(ws.id);
        waiting.push({ id: ws.id, ws, prefs: msg.prefs || {language:'any',country:'any',gender:'any'} });
        tryMatchForWaiting();
        break;
      case 'leaveQueue':
        removeFromWaitingById(ws.id);
        break;
      case 'next':
        // leave current room and requeue
        leaveRoom(ws);
        // re-add to waiting if requested with prefs
        waiting.push({ id: ws.id, ws, prefs: msg.prefs || {language:'any',country:'any',gender:'any'} });
        tryMatchForWaiting();
        break;
      case 'signal':
        // forward signaling payload to partner in same room
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const peer = room.a === ws ? room.b : room.a;
        if (peer && peer.readyState === 1) peer.send(JSON.stringify({ type: 'signal', from: ws.id, payload: msg.payload }));
        break;
      case 'chat':
        // broadcast chat to partner in room
        const r = rooms.get(ws.roomId);
        if (!r) return;
        const p = r.a === ws ? r.b : r.a;
        if (p && p.readyState === 1) p.send(JSON.stringify({ type:'chat', from: ws.id, text: msg.text }));
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    // cleanup
    removeFromWaitingById(ws.id);
    leaveRoom(ws);
    broadcastOnlineCount();
  });

  ws.on('error', () => {
    removeFromWaitingById(ws.id);
    leaveRoom(ws);
    broadcastOnlineCount();
  });
});

function leaveRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const pair = rooms.get(roomId);
  if (!pair) return;
  const peer = pair.a === ws ? pair.b : pair.a;
  // notify peer that partner left
  if (peer && peer.readyState === 1) {
    peer.send(JSON.stringify({ type: 'partnerLeft' }));
    delete peer.roomId;
  }
  rooms.delete(roomId);
  delete ws.roomId;
  broadcastRoomCount();
}
