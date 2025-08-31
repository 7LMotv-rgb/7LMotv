# 7LM tv — OmiTV-like Matchmaking (1:1)

Minimal random video chat with matchmaking filters (language, country, gender).

## Quick start
1. Install:
```
npm install
```
2. Run:
```
npm start
```
3. Open `http://localhost:3000` (use HTTPS for camera in remote hosts) and choose preferences, then press "ابدأ".

## Notes
- For better connectivity across NAT/firewalls, add TURN servers to `public/app.js`'s `rtcConfig.iceServers`.
- This simple server does in-memory matchmaking. For scale, use Redis or a persistent queue and worker processes.
