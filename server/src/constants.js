export const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
  VIEWER: 'viewer',
});

// Roles the host is allowed to hand out through assign_role.
// Host itself can only move via transfer_host.
export const ASSIGNABLE_ROLES = [ROLES.MODERATOR, ROLES.PARTICIPANT, ROLES.VIEWER];

export const ACTIONS = Object.freeze({
  PLAYBACK: 'playback', // play / pause / seek / change_video
  RESOLVE_REQUEST: 'resolve_request',
  ASSIGN_ROLE: 'assign_role',
  REMOVE_PARTICIPANT: 'remove_participant',
  TRANSFER_HOST: 'transfer_host',
  REQUEST_CHANGE: 'request_change',
  CHAT: 'chat',
});

const PERMISSIONS = {
  [ROLES.HOST]: Object.values(ACTIONS),
  [ROLES.MODERATOR]: [ACTIONS.PLAYBACK, ACTIONS.RESOLVE_REQUEST, ACTIONS.CHAT],
  [ROLES.PARTICIPANT]: [ACTIONS.REQUEST_CHANGE, ACTIONS.CHAT],
  // viewers are purely passive: they can chat but can't ask for playback changes
  [ROLES.VIEWER]: [ACTIONS.CHAT],
};

export function can(role, action) {
  return PERMISSIONS[role]?.includes(action) ?? false;
}

export const REQUEST_TYPES = ['play', 'pause', 'seek', 'change_video'];

export const DEFAULT_VIDEO_ID = 'aqz-KE-bpKQ';

// how long we keep a disconnected user around (page refresh, flaky wifi)
export const RECONNECT_GRACE_MS = 15_000;
// how long an empty room survives before it is cleaned up
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;

export const MAX_CHAT_HISTORY = 100;
export const MAX_PENDING_REQUESTS = 20;
