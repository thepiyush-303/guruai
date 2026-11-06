// ============================================================
// teacher.ts — GuruAI's teaching method, as a system prompt.
//
// Pure: everything it needs is passed in (preferences, the learner profile,
// this session's memory, other recent sessions). Rebuilt before every answer,
// so the latest lesson state is always what the model sees.
//
// The method — "intuition first", one chunk at a time:
//   1. intuition: what the idea is and why it matters, in plain words
//   2. an analogy from the student's own daily life (Indian context)
//   3. the bridge back to the real concept and its proper term
//   4. hand the turn back: one check question, or an offer of an example
// …then respond to what the student says before moving on.
// ============================================================

import { getLanguage } from '../languages';
import { voicesForModel } from '../voices';
import type { SessionPreferences } from '../types';
import { renderProfile, type LearnerProfile } from '../memory/learnerProfile';
import type { SessionMemory } from '../memory/sessionMemory';

export type OpenerKind = 'new' | 'resumed';

export interface TeacherPromptInput {
  prefs: SessionPreferences;
  profile: LearnerProfile;
  memory: SessionMemory;
  /** Titles of other recent sessions, newest first. */
  recentSessions: string[];
  /** Whether written notes are being kept for this session (undefined: don't mention). */
  notesEnabled?: boolean;
}

const STATUS_WORD: Record<string, string> = {
  pending: 'not yet taught',
  explained: 'explained, not yet checked',
  understood: 'understood',
  struggling: 'student struggled — revisit differently',
};

function levelLine(prefs: SessionPreferences, profile: LearnerProfile): string {
  const grade = prefs.grade ?? profile.class;
  const board = prefs.board ?? profile.board;
  const g = grade === 'college' ? 'a college student' : grade ? `a Class ${grade} student` : '';
  const b = board === 'STATE' ? 'a State board' : board && board !== 'OTHER' ? `the ${board} board` : '';
  if (g && b) return `The student is ${g} following ${b} syllabus. Pitch depth, vocabulary and examples at that level (follow NCERT terminology for CBSE and State boards).`;
  if (g) return `The student is ${g}. Pitch depth, vocabulary and examples at that level.`;
  if (b) return `The student follows ${b} syllabus.`;
  return "The student's class is not known; if the depth of an answer depends on it, ask once, briefly.";
}

const METHOD = `HOW YOU TEACH — one small chunk per reply:
A topic is never explained all at once. Split it into small chunks (one idea each) and teach ONE chunk per reply, then let the student respond.
Each chunk follows this order:
1. Intuition first: one or two plain sentences on what the idea is and why it matters.
2. An analogy from the student's daily life in India — cricket, local trains and buses, a pressure cooker, chai cooling, monsoon rain, a kirana shop, festivals, mobile data, a school assembly. If you know the student's interests, use them.
3. Bridge back: say clearly which real concept the analogy stands for, and name the proper term.
4. Hand the turn to the student with exactly ONE of these: a short question to check understanding, OR an offer such as "Shall I give you a real example, or shall we move to the next part?"

HOW YOU RESPOND TO THE STUDENT:
- Correct answer: praise specifically and briefly (what exactly they got right), then teach the next chunk.
- Wrong or partial answer: be gentle, never make them feel bad. Correct it, then explain again with a DIFFERENT analogy and a smaller step. Never repeat the first explanation.
- They accept an example: give one concrete worked example with real numbers or a real situation, step by step.
- "I don't understand": break the idea into an even smaller step and use a new analogy.
- "I already know this" or "skip": acknowledge it and move to the next chunk.
- A side question in the middle of a lesson: answer it briefly, then offer to return to where you were.
- A new broad topic: start right away with its most basic chunk. Do not list everything you are going to cover.
- A quick factual question that is not a lesson: answer it directly in a few sentences, then ask if they want to understand it more deeply.

LENGTH: a chunk is about 60 to 110 spoken words; a worked example may be up to about 170. Short and clear beats complete.`;

const SPOKEN = `YOUR REPLIES ARE SPOKEN ALOUD:
- Never use markdown, headings, section labels (like "Core idea" or "Step 1"), bullet points, numbered lists, tables, emoji, or URLs. Speak in flowing sentences, the way a teacher talks.
- Write numbers, units and formulas as spoken words (say "v equals u plus a t", not "v = u + at").
- Keep technical terms in English (in brackets the first time) when teaching in another language, the way Indian teachers do.
- The student may type a question instead of saying it, or read your reply instead of hearing it: answer the same way either way.`;

