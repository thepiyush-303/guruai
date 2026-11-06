// ============================================================
// sessionMemory.ts — the structured context of ONE study session.
//
// What the teacher knows about this lesson between turns: what it is about,
// the gist so far, the lesson plan (the topic split into chunks, each with a
// status), what the student understood or struggled with, and what was
// offered at the end of the last answer. Stored as JSON in session_context,
// updated in the background after every exchange (memoryUpdater.ts), read
// before every answer and whenever the session is reopened.
//
// Everything coming from the LLM passes through normalizeSessionMemory, so a
// sloppy or malformed update can never corrupt what is stored.
// ============================================================

import { getSessionContextRow, saveSessionContextRow } from '../contextStore';

export type ChunkStatus = 'pending' | 'explained' | 'understood' | 'struggling';
export type LastOffer = 'example' | 'next_chunk' | 'quiz' | null;

export interface LessonChunk {
  title: string;
  status: ChunkStatus;
}

export interface Lesson {
  goal: string;
  chunks: LessonChunk[];
  /** Index of the chunk to teach next (chunks.length when the lesson is done). */
  next: number;
}

export interface SessionMemory {
  topic: string | null;
  gist: string;
  lesson: Lesson | null;
  student: { understood: string[]; struggling: string[]; misconceptions: string[] };
  last_offer: LastOffer;
}

export const MAX_CHUNKS = 8;
export const MAX_LIST = 5;
const MAX_GIST_CHARS = 1200;
const MAX_ITEM_CHARS = 120;

const STATUSES: ChunkStatus[] = ['pending', 'explained', 'understood', 'struggling'];
const OFFERS: Exclude<LastOffer, null>[] = ['example', 'next_chunk', 'quiz'];

export function emptyMemory(): SessionMemory {
  return { topic: null, gist: '', lesson: null, student: { understood: [], struggling: [], misconceptions: [] }, last_offer: null };
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function list(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const t = text(item, MAX_ITEM_CHARS);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(-MAX_LIST); // keep the most recent
}

function lesson(v: unknown, prev: Lesson | null): Lesson | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return prev;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.chunks)) return prev;
  const chunks: LessonChunk[] = [];
  for (const c of o.chunks) {
    const title = text(typeof c === 'string' ? c : (c as Record<string, unknown>)?.title, MAX_ITEM_CHARS);
    if (!title) continue;
    const status = (c as Record<string, unknown>)?.status;
    chunks.push({ title, status: STATUSES.includes(status as ChunkStatus) ? (status as ChunkStatus) : 'pending' });
    if (chunks.length >= MAX_CHUNKS) break;
  }
  if (chunks.length === 0) return prev;
  const rawNext = typeof o.next === 'number' && Number.isFinite(o.next) ? Math.floor(o.next) : firstOpen(chunks);
  return {
    goal: text(o.goal, 200) ?? prev?.goal ?? '',
    chunks,
    next: Math.min(Math.max(rawNext, 0), chunks.length),
  };
}

function firstOpen(chunks: LessonChunk[]): number {
  const i = chunks.findIndex((c) => c.status === 'pending' || c.status === 'struggling');
  return i < 0 ? chunks.length : i;
}

/**
 * Validate an LLM-proposed memory against the previous one. Fields that are
 * missing or malformed keep their previous value; nothing is trusted blindly.
 */
export function normalizeSessionMemory(raw: unknown, prev: SessionMemory = emptyMemory()): SessionMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prev;
  const o = raw as Record<string, unknown>;
  const s = (o.student && typeof o.student === 'object' ? o.student : {}) as Record<string, unknown>;
  return {
    topic: o.topic === null ? null : text(o.topic, 80) ?? prev.topic,
    gist: text(o.gist, MAX_GIST_CHARS) ?? prev.gist,
    lesson: 'lesson' in o ? lesson(o.lesson, prev.lesson) : prev.lesson,
    student: {
      understood: list(s.understood, prev.student.understood),
      struggling: list(s.struggling, prev.student.struggling),
      misconceptions: list(s.misconceptions, prev.student.misconceptions),
    },
    last_offer: o.last_offer === null ? null : OFFERS.includes(o.last_offer as never) ? (o.last_offer as LastOffer) : prev.last_offer,
  };
}

/** The stored memory of a session (empty if none), and the last turn it covers. */
export function loadSessionMemory(sessionId: string): { memory: SessionMemory; uptoTurnId: number } {
  const row = getSessionContextRow(sessionId);
  if (!row) return { memory: emptyMemory(), uptoTurnId: 0 };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    /* corrupt row — start clean */
  }
  return { memory: normalizeSessionMemory(parsed, emptyMemory()), uptoTurnId: row.upto_turn_id };
}

export function saveSessionMemory(sessionId: string, memory: SessionMemory, uptoTurnId: number): void {
  saveSessionContextRow(sessionId, JSON.stringify(memory), uptoTurnId);
}

/** What the client shows as lesson progress. */
export interface SessionContextView {
  topic: string | null;
  gist: string;
  chunks: LessonChunk[];
  next: number;
}

export function viewOf(memory: SessionMemory): SessionContextView {
  return {
    topic: memory.topic,
    gist: memory.gist,
    chunks: memory.lesson?.chunks ?? [],
    next: memory.lesson?.next ?? 0,
  };
}
