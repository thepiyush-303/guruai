// ============================================================
// memory.test.ts — session memory normalisation, the learner profile, and
// the background updater (with a mocked LLM, on a temporary SQLite file).
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initContextStore, appendTurn, upsertSession } from '../contextStore';
import { emptyMemory, loadSessionMemory, normalizeSessionMemory, saveSessionMemory, MAX_CHUNKS } from '../memory/sessionMemory';
import { forgetEverything, forgetProfileFact, loadProfile, mergeProfileFacts, setMemoryEnabled } from '../memory/learnerProfile';
import { onMemoryUpdated, setMemoryCompleter, updateMemory, buildUpdatePrompt } from '../memory/memoryUpdater';
import { parseJsonObject } from '../llmText';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guruai-memory-'));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  expect(initContextStore(path.join(dir, 'test.db'))).toBe(true);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('normalizeSessionMemory', () => {
  it('accepts a well-formed update', () => {
    const m = normalizeSessionMemory({
      topic: 'Acids and bases',
      gist: 'Started acids.',
      lesson: { goal: 'g', chunks: [{ title: 'What an acid is', status: 'explained' }, { title: 'pH', status: 'pending' }], next: 1 },
      student: { understood: ['sour taste'], struggling: [], misconceptions: [] },
      last_offer: 'quiz',
    });
    expect(m.lesson?.chunks).toHaveLength(2);
    expect(m.lesson?.next).toBe(1);
    expect(m.last_offer).toBe('quiz');
  });

  it('keeps the previous value for anything malformed', () => {
    const prev = { ...emptyMemory(), topic: 'Light', gist: 'old gist' };
    const m = normalizeSessionMemory({ topic: 42, gist: '', lesson: 'nope', last_offer: 'dance' }, prev);
    expect(m).toEqual(prev);
    expect(normalizeSessionMemory('not an object', prev)).toEqual(prev);
  });

  it('caps chunks and lists, clamps next, defaults unknown statuses', () => {
    const chunks = Array.from({ length: 12 }, (_, i) => ({ title: `c${i}`, status: i === 0 ? 'weird' : 'pending' }));
    const m = normalizeSessionMemory({
      lesson: { goal: 'g', chunks, next: 99 },
      student: { understood: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'A'], struggling: [], misconceptions: [] },
    });
    expect(m.lesson?.chunks).toHaveLength(MAX_CHUNKS);
    expect(m.lesson?.chunks[0].status).toBe('pending');
    expect(m.lesson?.next).toBe(MAX_CHUNKS);
    expect(m.student.understood).toEqual(['c', 'd', 'e', 'f', 'g']); // deduped ("A"), most recent 5
  });

  it('a null lesson clears the plan (new topic, no plan yet)', () => {
    const prev = normalizeSessionMemory({ lesson: { goal: 'g', chunks: ['x'], next: 0 } });
    expect(normalizeSessionMemory({ lesson: null }, prev).lesson).toBeNull();
  });

  it('round-trips through the database', () => {
    const m = { ...emptyMemory(), topic: 'Motion', gist: 'gist' };
    saveSessionMemory('mem-sess-0001', m, 7);
    expect(loadSessionMemory('mem-sess-0001')).toEqual({ memory: m, uptoTurnId: 7 });
  });
});

describe('learner profile', () => {
  beforeEach(() => {
    forgetEverything();
    setMemoryEnabled(true);
  });

  it('stores allowed facts; lists merge and dedupe', () => {
    mergeProfileFacts([{ key: 'name', value: 'Riya' }, { key: 'interests', value: ['cricket', 'drawing'] }], 's1');
    mergeProfileFacts([{ key: 'interests', value: 'Cricket' }, { key: 'interests', value: 'chess' }], 's2');
    expect(loadProfile()).toEqual({ name: 'Riya', interests: ['cricket', 'drawing', 'chess'] });
  });

  it('drops unknown keys and sensitive values', () => {
    mergeProfileFacts([
      { key: 'religion', value: 'x' },
      { key: 'notes', value: 'my phone is 9876543210' },
      { key: 'notes', value: 'has a diagnosis of asthma' },
      { key: 'exam_goal', value: 'NEET — wants to study medicine' },
    ], 's1');
    expect(loadProfile()).toEqual({ exam_goal: 'NEET — wants to study medicine' });
  });

  it('writes nothing while memory is switched off', () => {
    setMemoryEnabled(false);
    expect(mergeProfileFacts([{ key: 'name', value: 'Riya' }], 's1')).toEqual([]);
    expect(loadProfile()).toEqual({});
  });

  it('forgets one item, one fact, or everything', () => {
    mergeProfileFacts([{ key: 'name', value: 'Riya' }, { key: 'interests', value: ['cricket', 'chess'] }], 's1');
    expect(forgetProfileFact('interests', 'chess')).toBe(true);
    expect(loadProfile().interests).toEqual(['cricket']);
    expect(forgetProfileFact('name')).toBe(true);
    expect(loadProfile().name).toBeUndefined();
    forgetEverything();
    expect(loadProfile()).toEqual({});
  });
});

