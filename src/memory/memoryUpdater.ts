// ============================================================
// memoryUpdater.ts — keeps the session memory and the learner profile up
// to date, in the background, after every exchange.
//
// One JSON LLM call per run: previous memory + profile + the new turns in,
// an updated memory (gist, topic, lesson plan with chunk status, student
// understanding, last offer) and any new personal facts out. It never blocks
// an answer — the next answer simply uses whatever memory is stored by then.
// Runs are serial per session; exchanges that arrive during a run are folded
// into the next one.
// ============================================================

import { getSession, getSessionTurnsAfter } from '../contextStore';
import { SerialJobs } from '../util/serialJobs';
import { loadNotes, setNotesEnabled } from '../notes/notesAgent';
import { getLanguage } from '../languages';
import { completeJson, hasBackgroundLlm } from '../llmText';
import { LIST_KEYS, SCALAR_KEYS, loadProfile, memoryEnabled, mergeProfileFacts, renderProfile } from './learnerProfile';
import {
  loadSessionMemory, normalizeSessionMemory, saveSessionMemory, viewOf, MAX_CHUNKS,
  type SessionContextView, type SessionMemory,
} from './sessionMemory';

/** At most this many new turns are folded in per run (older ones are in the gist). */
const MAX_NEW_TURNS = 6;

type JsonCompleter = (prompt: string, maxTokens: number) => Promise<Record<string, unknown>>;
type UpdateListener = (sessionId: string, view: SessionContextView) => void;

let completer: JsonCompleter = completeJson;
let hasLlm: () => boolean = hasBackgroundLlm;
let listener: UpdateListener | null = null;

const jobs = new SerialJobs((sessionId) => runOnce(sessionId));

/** Tests: replace the LLM. */
export function setMemoryCompleter(fn: JsonCompleter, available: () => boolean = () => true): void {
  completer = fn;
  hasLlm = available;
}

/** Notified with the client-facing view after each successful update. */
export function onMemoryUpdated(cb: UpdateListener): void {
  listener = cb;
}

/** Fire-and-forget entry point, called after each stored answer. */
export function updateMemoryBackground(sessionId: string): void {
  void updateMemory(sessionId);
}

/** Run (or schedule) an update; resolves when this session's runs are done. */
export async function updateMemory(sessionId: string): Promise<void> {
  if (!hasLlm()) return;
  await jobs.trigger(sessionId);
}

async function runOnce(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  const { memory: prev, uptoTurnId } = loadSessionMemory(sessionId);
  const all = getSessionTurnsAfter(sessionId, uptoTurnId, 50);
  if (all.length === 0) return;
  const turns = all.slice(-MAX_NEW_TURNS);
  const lastId = all[all.length - 1].id ?? uptoTurnId;

  const prompt = buildUpdatePrompt(prev, renderProfile(loadProfile()), turns, getLanguage(session.language).label, memoryEnabled());

  let result: Record<string, unknown>;
  try {
    result = await completer(prompt, 1500);
  } catch (err) {
    console.error(`[memory] update failed for ${sessionId.slice(0, 8)}: ${(err as Error).message}`);
    return; // keep the previous memory; the same turns are retried next time
  }

  const memory = normalizeSessionMemory(result.memory ?? result, prev);
  saveSessionMemory(sessionId, memory, lastId);
  const changedFacts = mergeProfileFacts(result.profile_facts, sessionId);

  // The student asked to start or stop notes (by voice, in any language).
  if (result.notes_request === 'on' || result.notes_request === 'off') {
    const on = result.notes_request === 'on';
    if (loadNotes(sessionId).enabled !== on) setNotesEnabled(sessionId, on);
  }

  const lesson = memory.lesson ? `${memory.lesson.chunks.length} chunks, next ${memory.lesson.next + 1}` : 'no lesson';
  console.log(
    `[memory] ${sessionId.slice(0, 8)}: topic=${JSON.stringify(memory.topic)} ${lesson}` +
    (changedFacts.length ? `; remembered ${changedFacts.join(', ')}` : ''),
  );
  listener?.(sessionId, viewOf(memory));
}

export function buildUpdatePrompt(
  prev: SessionMemory,
  profileLines: string[],
  turns: Array<{ role: string; content: string }>,
  languageLabel: string,
  rememberFacts: boolean,
): string {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'STUDENT' : 'TEACHER'}: ${t.content.slice(0, 1500)}`)
    .join('\n');

  const factsRule = rememberFacts
    ? `"profile_facts": personal facts the STUDENT stated about THEMSELVES in the new turns, as [{"key": ..., "value": ...}].
  Allowed keys — single values: ${SCALAR_KEYS.join(', ')}; lists (value may be a string or an array): ${LIST_KEYS.join(', ')}.
  Use "interests" for hobbies and things they like (great for analogies), "learning_preferences" for how they like to learn ("likes examples first"), "difficulties" for subjects or skills they find hard.
  Only what they actually said — never guess. NEVER record religion, caste, health, money, phone numbers, addresses or other contact details. Use [] if there is nothing new.`
    : '"profile_facts": always [] (the student has switched memory off).';

  return `You keep the memory of a voice tutoring session between a TEACHER and a STUDENT (the conversation is in ${languageLabel}). Update it with the new turns.

CURRENT MEMORY:
${JSON.stringify(prev)}

WHAT IS KNOWN ABOUT THE STUDENT:
${profileLines.length ? profileLines.join('\n') : '(nothing yet)'}

NEW TURNS:
${transcript}

Return ONE JSON object: {"memory": {...}, "profile_facts": [...], "notes_request": "on" | "off" | null}

"memory" has exactly these fields (write them in English):
- "topic": the subject being learned now, 2–5 words, or null if none yet.
- "gist": up to 150 words — what has been covered in this whole session, what the student understood or found hard, and exactly where the lesson stopped. Merge the old gist with the new turns; keep important earlier points.
- "lesson": the plan for the current topic, or null if there is no topic yet:
    {"goal": one sentence, "chunks": [{"title": short name of one small idea, "status": "pending" | "explained" | "understood" | "struggling"}], "next": index (0-based) of the chunk to teach next}
  Split the topic into 3–${MAX_CHUNKS} chunks, simplest first, building on each other. Keep the existing chunks and update their status from the new turns:
    "explained" once the teacher taught it; "understood" when the student answered correctly or said they get it; "struggling" when they answered wrongly or were confused.
  If the student switched to a different topic, replace the plan with one for the new topic.
- "student": {"understood": [...], "struggling": [...], "misconceptions": [...]} — short phrases, most recent last, max 5 each.
- "last_offer": what the teacher's LAST message ended with: "example" (offered an example), "next_chunk" (offered to move on), "quiz" (asked a question), or null.

${factsRule}

"notes_request": "off" if the STUDENT asked in the new turns to stop or not make notes (e.g. "no notes", "notes mat banao", "stop writing notes"); "on" if they asked to make or start notes again; otherwise null.`;
}

/** The current view of a session's memory, for the client. */
export function currentView(sessionId: string): SessionContextView {
  return viewOf(loadSessionMemory(sessionId).memory);
}