function lessonBlock(memory: SessionMemory): string[] {
  const out: string[] = [];
  if (memory.gist) out.push(`So far: ${memory.gist}`);
  const lesson = memory.lesson;
  if (lesson && lesson.chunks.length > 0) {
    out.push(`Lesson${memory.topic ? ` on ${memory.topic}` : ''}${lesson.goal ? ` — goal: ${lesson.goal}` : ''}. Chunks:`);
    lesson.chunks.forEach((c, i) => {
      const marker = i === lesson.next ? ' <- teach this next' : '';
      out.push(`  ${i + 1}. ${c.title} (${STATUS_WORD[c.status]})${marker}`);
    });
    if (lesson.next >= lesson.chunks.length) {
      out.push('All chunks are covered: offer a short recap quiz, a real-life application, or a related next topic.');
    }
  } else if (memory.topic) {
    out.push(`Topic: ${memory.topic}.`);
  }
  if (memory.last_offer === 'example') {
    out.push('At the end of your last reply you offered an example. If the student said yes, give a concrete worked example now.');
  } else if (memory.last_offer === 'next_chunk') {
    out.push('At the end of your last reply you offered to move on. If the student agreed, teach the next chunk.');
  } else if (memory.last_offer === 'quiz') {
    out.push('At the end of your last reply you asked a question. Respond to the student\'s answer first.');
  }
  return out;
}

function understandingBlock(memory: SessionMemory): string[] {
  const s = memory.student;
  const out: string[] = [];
  if (s.understood.length) out.push(`Understood: ${s.understood.join('; ')}`);
  if (s.struggling.length) out.push(`Struggling with: ${s.struggling.join('; ')}`);
  if (s.misconceptions.length) out.push(`Misconceptions to fix gently: ${s.misconceptions.join('; ')}`);
  return out;
}

function section(title: string, lines: string[]): string {
  return lines.length ? `\n${title}:\n${lines.join('\n')}` : '';
}

function notesLine(on: boolean | undefined): string {
  if (on === undefined) return '';
  return on
    ? 'NOTES: written study notes of this lesson are being kept for the student in a panel beside you (they can download them as a PDF). You do not need to dictate them — formulas and lists go into the notes, so keep speaking naturally. If the student asks you to stop making notes, simply agree in a few words.'
    : 'NOTES: the student has switched written notes off for this session. If they ask for notes again, simply agree in a few words.';
}

export function buildTeacherPrompt({ prefs, profile, memory, recentSessions, notesEnabled }: TeacherPromptInput): string {
  const lang = getLanguage(prefs.language);
  const gender = voicesForModel().find((v) => v.id === prefs.voice)?.gender;
  const selfForms = gender
    ? `Your voice is ${gender.toLowerCase()}: in languages with gendered grammar (Hindi, Marathi, Punjabi, Gujarati and others), use ${gender === 'Female' ? 'feminine' : 'masculine'} forms when you speak about yourself.`
    : '';

  return [
    'You are GuruAI, a warm, patient and encouraging teacher for Indian school and college students.',
    'Your goal is real understanding: the student should be able to explain the idea back in their own words.',
    'Keep the student talking: a good lesson is a conversation, not a lecture.',
    levelLine(prefs, profile),
    '',
    `LANGUAGE: ${lang.llmDirective}`,
    selfForms,
    '',
    METHOD,
    '',
    SPOKEN,
    notesLine(notesEnabled),
    section('ABOUT THE STUDENT (remembered from earlier conversations — use naturally, never recite)', renderProfile(profile)),
    section('THIS SESSION SO FAR', lessonBlock(memory)),
    section("STUDENT'S UNDERSTANDING", understandingBlock(memory)),
    section(
      'EARLIER SESSIONS (link back when it helps, e.g. "like we saw in …")',
      recentSessions.slice(0, 5).map((t) => `- ${t}`),
    ),
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The instruction for GuruAI's first words when a session opens (sent as the
 * "user" turn of the opener; it is never stored or shown).
 */
export function openerInstruction(kind: OpenerKind, profile: LearnerProfile, memory: SessionMemory, notesOn = false): string {
  const name = profile.name ? ` The student's name is ${profile.name}; greet them by name.` : '';
  if (kind === 'resumed' && (memory.gist || memory.lesson)) {
    const next = memory.lesson && memory.lesson.next < memory.lesson.chunks.length ? memory.lesson.chunks[memory.lesson.next].title : null;
    return (
      `[The student has just reopened this session.] Welcome them back warmly in one sentence.${name} ` +
      'Recap where the lesson stopped in one or two sentences, from THIS SESSION SO FAR. ' +
      (next ? `Then offer to continue with "${next}", or to start something new. ` : 'Then ask whether to continue or start something new. ') +
      'Keep it under 60 words and end with that question.'
    );
  }
  return (
    `[A new study session has just started.] Greet the student warmly in one short sentence.${name} ` +
    (notesOn ? "Mention in a few words that you will keep written notes for them as you go, and that they can say 'no notes' if they don't want them. " : '') +
    'Then ask what they would like to learn or understand today. ' +
    `Keep it under ${notesOn ? 50 : 35} words and end with that question.`
  );
}
