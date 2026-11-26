import { FormEvent, useState } from 'react';
import { extractVideoId } from '../lib/youtube';
import type { Role } from '../lib/types';

interface Props {
  isController: boolean;
  role?: Role;
  onSubmit: (url: string) => Promise<{ ok: boolean }>;
}

export function VideoForm({ isController, role, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (role === 'viewer') return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!extractVideoId(value)) {
      setError('Paste a YouTube link like youtube.com/watch?v=… or youtu.be/…');
      return;
    }
    setError(null);
    const res = await onSubmit(value);
    if (res.ok) setValue('');
  };

  return (
    <form className="video-form" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder="Paste a YouTube link"
        aria-label="YouTube link"
      />
      <button className="btn primary" type="submit" disabled={!value.trim()}>
        {isController ? 'Play now' : 'Suggest'}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
