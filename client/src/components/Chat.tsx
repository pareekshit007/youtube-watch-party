import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../lib/types';

interface Props {
  messages: ChatMessage[];
  selfId?: string;
  onSend: (text: string) => void;
  onReact: (emoji: string) => void;
}

const EMOJIS = ['👍', '😂', '😮', '❤️', '🔥', '👏', '😢', '🎉'];

export function Chat({ messages, selfId, onSend, onReact }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <p className="empty muted">Say hi 👋</p>}
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className="chat-system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`chat-message ${m.userId === selfId ? 'mine' : ''}`}>
              <div className="chat-meta">
                <span className="chat-author">{m.username}</span>
                {m.role && m.role !== 'participant' && <span className={`role-dot role-${m.role}`}>{m.role}</span>}
                <time>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
              <p>{m.text}</p>
            </div>
          ),
        )}
      </div>

      <div className="emoji-bar">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => onReact(e)} aria-label={`React ${e}`}>
            {e}
          </button>
        ))}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the room"
          maxLength={500}
        />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
