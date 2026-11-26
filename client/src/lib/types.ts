export type Role = 'host' | 'moderator' | 'participant' | 'viewer';

export interface Participant {
  id: string;
  username: string;
  role: Role;
  connected: boolean;
  joinedAt: number;
}

export interface SyncState {
  videoId: string;
  playState: 'playing' | 'paused';
  currentTime: number;
  serverTime: number;
}

export type RequestType = 'play' | 'pause' | 'seek' | 'change_video';

export interface ChangeRequest {
  id: string;
  type: RequestType;
  payload: { time?: number; videoId?: string };
  from: { id: string; username: string };
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string | null;
  username: string;
  role: Role | null;
  text: string;
  system: boolean;
  createdAt: number;
}

export interface RoomSnapshot {
  roomId: string;
  name: string;
  self: Participant;
  participants: Participant[];
  state: SyncState;
  requests: ChangeRequest[];
  chat: ChatMessage[];
}

export interface Ack<T = Record<string, unknown>> {
  ok: boolean;
  error?: string;
  room?: RoomSnapshot;
  data?: T;
}

export type PlaybackAction =
  | { type: 'play'; time?: number }
  | { type: 'pause'; time?: number }
  | { type: 'seek'; time: number }
  | { type: 'change_video'; url: string };

export const canControl = (role?: Role) => role === 'host' || role === 'moderator';
