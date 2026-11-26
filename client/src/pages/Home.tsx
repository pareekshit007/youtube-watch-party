import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, getRoom } from '../lib/api';
import { getSavedName, getSessionId, saveName } from '../lib/session';

function parseRoomCode(input: string) {
  const value = input.trim();
  // allow pasting the full invite link
  const match = value.match(/room\/([A-Za-z0-9]+)/);
  return (match ? match[1] : value).toUpperCase();
}

export function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(getSavedName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requireName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a display name first');
      return null;
    }
    saveName(trimmed);
    return trimmed;
  };

  const handleCreate = async () => {
    const username = requireName();
    if (!username) return;
    setBusy('create');
    setError(null);
    try {
      const { roomId } = await createRoom(getSessionId());
      navigate(`/room/${roomId}`, { state: { username } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    const username = requireName();
    if (!username) return;
    const roomId = parseRoomCode(code);
    if (!roomId) return setError('Enter a room code or invite link');
    setBusy('join');
    setError(null);
    try {
      await getRoom(roomId);
      navigate(`/room/${roomId}`, { state: { username } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="home">
      <section className="hero">
        <div className="brand">
          <span className="brand-mark">▶</span> WatchParty
        </div>
        <h1>
          Same video.
          <br />
          Same second.
          <br />
          <span className="accent">Different couches.</span>
        </h1>
        <p className="lede">
          Start a room, send the code, and everyone's YouTube player moves together. The host stays in charge of
          the remote.
        </p>
        <ul className="features">
          <li>Play, pause and seek synced over WebSockets</li>
          <li>Host, moderator, participant and viewer roles</li>
          <li>Participants can request changes for approval</li>
          <li>Live chat and reactions</li>
        </ul>
      </section>

      <section className="card join-card">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya"
            maxLength={24}
            autoFocus
          />
        </label>

        <button className="btn primary big" onClick={handleCreate} disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create a watch party'}
        </button>

        <div className="divider">
          <span>or join one</span>
        </div>

        <form onSubmit={handleJoin} className="join-form">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Room code or invite link"
            aria-label="Room code"
          />
          <button className="btn" type="submit" disabled={busy !== null}>
            {busy === 'join' ? 'Joining…' : 'Join'}
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
