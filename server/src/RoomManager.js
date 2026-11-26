import { Room } from './models/Room.js';
import { generateRoomCode } from './utils.js';
import { EMPTY_ROOM_TTL_MS } from './constants.js';

/**
 * Keeps all rooms in memory and cleans up the ones nobody is using.
 * For a multi-instance setup this is the part that would move to Redis (see README).
 */
export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    this.cleanupInterval.unref?.();
  }

  createRoom({ hostSessionId, name }) {
    let id;
    do {
      id = generateRoomCode();
    } while (this.rooms.has(id));

    const room = new Room({ id, hostSessionId, io: this.io, name });
    this.rooms.set(id, room);
    return room;
  }

  get(roomId) {
    if (typeof roomId !== 'string') return undefined;
    return this.rooms.get(roomId.trim().toUpperCase());
  }

  delete(roomId) {
    this.rooms.delete(roomId);
  }

  cleanup(now = Date.now()) {
    for (const [id, room] of this.rooms) {
      if (room.participants.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(id);
      }
    }
  }

  stats() {
    let users = 0;
    for (const room of this.rooms.values()) users += room.participants.size;
    return { rooms: this.rooms.size, users };
  }

  stop() {
    clearInterval(this.cleanupInterval);
  }
}
