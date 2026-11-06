// ============================================================
// api.ts — the agent server's small HTTP API (see src/httpApi.ts).
// Same-origin in production; proxied by Vite in development.
// ============================================================

import type { LanguageId, LearnerProfile, SessionGroup, SessionSummary, VoiceOption } from './protocol.ts';

export interface ProfileSnapshot {
  memory_enabled: boolean;
  profile: LearnerProfile;
}

export interface SessionsSnapshot {
  groups: SessionGroup[];
  sessions: SessionSummary[];
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const fetchSessions = () => request<SessionsSnapshot>('GET', '/api/sessions');

export const renameSession = (id: string, title: string) =>
  request<SessionsSnapshot>('PATCH', `/api/sessions/${encodeURIComponent(id)}`, { title });

export const moveSession = (id: string, groupId: string | null) =>
  request<SessionsSnapshot>('PATCH', `/api/sessions/${encodeURIComponent(id)}`, { group_id: groupId });

export const deleteSession = (id: string) =>
  request<SessionsSnapshot>('DELETE', `/api/sessions/${encodeURIComponent(id)}`);

export const createGroup = (name: string) =>
  request<SessionsSnapshot & { group: SessionGroup }>('POST', '/api/groups', { name });

export const renameGroup = (id: string, name: string) =>
  request<SessionsSnapshot>('PATCH', `/api/groups/${encodeURIComponent(id)}`, { name });

export const deleteGroup = (id: string) =>
  request<SessionsSnapshot>('DELETE', `/api/groups/${encodeURIComponent(id)}`);

export const fetchProfile = () => request<ProfileSnapshot>('GET', '/api/profile');

/** Forget one fact, or one item of a list fact. */
export const forgetFact = (key: string, item?: string) =>
  request<ProfileSnapshot>(
    'DELETE',
    `/api/profile/${encodeURIComponent(key)}${item !== undefined ? `?item=${encodeURIComponent(item)}` : ''}`,
  );

export const forgetEverything = () => request<ProfileSnapshot>('DELETE', '/api/profile');

export const setMemoryEnabled = (on: boolean) => request<ProfileSnapshot>('PATCH', '/api/settings', { memory_enabled: on });

export async function fetchVoices(): Promise<{ model: string; default_voice: string; voices: VoiceOption[] }> {
  return request('GET', '/api/voices');
}

/**
 * Fetch a voice sample as a playable object URL. Errors carry the server's
 * message (e.g. the API key is missing), so the picker can say what went wrong.
 */
export async function fetchVoicePreview(voice: string, language: LanguageId): Promise<string> {
  const res = await fetch(`/api/voice-preview?voice=${encodeURIComponent(voice)}&language=${language}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}
