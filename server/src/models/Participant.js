import { generateId } from '../utils.js';
import { ROLES } from '../constants.js';

export class Participant {
  /**
   * @param {object} opts
   * @param {string} opts.sessionId  private id kept in the browser, used to recognise reconnects
   * @param {string} opts.username
   * @param {string} [opts.role]
   */
  constructor({ sessionId, username, role = ROLES.PARTICIPANT }) {
    this.id = generateId(); // public id, safe to share with other clients
    this.sessionId = sessionId;
    this.username = username;
    this.role = role;
    this.socketId = null;
    this.joinedAt = Date.now();
    this.connected = false;
    this.disconnectTimer = null;
  }

  attachSocket(socketId) {
    this.socketId = socketId;
    this.connected = true;
    this.clearDisconnectTimer();
  }

  detachSocket() {
    this.socketId = null;
    this.connected = false;
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  setRole(role) {
    this.role = role;
  }

  get isHost() {
    return this.role === ROLES.HOST;
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      connected: this.connected,
      joinedAt: this.joinedAt,
    };
  }
}
