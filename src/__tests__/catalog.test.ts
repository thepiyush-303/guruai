// ============================================================
// catalog.test.ts — the built-in syllabus is sound, and study choices are
// validated, seed the lesson, persist and reach the teacher's prompt.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TRACKS, catalogPayload, catalogProblems, findOpenCategory, findTopic, resolveStudy, studyLabel, topicCount } from '../catalog';
import { OPEN_CATEGORIES } from '../catalog/openCategories';
import { appendTurn, deleteSession, getSessionContextRow, getSession, initContextStore } from '../contextStore';
import { loadSessionMemory } from '../memory/sessionMemory';
import { emptyMemory } from '../memory/sessionMemory';
import { buildTeacherPrompt, openerInstruction } from '../prompts/teacher';
import { normalizePreferences, openSessionContext } from '../session';
import { saveSessionRow } from '../sessionLifecycle';
import { buildUpdatePrompt } from '../memory/memoryUpdater';

const OHM = 'cbse-10.physics.electricity.current-potential-difference-and-ohms-law';

describe('catalog integrity', () => {
  it('has no problems: unique ids, 3–6 chunks, every exam reference resolves', () => {
    expect(catalogProblems()).toEqual([]);
    expect(topicCount()).toBeGreaterThanOrEqual(150);
  });

  it('every program has subjects and every subject has units with topics', () => {
    for (const track of TRACKS) {
      expect(track.programs.length).toBeGreaterThan(0);
      for (const p of track.programs) {
        expect(p.subjects.length).toBeGreaterThan(0);
        for (const s of p.subjects) {
          expect(s.units.length).toBeGreaterThan(0);
          for (const u of s.units) expect(u.topics.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('exam topics are the same topics as their home program', () => {
    const jee = TRACKS.find((t) => t.id === 'exam')!.programs.find((p) => p.id === 'jee-main')!;
    const topic = jee.subjects[0].units[0].topics[0];
    expect(findTopic(topic.id)?.program.id).toBe('cbse-11');
  });

  it('finds a topic with its full context, and nothing for unknown ids', () => {
    const t = findTopic(OHM);
    expect(t).toMatchObject({ program: { id: 'cbse-10' }, subject: { id: 'physics' }, unit: { id: 'electricity' } });
    expect(findTopic('cbse-10.physics.nope')).toBeNull();
    expect(findTopic(42)).toBeNull();
  });

  it('keeps prompt hints off the wire', () => {
    const payload = catalogPayload();
    expect(payload.open_categories).toHaveLength(OPEN_CATEGORIES.length);
    expect(JSON.stringify(payload.open_categories)).not.toContain('promptHint');
  });

  it('labels a study choice for the session list', () => {
    expect(studyLabel(resolveStudy({ kind: 'topic', topicId: OHM })!)).toEqual({
      title: "Current, potential difference and Ohm's law",
      subtitle: 'Class 10 · Physics',
    });
    expect(studyLabel(resolveStudy({ kind: 'open', categoryId: 'software' })!).subtitle).toBe('Open chat');
  });
});

describe('study preferences', () => {
  it('keeps a known topic and takes class and board from its program', () => {
    const p = normalizePreferences({ language: 'en', grade: '7', study: { kind: 'topic', topicId: OHM } });
    expect(p).toMatchObject({ grade: '10', board: 'CBSE', study: { kind: 'topic', topicId: OHM } });
  });

  it('drops unknown topics and categories, and trims a first question', () => {
    expect(normalizePreferences({ language: 'en', study: { kind: 'topic', topicId: 'x.y' } }).study).toBeUndefined();
    expect(normalizePreferences({ language: 'en', study: { kind: 'open', categoryId: 'nope' } }).study).toBeUndefined();
    const long = normalizePreferences({ language: 'en', study: { kind: 'open', categoryId: 'software', ask: `  ${'a'.repeat(900)} ` } });
    expect(long.study).toMatchObject({ kind: 'open', categoryId: 'software' });
    expect((long.study as { ask: string }).ask).toHaveLength(500);
  });
});

describe('teacher prompt with a study choice', () => {
  it('carries the syllabus focus and lesson plan for a topic', () => {
    const p = buildTeacherPrompt({ prefs: { language: 'en' }, profile: {}, memory: emptyMemory(), recentSessions: [], study: resolveStudy({ kind: 'topic', topicId: OHM }) });
    expect(p).toContain('SYLLABUS FOCUS: Class 10');
    expect(p).toContain("Ohm's law");
    expect(p).toContain('1. Electric charge and current');
    expect(p).toContain('do not ask what they want to learn');
  });

  it('carries the area hint for open chat, and the open opener names the area', () => {
    const study = resolveStudy({ kind: 'open', categoryId: 'life' });
    const p = buildTeacherPrompt({ prefs: { language: 'en' }, profile: {}, memory: emptyMemory(), recentSessions: [], study });
    expect(p).toContain('CONVERSATION AREA — Life & wellbeing');
    expect(openerInstruction('open', {}, emptyMemory(), false, study)).toContain('"Life & wellbeing"');
  });

  it('asks the memory updater to keep the syllabus chunks', () => {
    expect(buildUpdatePrompt(emptyMemory(), [], [], 'English', false, 'Ohm’s law')).toContain('keep the given chunk titles');
    expect(buildUpdatePrompt(emptyMemory(), [], [], 'English', false)).not.toContain('keep the given chunk titles');
  });
});

describe('topic sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guruai-catalog-'));
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(initContextStore(path.join(dir, 'test.db'))).toBe(true);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a fresh topic session starts with the lesson plan in its memory', () => {
    const { ctx } = openSessionContext({ sessionId: 'topic-sess-0001', preferences: { language: 'hi', study: { kind: 'topic', topicId: OHM } } });
    const { memory } = loadSessionMemory(ctx.sessionId);
    expect(memory.topic).toBe("Current, potential difference and Ohm's law");
    expect(memory.lesson?.chunks.map((c) => c.status)).toEqual(Array(findTopic(OHM)!.topic.chunks.length).fill('pending'));
    expect(memory.lesson?.next).toBe(0);
    expect(ctx.conversationHistory[0].content).toContain('<- teach this next');
  });

  it('persists the study choice and restores it on resume', () => {
    const { ctx } = openSessionContext({ sessionId: 'topic-sess-0002', preferences: { language: 'en', study: { kind: 'topic', topicId: OHM } } });
    saveSessionRow(ctx);
    appendTurn(ctx.sessionId, 'user', "Teach me: Ohm's law");
    expect(getSession(ctx.sessionId)).toMatchObject({ study_kind: 'topic', study_ref: OHM });

    const again = openSessionContext({ sessionId: ctx.sessionId, resume: true });
    expect(again.resumed).toBe(true);
    expect(again.ctx.preferences.study).toEqual({ kind: 'topic', topicId: OHM });
    expect(again.ctx.preferences.grade).toBe('10');
  });

  it('deleting the session removes its seeded memory', () => {
    deleteSession('topic-sess-0002');
    expect(getSessionContextRow('topic-sess-0002')).toBeNull();
  });

  it('an open category is a valid study choice', () => {
    expect(findOpenCategory('software')?.starters.length).toBeGreaterThan(0);
  });
});
