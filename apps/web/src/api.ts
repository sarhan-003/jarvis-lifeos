import type { ChatResponse, HealthResponse } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the Parcel Concierge agent API. Is it running?");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const sendMessage = (sessionId: string, message: string) => request<ChatResponse>('/api/chat', json({ sessionId, message }));
export const resetDemo = (sessionId: string) => request<{ ok: boolean; dataReset: boolean }>('/api/reset', json({ sessionId }));
export const getHealth = () => request<HealthResponse>('/api/health');
