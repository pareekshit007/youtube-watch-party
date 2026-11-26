import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { RoomManager } from './RoomManager.js';
import { MessageHandler } from './socket/MessageHandler.js';
import { sanitizeText } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const CLIENT_DIST = process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');

// comma separated list, only needed when frontend and backend live on different domains
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : true;

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  const rooms = new RoomManager(io);

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), ...rooms.stats() });
  });

  app.post('/api/rooms', (req, res) => {
    const sessionId = sanitizeText(req.body?.sessionId, 64);
    if (sessionId.length < 8) return res.status(400).json({ error: 'sessionId is required' });
    const room = rooms.createRoom({ hostSessionId: sessionId, name: sanitizeText(req.body?.name, 40) });
    res.status(201).json({ roomId: room.id, name: room.name });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ roomId: room.id, name: room.name, participants: room.participants.size });
  });

  // In production the same service serves the built React app
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  io.on('connection', (socket) => {
    new MessageHandler(socket, rooms).attach();
  });

  return { app, httpServer, io, rooms };
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const { httpServer } = createApp();
  httpServer.listen(PORT, () => {
    console.log(`Watch party server listening on http://localhost:${PORT}`);
  });
}
