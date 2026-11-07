// ============================================================
// library.ts — the student's saved sessions, groups and the voices on
// offer. Loaded once by the shell and shared through context with the
// sidebar and every page.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from './api.ts';
import type { SessionGroup, SessionSummary, VoiceOption } from './protocol.ts';

export interface SessionActions {
  rename: (id: string, title: string) => Promise<void>;
  move: (id: string, groupId: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export interface GroupActions {
  create: (name: string) => Promise<SessionGroup>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export interface Library {
  sessions: SessionSummary[];
  groups: SessionGroup[];
  voices: VoiceOption[];
  defaultVoice: string | null;
  loaded: boolean;
  error: string | null;
  refresh: () => void;
  sessionActions: SessionActions;
  groupActions: GroupActions;
}

export function useLibraryState(): Library {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [defaultVoice, setDefaultVoice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((snap: api.SessionsSnapshot) => {
    setSessions(snap.sessions);
    setGroups(snap.groups);
    setLoaded(true);
    setError(null);
  }, []);

  const refresh = useCallback(() => {
    api
      .fetchSessions()
      .then(apply)
      .catch((err: Error) => {
        setLoaded(true);
        setError(`Could not load your sessions: ${err.message}`);
      });
  }, [apply]);

  useEffect(() => {
    refresh();
    api
      .fetchVoices()
      .then((v) => {
        setVoices(v.voices);
        setDefaultVoice(v.default_voice);
      })
      .catch(() => {
        /* the new-session page explains that voices are unavailable */
      });
  }, [refresh]);

  const sessionActions = useMemo<SessionActions>(
    () => ({
      rename: async (id, title) => apply(await api.renameSession(id, title)),
      move: async (id, groupId) => apply(await api.moveSession(id, groupId)),
      remove: async (id) => apply(await api.deleteSession(id)),
    }),
    [apply],
  );

  const groupActions = useMemo<GroupActions>(
    () => ({
      create: async (name) => {
        const res = await api.createGroup(name);
        apply(res);
        return res.group;
      },
      rename: async (id, name) => apply(await api.renameGroup(id, name)),
      remove: async (id) => apply(await api.deleteGroup(id)),
    }),
    [apply],
  );

  return { sessions, groups, voices, defaultVoice, loaded, error, refresh, sessionActions, groupActions };
}

export const LibraryContext = createContext<Library | null>(null);

export function useLibrary(): Library {
  const lib = useContext(LibraryContext);
  if (!lib) throw new Error('useLibrary outside LibraryContext');
  return lib;
}

/** "3:40 PM", "Yesterday", "Monday", "12 Mar". */
export function relativeDay(ts: number): string {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ts >= startOfToday - day) return 'Yesterday';
  if (ts >= startOfToday - 6 * day) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
