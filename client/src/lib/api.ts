export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export function createRoom(sessionId: string) {
  return request<{ roomId: string; name: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export function getRoom(roomId: string) {
  return request<{ roomId: string; name: string; participants: number }>(
    `/api/rooms/${encodeURIComponent(roomId)}`,
  );
}
