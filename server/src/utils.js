import { randomBytes } from 'node:crypto';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

export function generateRoomCode(length = 6) {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

export function generateId(size = 10) {
  return randomBytes(size).toString('base64url').slice(0, size);
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Accepts a raw video id or most common YouTube url shapes and returns the 11 char id.
 * Returns null if nothing usable is found.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (VIDEO_ID_RE.test(value)) return value;

  let url;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;

  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (url.searchParams.get('v')) {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (match) id = match[1];
    }
  }

  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}
