# YouTube Watch Party

Watch YouTube videos together in real time. One person creates a room, shares the code or link, and everyone's player stays in sync. Play, pause, seek and video changes go through a WebSocket server, and roles decide who's allowed to control playback.

**Live demo:** https://youtube-watch-party-ds8q.onrender.com

## Features

- Create a room (you become **Host**) or join with a 6 character code / invite link
- Synced play, pause, seek and change video (paste any YouTube link)
- Late joiners land at the right position in the current video
- Roles: **Host**, **Moderator**, **Participant**, **Viewer**
  - Host can promote/demote, remove people, and transfer host
  - Participants can't control playback directly. Pressing play/pause (or clicking the video), skipping ±10s, dragging the progress bar or pasting a link sends a **request** that a host or moderator approves or declines
  - Viewers can only watch and chat
- Permissions are checked on the server, not only in the UI
- Refreshing the page keeps your identity and role (15s reconnect grace period)
- If the host leaves, the longest-present moderator (or participant) becomes host
- Chat, emoji reactions that float over the video, toasts for request results

## Try it in 1 minute

1. Open the live link, enter a name and click **Create a watch party**. You are the Host.
2. Click **Copy invite** and open the link in an incognito window (or on your phone). That user joins as a Participant.
3. As Host, press play, pause, seek or paste a new YouTube link: the other window follows.
4. As the Participant, press play or +10: the Host gets a request in the **Requests** tab to approve or decline.
5. In the **People** tab, the Host can make the Participant a Moderator (they can now control playback), remove them, or hand over host with 👑.

## Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite, React Router |
| Backend | Node.js + Express |
| Real-time | Socket.IO (WebSocket transport, falls back to polling) |
| Video | YouTube IFrame Player API |
| Storage | In-memory (see trade-offs) |
| Hosting | Render (single web service) |

## Running locally

Requires Node 20+.

```bash
# install both apps
npm run install:all

# terminal 1 - API + WebSocket server on :4000
npm run dev:server

# terminal 2 - React dev server on :5173 (proxies /api and /socket.io to :4000)
npm run dev:client
```

Open http://localhost:5173. To try it with several users, open more tabs or an incognito window. Each tab is its own user.

Production-like run (server also serves the built React app):

```bash
npm run build
npm start          # http://localhost:4000
```

Tests (Socket.IO integration tests for roles, sync and requests):

```bash
npm test
```

## Deployment (Render)

The repo has a `render.yaml`, so you can use **New → Blueprint** on Render and point it at the repo. Or create a Web Service by hand:

- Build command: `npm run build`
- Start command: `npm start`
- Health check path: `/api/health`
- Env: `NODE_VERSION=20`

Frontend and backend run as **one service**: Express serves `client/dist` and Socket.IO is attached to the same HTTP server. That means no CORS setup and no separate WebSocket URL. Render supports WebSockets on web services out of the box.

Optional env vars:

| Var | Where | Purpose |
| --- | --- | --- |
| `PORT` | server | Render sets this automatically |
| `CLIENT_ORIGIN` | server | Comma separated allowed origins, only if the frontend is hosted elsewhere (e.g. Vercel) |
| `VITE_SERVER_URL` | client (build time) | Backend URL, only if the frontend is hosted elsewhere |

Note: the free Render plan sleeps after inactivity, so the first request can take ~30s to wake up. Rooms live in memory, so a restart clears them.

## Architecture

```
 Browser (React)                                   Node server
┌────────────────────────┐   HTTP  POST /api/rooms   ┌─────────────────────────────┐
│ Home: create / join    │ ───────────────────────▶ │ Express                     │
│                        │                           │   RoomManager (Map of rooms)│
│ Room page              │   WebSocket (Socket.IO)   │                             │
│  useRoom hook ─────────┼◀═══════════════════════▶ │ MessageHandler (per socket) │
│  Player (YT IFrame API)│   join_room, play, seek,  │   - checks membership       │
│  Participants / Chat   │   sync_state, role_...    │   - checks role permission  │
│  Request queue         │                           │   - updates Room, broadcasts│
└────────────────────────┘                           │ Room → Participant,         │
                                                     │        PlaybackState        │
                                                     └─────────────────────────────┘
```

### How sync works

1. The server is the single source of truth. Each room has a `PlaybackState`: `videoId`, `playState`, `position` and `updatedAt`.
2. Instead of broadcasting the time every second, the server stores "the video was at X seconds at time T and is playing". The current position is `position + (now - updatedAt)` while playing.
3. When the host presses play/pause/seek, the client sends the event. The server checks the role, updates the state and broadcasts `sync_state` to everyone in the Socket.IO room (`room:<code>`), the host included.
4. Each client applies `sync_state` to its YouTube player: load the video if it changed, seek if it's more than ~1.2s off, then play or pause.
5. Every 2 seconds each client compares its player to the expected position and corrects drift locally (no network traffic). Buffering is ignored so a slow connection doesn't get stuck in a seek loop.
6. New joiners get the full state in the `join_room` acknowledgement, so they start at the right spot.

