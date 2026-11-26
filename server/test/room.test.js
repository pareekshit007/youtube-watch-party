import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/index.js';
import { extractVideoId } from '../src/utils.js';

let server, url, rooms;
const sockets = [];

before(async () => {
  const app = createApp();
  server = app.httpServer;
  rooms = app.rooms;
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});

after(() => {
  sockets.forEach((s) => s.close());
  rooms.stop();
  server.closeAllConnections?.(); server.close();
});

const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const once = (s, ev) => new Promise((r) => s.once(ev, r));

async function client(roomId, username, sessionId = `sess-${username}-${Math.random()}`) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  await once(s, 'connect');
  const res = await emit(s, 'join_room', { roomId, username, sessionId });
  return { s, res, sessionId };
}

async function createRoom(sessionId) {
  const r = await fetch(`${url}/api/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  return (await r.json()).roomId;
}

test('video id parsing', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
});

test('roles, permissions, sync, requests, removal', async () => {
  const hostSession = 'host-session-123';
  const roomId = await createRoom(hostSession);

  const host = await client(roomId, 'Alice', hostSession);
  assert.equal(host.res.ok, true);
  assert.equal(host.res.room.self.role, 'host');

  const joinedEvt = once(host.s, 'user_joined');
  const bob = await client(roomId, 'Bob');
  assert.equal(bob.res.room.self.role, 'participant');
  const joined = await joinedEvt;
  assert.equal(joined.participants.length, 2);

  // participant cannot control playback
  const denied = await emit(bob.s, 'play', {});
  assert.equal(denied.ok, false);
  const deniedVideo = await emit(bob.s, 'change_video', { url: 'dQw4w9WgXcQ' });
  assert.equal(deniedVideo.ok, false);

  // host play -> everyone gets sync_state
  const syncP = once(bob.s, 'sync_state');
  assert.equal((await emit(host.s, 'play', { time: 10 })).ok, true);
  const st = await syncP;
  assert.equal(st.playState, 'playing');
  assert.ok(st.currentTime >= 10);

  // seek
  const seekP = once(bob.s, 'sync_state');
  await emit(host.s, 'seek', { time: 42 });
  assert.ok(Math.abs((await seekP).currentTime - 42) < 0.5);

  // participant request -> host approves
  const reqP = once(host.s, 'request_created');
  const r = await emit(bob.s, 'request_change', { type: 'change_video', url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(r.ok, true);
  const req = await reqP;
  const resolvedP = once(bob.s, 'request_resolved');
  const changedP = once(bob.s, 'sync_state');
  await emit(host.s, 'resolve_request', { requestId: req.id, approve: true });
  assert.equal((await resolvedP).approved, true);
  assert.equal((await changedP).videoId, 'dQw4w9WgXcQ');

  // promote bob to moderator -> he can pause
  const bobId = bob.res.room.self.id;
  const roleP = once(bob.s, 'role_assigned');
  await emit(host.s, 'assign_role', { userId: bobId, role: 'moderator' });
  assert.equal((await roleP).role, 'moderator');
  assert.equal((await emit(bob.s, 'pause', {})).ok, true);
  // but moderator cannot assign roles
  assert.equal((await emit(bob.s, 'assign_role', { userId: host.res.room.self.id, role: 'viewer' })).ok, false);

  // late joiner gets current state
  const carol = await client(roomId, 'Carol');
  assert.equal(carol.res.room.state.videoId, 'dQw4w9WgXcQ');
  assert.equal(carol.res.room.state.playState, 'paused');

  // remove carol -> kicked and banned
  const kickedP = once(carol.s, 'kicked');
  await emit(host.s, 'remove_participant', { userId: carol.res.room.self.id });
  await kickedP;
  const rejoin = await emit(carol.s, 'join_room', { roomId, username: 'Carol', sessionId: carol.sessionId });
  assert.equal(rejoin.ok, false);

  // transfer host to bob
  const transferP = once(host.s, 'role_assigned');
  await emit(host.s, 'transfer_host', { userId: bobId });
  const t = await transferP;
  assert.equal(t.role, 'host');
  assert.equal(t.participants.find((p) => p.username === 'Alice').role, 'moderator');

  // host leaving promotes someone
  const promoP = once(host.s, 'role_assigned');
  await emit(bob.s, 'leave_room', {});
  const promo = await promoP;
  assert.equal(promo.username, 'Alice');
  assert.equal(promo.role, 'host');
});

test('unknown room is rejected', async () => {
  const x = await client('NOPE99', 'Zed');
  assert.equal(x.res.ok, false);
});
