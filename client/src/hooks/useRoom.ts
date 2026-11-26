import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SERVER_URL } from '../lib/api';
import type {
  Ack,
  ChangeRequest,
  ChatMessage,
  Participant,
  PlaybackAction,
  RequestType,
  Role,
  RoomSnapshot,
  SyncState,
} from '../lib/types';
import { canControl } from '../lib/types';

export type RoomStatus = 'connecting' | 'joined' | 'reconnecting' | 'kicked' | 'replaced' | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

export interface Reaction {
  id: number;
  emoji: string;
  username: string;
  left: number;
}

interface Options {
  roomId: string;
  username: string;
  sessionId: string;
}

export function useRoom({ roomId, username, sessionId }: Options) {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL || undefined, {
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;

    const applySnapshot = (room: RoomSnapshot) => {
      setSelfId(room.self.id);
      setParticipants(room.participants);
      setSyncState(room.state);
      setRequests(room.requests);
      setChat(room.chat);
    };

    // (re)join every time we (re)connect, the server recognises us by sessionId
    socket.on('connect', () => {
      socket.emit('join_room', { roomId, username, sessionId }, (res: Ack) => {
        if (res.ok && res.room) {
          applySnapshot(res.room);
          setStatus('joined');
          setError(null);
        } else {
          setStatus('error');
          setError(res.error ?? 'Could not join the room');
          socket.disconnect();
        }
      });
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') setStatus((s) => (s === 'joined' ? 'reconnecting' : s));
    });

    socket.on('sync_state', (state: SyncState) => setSyncState(state));

    const updateList = ({ participants }: { participants: Participant[] }) => setParticipants(participants);
    socket.on('participants_updated', updateList);
    socket.on('user_joined', updateList);
    socket.on('user_left', updateList);
    socket.on('participant_removed', updateList);
    socket.on('role_assigned', updateList);

    socket.on('requests_updated', ({ requests }: { requests: ChangeRequest[] }) => setRequests(requests));
    socket.on('request_created', (req: ChangeRequest) => {
      toast(`${req.from.username} sent a ${labelForRequest(req.type)} request`);
    });
    socket.on('request_resolved', (res: { approved: boolean; type: RequestType; by: string }) => {
      toast(
        res.approved
          ? `${res.by} approved your ${labelForRequest(res.type)} request`
          : `${res.by} declined your ${labelForRequest(res.type)} request`,
        res.approved ? 'success' : 'error',
      );
    });

    socket.on('chat_message', (msg: ChatMessage) => setChat((c) => [...c.slice(-199), msg]));

    socket.on('reaction', ({ emoji, username }: { emoji: string; username: string }) => {
      const id = Date.now() + Math.random();
      setReactions((r) => [...r.slice(-20), { id, emoji, username, left: 10 + Math.random() * 80 }]);
      setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2600);
    });

    socket.on('kicked', () => {
      setStatus('kicked');
      socket.disconnect();
    });
    socket.on('session_replaced', () => {
      setStatus('replaced');
      socket.disconnect();
    });
    socket.on('error_message', ({ message }: { message: string }) => toast(message, 'error'));

    return () => {
      socket.emit('leave_room');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, username, sessionId, toast]);

  const self = participants.find((p) => p.id === selfId);
  const role: Role | undefined = self?.role;
  const isController = canControl(role);

  const emit = useCallback((event: string, payload: object = {}) => {
    return new Promise<Ack>((resolve) => {
      const socket = socketRef.current;
      if (!socket?.connected) return resolve({ ok: false, error: 'Not connected' });
      socket.timeout(5000).emit(event, payload, (err: Error | null, res: Ack) => {
        resolve(err ? { ok: false, error: 'Server did not respond' } : res);
      });
    });
  }, []);

  /**
   * Host/mods send playback events directly, everyone else turns them into a request
   * that a host or moderator has to approve.
   */
  const sendPlayback = useCallback(
    async (action: PlaybackAction) => {
      const { type, ...payload } = action;
      if (isController) return emit(type, payload);
      if (role === 'viewer') {
        toast('Viewers can only watch. Ask the host for a different role.', 'error');
        return { ok: false };
      }
      const res = await emit('request_change', { type, ...payload });
      if (res.ok) toast(`Request sent to the host`, 'success');
      return res;
    },
    [emit, isController, role, toast],
  );

  const actions = {
    sendPlayback,
    requestSync: () => emit('sync_request'),
    resolveRequest: (requestId: string, approve: boolean) => emit('resolve_request', { requestId, approve }),
    assignRole: (userId: string, role: Role) => emit('assign_role', { userId, role }),
    removeParticipant: (userId: string) => emit('remove_participant', { userId }),
    transferHost: (userId: string) => emit('transfer_host', { userId }),
    sendChat: (text: string) => emit('chat_message', { text }),
    react: (emoji: string) => emit('reaction', { emoji }),
  };

  return {
    status,
    error,
    self,
    role,
    isController,
    participants,
    syncState,
    requests,
    chat,
    reactions,
    toasts,
    toast,
    actions,
  };
}

export function labelForRequest(type: RequestType) {
  return { play: 'play', pause: 'pause', seek: 'seek', change_video: 'video change' }[type];
}