describe('memory updater', () => {
  beforeEach(() => {
    forgetEverything();
    setMemoryEnabled(true);
  });

  it('folds new turns into memory and profile, advancing upto_turn_id', async () => {
    upsertSession({ id: 'mem-upd-00001', language: 'en' });
    appendTurn('mem-upd-00001', 'user', 'I love cricket. Can you explain photosynthesis?');
    appendTurn('mem-upd-00001', 'assistant', 'Sure! Plants are like a kitchen… Shall I give you an example?');
    const prompts: string[] = [];
    const views: unknown[] = [];
    onMemoryUpdated((_id, view) => views.push(view));
    setMemoryCompleter(async (prompt) => {
      prompts.push(prompt);
      return {
        memory: {
          topic: 'Photosynthesis',
          gist: 'Began photosynthesis with a kitchen analogy.',
          lesson: { goal: 'How plants make food', chunks: [{ title: 'Plants make food', status: 'explained' }, { title: 'Chlorophyll', status: 'pending' }], next: 1 },
          student: { understood: [], struggling: [], misconceptions: [] },
          last_offer: 'example',
        },
        profile_facts: [{ key: 'interests', value: 'cricket' }],
      };
    });

    await updateMemory('mem-upd-00001');
    const { memory, uptoTurnId } = loadSessionMemory('mem-upd-00001');
    expect(memory.topic).toBe('Photosynthesis');
    expect(memory.last_offer).toBe('example');
    expect(uptoTurnId).toBeGreaterThan(0);
    expect(loadProfile().interests).toEqual(['cricket']);
    expect(prompts[0]).toContain('I love cricket');
    expect(views).toHaveLength(1);

    // Nothing new since: no LLM call.
    await updateMemory('mem-upd-00001');
    expect(prompts).toHaveLength(1);
  });

  it('keeps the previous memory when the LLM fails', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    upsertSession({ id: 'mem-upd-00002', language: 'hi' });
    saveSessionMemory('mem-upd-00002', { ...emptyMemory(), gist: 'keep me' }, 0);
    appendTurn('mem-upd-00002', 'user', 'q');
    setMemoryCompleter(async () => { throw new Error('rate limited'); });
    await updateMemory('mem-upd-00002');
    expect(loadSessionMemory('mem-upd-00002')).toEqual({ memory: { ...emptyMemory(), gist: 'keep me' }, uptoTurnId: 0 });
    err.mockRestore();
  });

  it('runs serially per session and folds turns that arrive mid-run', async () => {
    upsertSession({ id: 'mem-upd-00003', language: 'en' });
    appendTurn('mem-upd-00003', 'user', 'first');
    let calls = 0;
    let release: () => void = () => {};
    setMemoryCompleter(async () => {
      calls++;
      if (calls === 1) await new Promise<void>((r) => { release = r; });
      return { memory: { gist: `run ${calls}` }, profile_facts: [] };
    });
    const first = updateMemory('mem-upd-00003');
    await new Promise((r) => setTimeout(r, 10));
    appendTurn('mem-upd-00003', 'user', 'second');
    void updateMemory('mem-upd-00003'); // arrives while busy → scheduled, not parallel
    release();
    await first;
    expect(calls).toBe(2);
    expect(loadSessionMemory('mem-upd-00003').memory.gist).toBe('run 2');
  });

  it('asks for no profile facts when memory is off', () => {
    expect(buildUpdatePrompt(emptyMemory(), [], [], 'Hindi', false)).toContain('always []');
    expect(buildUpdatePrompt(emptyMemory(), [], [], 'Hindi', true)).toContain('NEVER record religion');
  });
});

describe('parseJsonObject', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonObject('no json here')).toThrow();
  });
});
