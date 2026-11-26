import { ACTIONS, ASSIGNABLE_ROLES, REQUEST_TYPES, ROLES, RECONNECT_GRACE_MS, can } from '../constants.js';
import { extractVideoId, isFiniteNumber, sanitizeText } from '../utils.js';

const MAX_SEEK_SECONDS = 24 * 60 * 60;
const REACTIONS = ['👍', '😂', '😮', '❤️', '🔥', '👏', '😢', '🎉'];

class PermissionError extends Error {}

/**
 * One instance per socket connection.
 * Every incoming event goes through `register`, which makes sure the socket is in a room
 * and that the caller's role allows the action *before* any room state is touched.
 */
export class MessageHandler {
  /**
   * @param {import('socket.io').Socket} socket
   * @param {import('../RoomManager.js').RoomManager} rooms
   */
  constructor(socket, rooms) {
    this.socket = socket;
    this.rooms = rooms;
    this.roomId = null;
    this.participantId = null;
  }

  attach() {
    const s = this.socket;
    s.on('join_room', (data, ack) => this.safe(ack, () => this.handleJoin(data)));
    s.on('leave_room', (_data, ack) => this.safe(ack, () => this.handleLeave()));
    s.on('sync_request', (_data, ack) => this.safe(ack, () => this.handleSyncRequest()));

    this.register('play', ACTIONS.PLAYBACK, this.handlePlay);
    this.register('pause', ACTIONS.PLAYBACK, this.handlePause);
    this.register('seek', ACTIONS.PLAYBACK, this.handleSeek);
    this.register('change_video', ACTIONS.PLAYBACK, this.handleChangeVideo);

    this.register('request_change', ACTIONS.REQUEST_CHANGE, this.handleRequestChange);
    this.register('resolve_request', ACTIONS.RESOLVE_REQUEST, this.handleResolveRequest);

    this.register('assign_role', ACTIONS.ASSIGN_ROLE, this.handleAssignRole);
    this.register('remove_participant', ACTIONS.REMOVE_PARTICIPANT, this.handleRemoveParticipant);
    this.register('transfer_host', ACTIONS.TRANSFER_HOST, this.handleTransferHost);

    this.register('chat_message', ACTIONS.CHAT, this.handleChat);
    this.register('reaction', ACTIONS.CHAT, this.handleReaction);

    s.on('disconnect', () => this.handleDisconnect());
  }

  // ---------- plumbing ----------

  register(event, action, handler) {
    this.socket.on(event, (data, ack) =>
      this.safe(ack, () => {
        const { room, me } = this.requireMembership();
        if (!can(me.role, action)) {
          throw new PermissionError(`Your role (${me.role}) is not allowed to do "${event}"`);
        }
        return handler.call(this, room, me, data ?? {});
      }),
    );
  }

