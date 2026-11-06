// ============================================================
// titler.ts — names a session after what it is actually about.
//
// A session's title is generated from its content ("Newton's Laws of
// Motion"), not copied from the first thing the student said ("can you hear
// me?"). It runs in the background after the first answer, is refined as the
// lesson develops (at 6 and 12 turns), and never overrides a title the
// student typed.
// ============================================================

import { countSessionTurns, getSession, loadSessionTurns, setSessionTitle, sessionsNeedingTitle } from './contextStore';
import { getLanguage } from './languages';
import { completeText, hasBackgroundLlm } from './llmText';

/** Turn counts after which an auto title is (re)generated. */
const RETITLE_AT = new Set([2, 6, 12]);

type TitleListener = (sessionId: string, title: string) => void;
let listener: TitleListener | null = null;
const queue: string[] = [];
let running = false;

export function onSessionTitled(cb: TitleListener): void {
  listener = cb;
}

/** Called after each answer is stored; queues a (re)title when it is due. */
export function maybeTitleSession(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s || s.title_source === 'user') return;
  const turns = countSessionTurns(sessionId);
  if (s.title_source === null ? turns >= 2 : RETITLE_AT.has(turns)) enqueue(sessionId);
}

/** At startup: name sessions saved before titles were generated. */
export function titleBacklog(): void {
  if (!hasBackgroundLlm()) return;
  for (const id of sessionsNeedingTitle(30)) enqueue(id);
}

function enqueue(sessionId: string): void {
  if (!hasBackgroundLlm() || queue.includes(sessionId)) return;
  queue.push(sessionId);
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const title = await generateTitle(id);
        if (title && setSessionTitle(id, title, 'auto')) {
          console.log(`[titler] ${id.slice(0, 8)} → "${title}"`);
          listener?.(id, title);
        }
      } catch (err) {
        console.error(`[titler] could not title ${id}: ${(err as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

export async function generateTitle(sessionId: string): Promise<string | null> {
  const s = getSession(sessionId);
  if (!s) return null;
  const turns = loadSessionTurns(sessionId, 12);
  if (turns.length === 0) return null;
  const lang = getLanguage(s.language);

  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'Student' : 'Teacher'}: ${t.content.slice(0, 600)}`)
    .join('\n');

  const prompt = `Here is a tutoring conversation between a student and a teacher.

${transcript}

Write a title for this study session: 3 to 5 words naming the subject or topic being learned, like a chapter heading (for example "Newton's Laws of Motion" or "Photosynthesis in Plants"). Ignore greetings and small talk. If no topic has come up yet, describe what the student asked for in the same short style.
Write the title in ${lang.label}${lang.id === 'en' || lang.id === 'hinglish' ? '' : ` (${lang.nativeLabel})`}.
Reply with the title only: no quotes, no punctuation at the end, no explanation.`;

  const raw = await completeText(prompt, 400, 0.2);
  return cleanTitle(raw);
}

/** First line, no quotes/markdown/trailing punctuation, at most ~8 words. */
export function cleanTitle(raw: string): string | null {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const title = line
    .replace(/^(title|शीर्षक)\s*[:：-]\s*/i, '')
    .replace(/[*_#`"“”«»]/g, '')
    .replace(/^['‘’]+|['‘’]+$/g, '') // wrapping quotes only — keep "Newton's"
    .replace(/[.。!?।:;,\s]+$/u, '')
    .trim();
  if (!title) return null;
  const words = title.split(/\s+/);
  return (words.length > 8 ? words.slice(0, 8).join(' ') : title).slice(0, 80);
}
