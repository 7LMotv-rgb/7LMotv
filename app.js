// Client for OmiTV-like matching
const $ = s => document.querySelector(s);
const onlineCountEl = $('#onlineCount');
const roomsCountEl = $('#roomsCount');
const prefLang = $('#prefLang');
const prefGender = $('#prefGender');
const prefCountry = $('#prefCountry');
const startBtn = $('#startBtn');
const nextBtn = $('#nextBtn');
const stopBtn = $('#stopBtn');
const statusEl = $('#status');
const localVideo = $('#localVideo');
const remoteVideo = $('#remoteVideo');
const chatLog = $('#chatLog');
const chatMsg = $('#chatMsg');
const sendChat = $('#sendChat');
document.getElementById('year').textContent = new Date().getFullYear();

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProto}://${location.host}`);

let localStream;
let pc;
let roomId = null;
let matched = false;

// STUN servers (add TURN for production)
const rtcConfig = { iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ] };

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  switch(msg.type) {
    case 'onlineCount': onlineCountEl.textContent = msg.count; break;
    case 'roomsCount': roomsCountEl.textContent = msg.roomsCount + ' غرف'; break;
    case 'matchFound':
      roomId = msg.roomId;
      statusEl.textContent = 'تم المطابقة — متصل...';
      matched = true;
      nextBtn.disabled = false;
      stopBtn.disabled = false;
      startCallAsCallee(); // when matched, create peer and wait for signaling
      break;
    case 'signal':
      handleSignal(msg.payload);
      break;
    case 'chat':
      addChatLine(msg.from.substring(0,6), msg.text);
      break;
    case 'partnerLeft':
      addSystemLine('الشريك غادر');
      cleanupCall();
      break;
    default: break;
  }
};

function addChatLine(from, text) {
  const d = document.createElement('div'); d.className = 'chat-line'; d.textContent = `[${from}] ${text}`; chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight;
}
function addSystemLine(text) { const d = document.createElement('div'); d.className = 'chat-line'; d.style.opacity=0.8; d.textContent = text; chatLog.appendChild(d); chatLog.scrollTop = chatLog.scrollHeight; }

async function initMedia() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  localVideo.srcObject = localStream;
}

function newPeer(initiator = false) {
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type:'signal', payload:{ candidate: e.candidate } })); };
  pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; };
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  return pc;
}

async function startCallAsCallee() {
  // create peer and wait for offer from other side via signaling
  if (!localStream) await initMedia();
  if (!pc) newPeer(false);
}

async function createOfferAndSend() {
  if (!pc) newPeer(true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type:'signal', payload: { sdp: pc.localDescription } }));
}

async function handleSignal(payload) {
  if (payload.sdp) {
    if (!pc) newPeer(false);
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    if (payload.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type:'signal', payload: { sdp: pc.localDescription } }));
    }
  } else if (payload.candidate) {
    try { await pc?.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch(e) {}
  }
}

startBtn.addEventListener('click', async () => {
  await initMedia();
  const prefs = { language: prefLang.value, country: prefCountry.value, gender: prefGender.value };
  ws.send(JSON.stringify({ type: 'joinQueue', prefs }));
  statusEl.textContent = 'في قائمة الانتظار...';
  startBtn.disabled = true;
});

nextBtn.addEventListener('click', async () => {
  const prefs = { language: prefLang.value, country: prefCountry.value, gender: prefGender.value };
  ws.send(JSON.stringify({ type: 'next', prefs }));
  addSystemLine('بحث عن شريك جديد...');
  cleanupCall();
  statusEl.textContent = 'في قائمة الانتظار...';
  nextBtn.disabled = true;
});

stopBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'leaveQueue' }));
  cleanupCall();
  statusEl.textContent = 'توقفت عن البحث';
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
});

sendChat.addEventListener('click', () => {
  const t = chatMsg.value.trim(); if (!t) return;
  ws.send(JSON.stringify({ type:'chat', text: t })); addChatLine('me', t); chatMsg.value='';
});
chatMsg.addEventListener('keydown', (e) => { if (e.key==='Enter') sendChat.click(); });

function cleanupCall() {
  try { pc?.getSenders()?.forEach(s => s.track && s.track.stop()); } catch(e){}
  try { pc?.close(); } catch(e){}
  pc = null;
  localStream?.getTracks()?.forEach(t => t.stop());
  localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  matched = false;
  roomId = null;
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
}

window.addEventListener('beforeunload', ()=>{ ws.close(); });