  safe(ack, fn) {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const result = fn();
      reply({ ok: true, ...(result || {}) });
    } catch (err) {
      const message = err?.message || 'Something went wrong';
      if (!(err instanceof PermissionError) && !err.expected) {
        console.error('[socket]', this.socket.id, err);
      }
      this.socket.emit('error_message', { message });
      reply({ ok: false, error: message });
    }
  }

  requireMembership() {
    const room = this.roomId && this.rooms.get(this.roomId);
    const me = room?.get(this.participantId);
    if (!room || !me) throw expected('You are not in a room');
    return { room, me };
  }

  // ---------- join / leave ----------

  handleJoin({ roomId, username, sessionId } = {}) {
    const name = sanitizeText(username, 24);
    const sid = sanitizeText(sessionId, 64);
    if (!name) throw expected('Please enter a name');
    if (sid.length < 8) throw expected('Missing session id');

    const room = this.rooms.get(roomId);
    if (!room) throw expected('Room not found. Check the code or create a new room.');
    if (room.isBanned(sid)) throw expected('You were removed from this room by the host');

    // switching rooms from the same socket
    if (this.roomId && this.roomId !== room.id) this.handleLeave();

    const { participant, isNew } = room.join({ sessionId: sid, username: name });

    // same session open in another tab: kick the old tab out
    if (participant.socketId && participant.socketId !== this.socket.id) {
      const old = this.socket.nsp.sockets.get(participant.socketId);
      old?.emit('session_replaced');
      old?.leave(room.channel);
    }

    const wasDisconnected = !participant.connected;
    participant.attachSocket(this.socket.id);
    this.roomId = room.id;
    this.participantId = participant.id;
    this.socket.join(room.channel);

    if (isNew || wasDisconnected) {
      this.socket.to(room.channel).emit('user_joined', {
        userId: participant.id,
        username: participant.username,
        role: participant.role,
        participants: room.participantList(),
      });
    }
    if (isNew) room.systemMessage(`${participant.username} joined as ${participant.role}`);

    return { room: room.snapshotFor(participant) };
  }

  handleLeave() {
    const room = this.roomId && this.rooms.get(this.roomId);
    const me = room?.get(this.participantId);
    this.socket.leave(`room:${this.roomId}`);
    this.roomId = null;
    this.participantId = null;
    if (room && me) this.removeFromRoom(room, me, { reason: 'left' });
  }

  handleDisconnect() {
    const room = this.roomId && this.rooms.get(this.roomId);
    const me = room?.get(this.participantId);
    if (!room || !me || me.socketId !== this.socket.id) return;

    // don't remove straight away, a page refresh would otherwise cost the host their role
    me.detachSocket();
    room.broadcast('participants_updated', { participants: room.participantList() });

    me.disconnectTimer = setTimeout(() => {
      if (!me.connected && room.get(me.id)) this.removeFromRoom(room, me, { reason: 'left' });
    }, RECONNECT_GRACE_MS);
    me.disconnectTimer.unref?.();
  }

  removeFromRoom(room, participant, { reason, ban = false }) {
    const wasHost = participant.isHost;
    room.remove(participant.id, { ban });

    if (reason === 'removed') {
      room.broadcast('participant_removed', {
        userId: participant.id,
        username: participant.username,
        participants: room.participantList(),
      });
      room.systemMessage(`${participant.username} was removed by the host`);
    } else {
      room.broadcast('user_left', {
        userId: participant.id,
        username: participant.username,
        participants: room.participantList(),
      });
      room.systemMessage(`${participant.username} left`);
    }

    if (wasHost && room.participants.size > 0) {
      const next = room.promoteNextHost();
      if (next) {
        room.broadcast('role_assigned', {
          userId: next.id,
          username: next.username,
          role: next.role,
          participants: room.participantList(),
        });
        room.systemMessage(`${next.username} is now the host`);
        this.pushRequestsTo(room, next);
      }
    }
    room.broadcastToControllers('requests_updated', { requests: room.pendingRequests() });
  }

  handleSyncRequest() {
    const { room } = this.requireMembership();
    this.socket.emit('sync_state', room.playback.toJSON());
  }

  // ---------- playback (host + moderator) ----------

  handlePlay(room, me, { time }) {
    room.playback.play(this.parseTime(time, true));
    room.broadcastState();
  }

  handlePause(room, me, { time }) {
    room.playback.pause(this.parseTime(time, true));
    room.broadcastState();
  }

  handleSeek(room, me, { time }) {
    room.playback.seek(this.parseTime(time));
    room.broadcastState();
  }

  handleChangeVideo(room, me, { videoId, url }) {
    const id = extractVideoId(videoId ?? url);
    if (!id) throw expected('That does not look like a valid YouTube link');
    room.playback.changeVideo(id);
    room.broadcastState();
    room.systemMessage(`${me.username} changed the video`);
  }

  parseTime(time, optional = false) {
    if (time === undefined || time === null) {
      if (optional) return undefined;
      throw expected('Missing time');
    }
    if (!isFiniteNumber(time) || time < 0 || time > MAX_SEEK_SECONDS) throw expected('Invalid time');
    return time;
  }

  // ---------- participant requests ----------

  handleRequestChange(room, me, { type, time, videoId, url }) {
    if (!REQUEST_TYPES.includes(type)) throw expected('Unknown request type');

    const payload = {};
    if (type === 'seek') payload.time = this.parseTime(time);
    if (type === 'change_video') {
      const id = extractVideoId(videoId ?? url);
      if (!id) throw expected('That does not look like a valid YouTube link');
      payload.videoId = id;
    }

    const request = room.createRequest(me, type, payload);
    room.broadcastToControllers('requests_updated', { requests: room.pendingRequests() });
    room.broadcastToControllers('request_created', request);
    return { requestId: request.id };
  }

  handleResolveRequest(room, me, { requestId, approve }) {
    const request = room.takeRequest(requestId);
    if (!request) throw expected('That request is no longer pending');

    if (approve) {
      const { type, payload } = request;
      if (type === 'play') room.playback.play();
      if (type === 'pause') room.playback.pause();
      if (type === 'seek') room.playback.seek(payload.time);
      if (type === 'change_video') room.playback.changeVideo(payload.videoId);
      room.broadcastState();
    }

    const requester = room.get(request.from.id);
    if (requester?.socketId) {
      this.socket.nsp.to(requester.socketId).emit('request_resolved', {
        requestId: request.id,
        type: request.type,
        approved: !!approve,
        by: me.username,
      });
    }
    if (approve) {
      room.systemMessage(`${me.username} approved ${request.from.username}'s ${labelFor(request.type)} request`);
    }
    room.broadcastToControllers('requests_updated', { requests: room.pendingRequests() });
  }

  // ---------- host only ----------

  handleAssignRole(room, me, { userId, role }) {
    if (!ASSIGNABLE_ROLES.includes(role)) throw expected('Invalid role');
    if (userId === me.id) throw expected('Use transfer host to give away your role');

    const target = room.assignRole(userId, role);
    room.broadcast('role_assigned', {
      userId: target.id,
      username: target.username,
      role: target.role,
      participants: room.participantList(),
    });
    room.systemMessage(`${target.username} is now a ${target.role}`);
    this.pushRequestsTo(room, target);
  }

  handleRemoveParticipant(room, me, { userId }) {
    if (userId === me.id) throw expected('You cannot remove yourself');
    const target = room.get(userId);
    if (!target) throw expected('Participant not found');

    if (target.socketId) {
      const targetSocket = this.socket.nsp.sockets.get(target.socketId);
      targetSocket?.emit('kicked', { roomId: room.id });
      targetSocket?.leave(room.channel);
    }
    this.removeFromRoom(room, target, { reason: 'removed', ban: true });
  }

  handleTransferHost(room, me, { userId }) {
    const target = room.transferHost(me.id, userId);
    room.broadcast('role_assigned', {
      userId: target.id,
      username: target.username,
      role: target.role,
      participants: room.participantList(),
    });
    room.systemMessage(`${me.username} handed host over to ${target.username}`);
    this.pushRequestsTo(room, target);
  }

  // ---------- chat & reactions ----------

  handleChat(room, me, { text }) {
    const clean = sanitizeText(text, 500);
    if (!clean) throw expected('Message is empty');
    room.broadcast('chat_message', room.addChatMessage(me, clean));
  }

  handleReaction(room, me, { emoji }) {
    if (!REACTIONS.includes(emoji)) throw expected('Unknown reaction');
    room.broadcast('reaction', { emoji, userId: me.id, username: me.username, at: Date.now() });
  }

  // Someone who just became host/mod needs the current request queue
  pushRequestsTo(room, participant) {
    if (!participant.socketId) return;
    const requests =
      participant.role === ROLES.HOST || participant.role === ROLES.MODERATOR ? room.pendingRequests() : [];
    this.socket.nsp.to(participant.socketId).emit('requests_updated', { requests });
  }
}

function expected(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}

function labelFor(type) {
  return { play: 'play', pause: 'pause', seek: 'seek', change_video: 'video change' }[type] ?? type;
}
