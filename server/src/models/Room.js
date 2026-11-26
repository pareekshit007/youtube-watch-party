import { Participant } from './Participant.js';
import { PlaybackState } from './PlaybackState.js';
import { generateId } from '../utils.js';
import { ROLES, MAX_CHAT_HISTORY, MAX_PENDING_REQUESTS } from '../constants.js';

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.id             room code
   * @param {string} opts.hostSessionId  session of the creator, they become host on first join
   * @param {import('socket.io').Server} opts.io
   * @param {string} [opts.name]
   */
  constructor({ id, hostSessionId, io, name }) {
    this.id = id;
    this.name = name || `Room ${id}`;
    this.io = io;
    this.createdAt = Date.now();
    this.hostSessionId = hostSessionId;

    this.participants = new Map(); // participantId -> Participant
    this.sessions = new Map(); // sessionId -> participantId
    this.bannedSessions = new Set();

    this.playback = new PlaybackState();
    this.requests = new Map(); // requestId -> request
    this.chat = [];

    this.emptySince = Date.now();
  }

  get channel() {
    return `room:${this.id}`;
  }

  // ---------- broadcasting ----------

  broadcast(event, payload) {
    this.io.to(this.channel).emit(event, payload);
  }

  /** Emit only to people who can approve requests (host + moderators) */
  broadcastToControllers(event, payload) {
    for (const p of this.participants.values()) {
      if (p.socketId && (p.role === ROLES.HOST || p.role === ROLES.MODERATOR)) {
        this.io.to(p.socketId).emit(event, payload);
      }
    }
  }

  broadcastState() {
    this.broadcast('sync_state', this.playback.toJSON());
  }

  // ---------- participants ----------

  isBanned(sessionId) {
    return this.bannedSessions.has(sessionId);
  }

  findBySession(sessionId) {
    const id = this.sessions.get(sessionId);
    return id ? this.participants.get(id) : undefined;
  }

  get(participantId) {
    return this.participants.get(participantId);
  }

  get host() {
    for (const p of this.participants.values()) if (p.isHost) return p;
    return undefined;
  }

  /**
   * Adds a participant or re-attaches an existing one (refresh / reconnect).
   * Returns { participant, isNew }.
   */
  join({ sessionId, username }) {
    const existing = this.findBySession(sessionId);
    if (existing) {
      existing.username = username || existing.username;
      return { participant: existing, isNew: false };
    }

    // The creator gets host. If the creator never shows up (or left) and there is
    // no host at all, whoever joins first takes over so the room isn't stuck.
    let role = ROLES.PARTICIPANT;
    if (sessionId === this.hostSessionId || !this.host) role = ROLES.HOST;

    const participant = new Participant({ sessionId, username, role });
    this.participants.set(participant.id, participant);
    this.sessions.set(sessionId, participant.id);
    this.emptySince = null;
    return { participant, isNew: true };
  }

  remove(participantId, { ban = false } = {}) {
    const participant = this.participants.get(participantId);
    if (!participant) return undefined;

    participant.clearDisconnectTimer();
    this.participants.delete(participantId);
    this.sessions.delete(participant.sessionId);
    if (ban) this.bannedSessions.add(participant.sessionId);

    // drop any pending requests from this person
    for (const [reqId, req] of this.requests) {
      if (req.from.id === participantId) this.requests.delete(reqId);
    }

    if (this.participants.size === 0) this.emptySince = Date.now();
    return participant;
  }

  assignRole(participantId, role) {
    const target = this.participants.get(participantId);
    if (!target) throw new Error('Participant not found');
    if (target.isHost) throw new Error('Use transfer host to change the host role');
    target.setRole(role);
    return target;
  }

  transferHost(fromId, toId) {
    const from = this.participants.get(fromId);
    const to = this.participants.get(toId);
    if (!from || !to) throw new Error('Participant not found');
    if (from.id === to.id) throw new Error('You are already the host');
    from.setRole(ROLES.MODERATOR);
    to.setRole(ROLES.HOST);
    this.hostSessionId = to.sessionId;
    return to;
  }

  /**
   * Called when the host leaves. Picks the longest-present moderator, otherwise the
   * longest-present participant. Returns the new host or undefined if room is empty.
   */
  promoteNextHost() {
    const candidates = [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const next =
      candidates.find((p) => p.role === ROLES.MODERATOR && p.connected) ||
      candidates.find((p) => p.connected) ||
      candidates[0];
    if (!next) return undefined;
    next.setRole(ROLES.HOST);
    this.hostSessionId = next.sessionId;
    return next;
  }

  participantList() {
    const order = { host: 0, moderator: 1, participant: 2, viewer: 3 };
    return [...this.participants.values()]
      .sort((a, b) => order[a.role] - order[b.role] || a.joinedAt - b.joinedAt)
      .map((p) => p.toJSON());
  }

  // ---------- change requests (participants asking host/mod) ----------

  createRequest(from, type, payload) {
    // one pending request of each type per person is enough, replace the older one
    for (const [id, req] of this.requests) {
      if (req.from.id === from.id && req.type === type) this.requests.delete(id);
    }
    if (this.requests.size >= MAX_PENDING_REQUESTS) {
      const oldest = this.requests.keys().next().value;
      this.requests.delete(oldest);
    }

    const request = {
      id: generateId(8),
      type,
      payload,
      from: { id: from.id, username: from.username },
      createdAt: Date.now(),
    };
    this.requests.set(request.id, request);
    return request;
  }

  takeRequest(requestId) {
    const request = this.requests.get(requestId);
    if (request) this.requests.delete(requestId);
    return request;
  }

  pendingRequests() {
    return [...this.requests.values()];
  }

  // ---------- chat ----------

  addChatMessage(from, text) {
    const message = {
      id: generateId(8),
      userId: from?.id ?? null,
      username: from?.username ?? 'system',
      role: from?.role ?? null,
      text,
      system: !from,
      createdAt: Date.now(),
    };
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT_HISTORY) this.chat.shift();
    return message;
  }

  systemMessage(text) {
    const message = this.addChatMessage(null, text);
    this.broadcast('chat_message', message);
  }

  // ---------- serialisation ----------

  snapshotFor(participant) {
    const canSeeRequests = participant.role === ROLES.HOST || participant.role === ROLES.MODERATOR;
    return {
      roomId: this.id,
      name: this.name,
      self: participant.toJSON(),
      participants: this.participantList(),
      state: this.playback.toJSON(),
      requests: canSeeRequests ? this.pendingRequests() : [],
      chat: this.chat,
    };
  }
}
