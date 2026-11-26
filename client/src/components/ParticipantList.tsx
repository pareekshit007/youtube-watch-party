import { useState } from 'react';
import type { Participant, Role } from '../lib/types';

interface Props {
  participants: Participant[];
  self?: Participant;
  onAssignRole: (userId: string, role: Role) => void;
  onRemove: (userId: string) => void;
  onTransferHost: (userId: string) => void;
}

const ROLE_LABEL: Record<Role, string> = {
  host: 'Host',
  moderator: 'Moderator',
  participant: 'Participant',
  viewer: 'Viewer',
};

export function ParticipantList({ participants, self, onAssignRole, onRemove, onTransferHost }: Props) {
  const isHost = self?.role === 'host';
  const [confirming, setConfirming] = useState<{ id: string; kind: 'remove' | 'transfer' } | null>(null);

  return (
    <ul className="participants">
      {participants.map((p) => {
        const isSelf = p.id === self?.id;
        const pending = confirming?.id === p.id ? confirming.kind : null;
        return (
          <li key={p.id} className={`participant ${p.connected ? '' : 'offline'}`}>
            <div className="avatar" data-role={p.role}>
              {p.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="participant-info">
              <div className="participant-name">
                {p.username}
                {isSelf && <span className="you">you</span>}
              </div>
              <span className={`role-badge role-${p.role}`}>{ROLE_LABEL[p.role]}</span>
              {!p.connected && <span className="offline-label">reconnecting…</span>}
            </div>

            {isHost && !isSelf && (
              <div className="participant-actions">
                {pending ? (
                  <>
                    <span className="confirm-text">{pending === 'remove' ? 'Remove?' : 'Make host?'}</span>
                    <button
                      className="btn tiny danger"
                      onClick={() => {
                        if (pending === 'remove') onRemove(p.id);
                        else onTransferHost(p.id);
                        setConfirming(null);
                      }}
                    >
                      Yes
                    </button>
                    <button className="btn tiny ghost" onClick={() => setConfirming(null)}>
                      No
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      value={p.role}
                      onChange={(e) => onAssignRole(p.id, e.target.value as Role)}
                      aria-label={`Role for ${p.username}`}
                    >
                      <option value="moderator">Moderator</option>
                      <option value="participant">Participant</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      className="icon-btn"
                      title="Transfer host"
                      onClick={() => setConfirming({ id: p.id, kind: 'transfer' })}
                    >
                      👑
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Remove from room"
                      onClick={() => setConfirming({ id: p.id, kind: 'remove' })}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
