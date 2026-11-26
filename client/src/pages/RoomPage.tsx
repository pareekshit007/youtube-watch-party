import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom';
import { getSavedName, getSessionId, saveName } from '../lib/session';
import { Player } from '../components/Player';
import { ParticipantList } from '../components/ParticipantList';
import { RequestQueue } from '../components/RequestQueue';
import { Chat } from '../components/Chat';
import { VideoForm } from '../components/VideoForm';

/**
 * Coming from the home page we already have a name and a user click (needed so the
 * browser lets the video autoplay). Opening an invite link directly shows a small join step.
 */
export function RoomPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const passedName = (location.state as { username?: string } | null)?.username;
  const [username, setUsername] = useState<string | null>(passedName ?? null);

  if (!username) return <JoinGate roomId={roomId} onJoin={setUsername} />;
  return <Room roomId={roomId.toUpperCase()} username={username} />;
}

function JoinGate({ roomId, onJoin }: { roomId: string; onJoin: (name: string) => void }) {
  const [name, setName] = useState(getSavedName());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    saveName(trimmed);
    onJoin(trimmed);
  };
  return (
    <main className="center-screen">
      <form className="card gate" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">▶</span> WatchParty
        </div>
        <h2>You're invited</h2>
        <p className="muted">
          Room <code>{roomId.toUpperCase()}</code>
        </p>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus />
        </label>
        <button className="btn primary big" type="submit" disabled={!name.trim()}>
          Join the party
        </button>
      </form>
    </main>
  );
}

type Tab = 'people' | 'chat' | 'requests';

function Room({ roomId, username }: { roomId: string; username: string }) {
  const sessionId = useMemo(() => getSessionId(), []);
  const room = useRoom({ roomId, username, sessionId });
  const [tab, setTab] = useState<Tab>('chat');
  const [unread, setUnread] = useState(0);
  const [lastSeen, setLastSeen] = useState(0);

  const userMessages = room.chat.filter((m) => !m.system).length;
  useEffect(() => {
    if (tab === 'chat') {
      setLastSeen(userMessages);
      setUnread(0);
    } else {
      setUnread(Math.max(0, userMessages - lastSeen));
    }
  }, [userMessages, tab, lastSeen]);

  useEffect(() => {
    document.title = `Room ${roomId} · WatchParty`;
    return () => {
      document.title = 'WatchParty';
    };
  }, [roomId]);

  const inviteLink = `${window.location.origin}/room/${roomId}`;
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      room.toast('Invite link copied', 'success');
    } catch {
      room.toast(inviteLink);
    }
  };

  if (room.status === 'error' || room.status === 'kicked' || room.status === 'replaced') {
    const message =
      room.status === 'kicked'
        ? 'The host removed you from this room.'
        : room.status === 'replaced'
          ? 'This room was opened in another tab with the same session.'
          : room.error;
    return (
      <main className="center-screen">
        <div className="card gate">
          <h2>{room.status === 'kicked' ? 'Removed from room' : "Can't join"}</h2>
          <p className="muted">{message}</p>
          <Link className="btn primary big" to="/">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const showRequests = room.isController;

  return (
    <div className="room">
      <header className="room-header">
        <Link to="/" className="brand small">
          <span className="brand-mark">▶</span> WatchParty
        </Link>
        <div className="room-code">
          <span className="muted">Room</span>
          <code>{roomId}</code>
          <button className="btn tiny" onClick={copyInvite}>
            Copy invite
          </button>
        </div>
        <div className="header-right">
          {room.status === 'reconnecting' && <span className="pill warn">Reconnecting…</span>}
          {room.status === 'connecting' && <span className="pill">Connecting…</span>}
          {room.role && <span className={`role-badge role-${room.role}`}>You: {room.role}</span>}
        </div>
      </header>

      <div className="room-body">
        <section className="stage">
          <Player
            syncState={room.syncState}
            isController={room.isController}
            role={room.role}
            reactions={room.reactions}
            onAction={room.actions.sendPlayback}
            onResync={room.actions.requestSync}
          />
          <VideoForm
            isController={room.isController}
            role={room.role}
            onSubmit={(url) => room.actions.sendPlayback({ type: 'change_video', url })}
          />
          {!room.isController && room.role && (
            <p className="hint">
              {room.role === 'viewer'
                ? 'You are a viewer: sit back and watch. The host can give you a different role.'
                : 'Only the host and moderators control playback. Your play, pause, seek and video changes are sent as requests for approval.'}
            </p>
          )}
        </section>

        <aside className="sidebar">
          <nav className="tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              Chat {unread > 0 && <span className="count">{unread}</span>}
            </button>
            <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
              People <span className="count soft">{room.participants.length}</span>
            </button>
            {showRequests && (
              <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
                Requests {room.requests.length > 0 && <span className="count">{room.requests.length}</span>}
              </button>
            )}
          </nav>

          <div className="tab-panel">
            {tab === 'chat' && (
              <Chat
                messages={room.chat}
                selfId={room.self?.id}
                onSend={room.actions.sendChat}
                onReact={room.actions.react}
              />
            )}
            {tab === 'people' && (
              <ParticipantList
                participants={room.participants}
                self={room.self}
                onAssignRole={room.actions.assignRole}
                onRemove={room.actions.removeParticipant}
                onTransferHost={room.actions.transferHost}
              />
            )}
            {tab === 'requests' && showRequests && (
              <RequestQueue requests={room.requests} onResolve={room.actions.resolveRequest} />
            )}
            {tab === 'requests' && !showRequests && <p className="empty muted">Requests are for hosts and moderators.</p>}
          </div>
        </aside>
      </div>

      <div className="toasts" role="status">
        {room.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