The YouTube player is created with `controls: 0` and a transparent layer sits on top of it. All interaction goes through our own control bar (clicking the video toggles play/pause for hosts and moderators, and sends a request for participants). That way the app always knows *who* did something, and nobody can bypass the roles by clicking the iframe.

Browsers block autoplay with sound until the user interacts with the page. Creating/joining a room is a click, which covers most cases. If the browser still blocks it, the player shows a "click to catch up" overlay.

### Role-based access

Permissions are defined in one place (`server/src/constants.js`):

| Action | Host | Moderator | Participant | Viewer |
| --- | :-: | :-: | :-: | :-: |
| play / pause / seek / change_video | ✅ | ✅ | request | ❌ |
| approve / decline requests | ✅ | ✅ | ❌ | ❌ |
| assign_role, remove_participant, transfer_host | ✅ | ❌ | ❌ | ❌ |
| chat & reactions | ✅ | ✅ | ✅ | ✅ |

Every socket event is registered through `MessageHandler.register(event, action, handler)`. Before the handler runs it:

1. looks up the room and the participant tied to this socket, and
2. calls `can(role, action)`. If that fails, the event is rejected with an error, and the room state is never touched.

So even if someone edits the frontend or sends events by hand from the console, a participant can't play/pause/seek. The UI hides or changes controls based on role, but that's only for convenience.

Identity: the browser keeps a random `sessionId` in `sessionStorage`. The server maps it to a participant and only ever shares the public participant `id`. Whoever creates the room via `POST /api/rooms` is stored as the host session. Removed users' sessions are banned from rejoining that room.

### Code structure

```
server/src
├── index.js               Express app, REST routes, Socket.IO setup, serves client build
├── constants.js           roles, permission table, limits
├── utils.js               room codes, YouTube URL parsing, input sanitising
├── RoomManager.js         creates/looks up rooms, cleans up empty ones
├── models/
│   ├── Room.js            participants, roles, requests, chat, broadcast helpers
│   ├── Participant.js     one user in a room
│   └── PlaybackState.js   video state + "current time" calculation
└── socket/
    └── MessageHandler.js  one per connection, validates + handles every event

client/src
├── hooks/useRoom.ts       socket connection, all room state, actions
├── components/Player.tsx  YouTube player + sync logic + custom controls
├── components/…           ParticipantList, RequestQueue, Chat, VideoForm
├── pages/Home.tsx         create / join
└── pages/RoomPage.tsx     room layout
```

## WebSocket events

Client → server (all use Socket.IO acknowledgements, reply is `{ ok, error? }`):

| Event | Payload | Who |
| --- | --- | --- |
| `join_room` | `{ roomId, username, sessionId }` | anyone (gets Host if creator, else Participant) |
| `leave_room` | `{}` | anyone |
| `play` / `pause` | `{ time? }` | host, moderator |
| `seek` | `{ time }` | host, moderator |
| `change_video` | `{ url }` or `{ videoId }` | host, moderator |
| `request_change` | `{ type, time?, url? }` | participant |
| `resolve_request` | `{ requestId, approve }` | host, moderator |
| `assign_role` | `{ userId, role }` | host |
| `remove_participant` | `{ userId }` | host |
| `transfer_host` | `{ userId }` | host |
| `chat_message` | `{ text }` | everyone |
| `reaction` | `{ emoji }` | everyone |
| `sync_request` | `{}` | everyone (resend current state) |

Server → clients:

| Event | Payload |
| --- | --- |
| `sync_state` | `{ videoId, playState, currentTime, serverTime }` |
| `user_joined` | `{ userId, username, role, participants }` |
| `user_left` | `{ userId, username, participants }` |
| `role_assigned` | `{ userId, username, role, participants }` |
| `participant_removed` | `{ userId, username, participants }` |
| `participants_updated` | `{ participants }` (someone went offline) |
| `requests_updated` | `{ requests }` (host/mods only) |
| `request_created` | request (host/mods only) |
| `request_resolved` | `{ requestId, type, approved, by }` (to the requester) |
| `chat_message`, `reaction` | message / reaction |
| `kicked`, `session_replaced`, `error_message` | |

## Trade-offs and what I'd do next

- **In-memory state.** Simple and fast, and enough for the MVP, but rooms disappear on restart and it only works on one instance. Next step would be SQLite/Postgres for room metadata (persistent rooms).
- **Scaling to many instances.** Socket.IO rooms are per process. To run several instances behind a load balancer I'd add the [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/) so broadcasts reach sockets on other servers, move room state into Redis (hash per room), and enable sticky sessions for the polling fallback. The `RoomManager`/`Room` classes are the only places that touch state, so that change stays contained.
- **Sync accuracy.** Clients use the time they *received* the state instead of comparing server and client clocks. That avoids clock skew issues but ignores network latency (usually < 100ms), which is fine for watching together.
- **No accounts.** Identity is a per-tab session id. Good enough for a watch party, but proper auth would be needed for persistent rooms.
- **Ads / unavailable videos.** Some videos can't be embedded or show ads, which can put people a few seconds apart. Drift correction pulls them back once the ad ends.
