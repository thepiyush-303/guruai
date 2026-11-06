// ============================================================
// sessions.test.ts — saved study sessions: persistence, titles, groups,
// per-session context, resume, and the HTTP API (temporary SQLite file).
// ============================================================

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import {
  initContextStore, appendTurn, upsertSession, touchSession, listSessions, getSession,
  loadSessionTurns, setSessionTitle, createGroup, listGroups,
  moveSession, deleteGroup, deleteSession, sessionsNeedingTitle, renameGroup,
} from '../contextStore';
import { openSessionContext } from '../session';
import { emptyMemory, saveSessionMemory } from '../memory/sessionMemory';
import { cleanTitle } from '../titler';
import { handleApi } from '../httpApi';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guruai-sessions-'));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  expect(initContextStore(path.join(dir, 'test.db'))).toBe(true);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function speak(id: string, language: string, q: string, a: string, groupId?: string) {
  upsertSession({ id, groupId, language, voice: 'Shivani', grade: '9', board: 'CBSE' });
  appendTurn(id, 'user', q);
  touchSession(id);
  appendTurn(id, 'assistant', a);
  touchSession(id);
}

describe('saved sessions', () => {
  it('is untitled until a title is generated — never named after the first question', () => {
    speak('sess-hindi-0001', 'hi', 'क्या आप मुझे सुन सकते हैं?', 'हाँ!');
    speak('sess-hindi-0001', 'hi', 'न्यूटन का पहला नियम समझाइए', 'जड़त्व का नियम…');
    expect(getSession('sess-hindi-0001')).toMatchObject({ title: null, title_source: null, language: 'hi' });
    expect(sessionsNeedingTitle()).toContain('sess-hindi-0001');

    expect(setSessionTitle('sess-hindi-0001', 'न्यूटन के गति के नियम', 'auto')).toBe(true);
    expect(getSession('sess-hindi-0001')).toMatchObject({ title: 'न्यूटन के गति के नियम', title_source: 'auto' });
    expect(sessionsNeedingTitle()).not.toContain('sess-hindi-0001');
  });

  it('never lets an auto title replace one the student typed', () => {
    setSessionTitle('sess-hindi-0001', 'My physics revision', 'user');
    expect(setSessionTitle('sess-hindi-0001', 'Newton\'s Laws', 'auto')).toBe(false);
    expect(getSession('sess-hindi-0001')?.title).toBe('My physics revision');
  });

  it('lists a session with its turn count and last line', () => {
    const listed = listSessions().find((x) => x.id === 'sess-hindi-0001');
    expect(listed).toMatchObject({ turn_count: 4, last_text: 'जड़त्व का नियम…', group_id: null });
  });

  it('does not list a session nobody spoke in', () => {
    upsertSession({ id: 'sess-empty-0001', language: 'ta' });
    expect(listSessions().some((x) => x.id === 'sess-empty-0001')).toBe(false);
  });

  it('keeps each session\'s turns separate', () => {
    speak('sess-tamil-0001', 'ta', 'ஒளிச்சேர்க்கை என்றால் என்ன?', '…');
    expect(loadSessionTurns('sess-tamil-0001').map((t) => t.content)).toEqual(['ஒளிச்சேர்க்கை என்றால் என்ன?', '…']);
  });
});

describe('groups', () => {
  it('creates a group, saves a new session into it, moves and ungroups sessions', () => {
    const g = createGroup('grp-physics-01', '  Physics   — Class 9 ');
    expect(g).toMatchObject({ name: 'Physics — Class 9' });
    speak('sess-grouped-01', 'en', 'What is inertia?', '…', 'grp-physics-01');
    expect(getSession('sess-grouped-01')?.group_id).toBe('grp-physics-01');

    expect(moveSession('sess-tamil-0001', 'grp-physics-01')).toBe(true);
    expect(moveSession('sess-tamil-0001', 'no-such-group')).toBe(false);
    expect(moveSession('sess-tamil-0001', null)).toBe(true);
    expect(getSession('sess-tamil-0001')?.group_id).toBeNull();
  });

  it('a later save of the session does not move it back', () => {
    moveSession('sess-grouped-01', null);
    upsertSession({ id: 'sess-grouped-01', groupId: 'grp-physics-01', language: 'en' });
    expect(getSession('sess-grouped-01')?.group_id).toBeNull();
  });

  it('renames, and deleting a group keeps its sessions', () => {
    moveSession('sess-grouped-01', 'grp-physics-01');
    expect(renameGroup('grp-physics-01', 'Physics')).toBe(true);
    expect(listGroups().map((x) => x.name)).toContain('Physics');
    expect(deleteGroup('grp-physics-01')).toBe(true);
    expect(getSession('sess-grouped-01')).toMatchObject({ group_id: null });
  });

  it('deleting a session removes its transcript', () => {
    expect(deleteSession('sess-grouped-01')).toBe(true);
    expect(getSession('sess-grouped-01')).toBeNull();
    expect(loadSessionTurns('sess-grouped-01')).toEqual([]);
  });
});

describe('openSessionContext', () => {
  it('resumes a saved session with ITS language, history, summary and group', () => {
    createGroup('grp-revision-1', 'Revision');
    moveSession('sess-hindi-0001', 'grp-revision-1');
    saveSessionMemory('sess-hindi-0001', { ...emptyMemory(), gist: 'Covered Newton\'s first law with a bus example.' }, 999);
    const { ctx, resumed, title, groupId } = openSessionContext({
      sessionId: 'sess-hindi-0001',
      preferences: { language: 'en' }, // ignored: the session is bound to Hindi
      resume: true,
    });
    expect(resumed).toBe(true);
    expect(title).toBe('My physics revision');
    expect(groupId).toBe('grp-revision-1');
    expect(ctx.preferences).toMatchObject({ language: 'hi', voice: 'Shivani', grade: '9', board: 'CBSE' });
    expect(ctx.conversationHistory[0].content).toContain('Hindi');
    expect(ctx.conversationHistory[0].content).toContain('bus example');
    expect(ctx.conversationHistory.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('starts a fresh, empty session for a new id, in the requested group', () => {
    const { ctx, resumed, groupId } = openSessionContext({
      sessionId: 'sess-new-00001', preferences: { language: 'te' }, groupId: 'grp-revision-1',
    });
    expect(resumed).toBe(false);
    expect(ctx.sessionId).toBe('sess-new-00001');
    expect(ctx.preferences.language).toBe('te');
    expect(groupId).toBe('grp-revision-1');
    expect(ctx.conversationHistory).toHaveLength(1); // just the system prompt
  });

  it('ignores an unknown group', () => {
    expect(openSessionContext({ sessionId: 'sess-new-00002', groupId: 'nope' }).groupId).toBeNull();
  });

  it('never reuses a saved session\'s id for a fresh session', () => {
    const { ctx, resumed } = openSessionContext({ sessionId: 'sess-hindi-0001', preferences: { language: 'en' } });
    expect(resumed).toBe(false);
    expect(ctx.sessionId).not.toBe('sess-hindi-0001');
  });

  it('rejects unsafe session ids', () => {
    const { ctx } = openSessionContext({ sessionId: "x'; DROP TABLE turns;--", preferences: { language: 'en' } });
    expect(ctx.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('cleanTitle', () => {
  it('keeps the first line and strips quotes, labels and trailing punctuation', () => {
    expect(cleanTitle('"Newton\'s Laws of Motion".\nThis session covers…')).toBe("Newton's Laws of Motion");
    expect(cleanTitle("'Acids and Bases'")).toBe('Acids and Bases');
    expect(cleanTitle('Title: **Photosynthesis in Plants**')).toBe('Photosynthesis in Plants');
    expect(cleanTitle('न्यूटन के गति के नियम।')).toBe('न्यूटन के गति के नियम');
    expect(cleanTitle('   ')).toBeNull();
  });

  it('caps runaway titles at 8 words', () => {
    expect(cleanTitle('one two three four five six seven eight nine ten')?.split(' ')).toHaveLength(8);
  });
});

describe('HTTP API', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => void handleApi(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = async (method: string, p: string, body?: unknown, type = 'application/json') => {
    const res = await fetch(base + p, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': type },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it('creates a group, renames a session, moves it into the group', async () => {
    const created = await call('POST', '/api/groups', { name: 'Chemistry' });
    expect(created.status).toBe(201);
    const gid = created.body.group.id as string;

    const renamed = await call('PATCH', '/api/sessions/sess-tamil-0001', { title: 'Photosynthesis basics', group_id: gid });
    expect(renamed.status).toBe(200);
    const s = renamed.body.sessions.find((x: any) => x.id === 'sess-tamil-0001');
    expect(s).toMatchObject({ title: 'Photosynthesis basics', title_source: 'user', group_id: gid });
    expect(renamed.body.groups.map((g: any) => g.name)).toContain('Chemistry');
  });

  it('rejects a mutation that is not JSON (no cross-site form posts)', async () => {
    const r = await call('POST', '/api/groups', 'name=x', 'application/x-www-form-urlencoded');
    expect(r.status).toBe(415);
  });

  it('validates input and unknown ids', async () => {
    expect((await call('POST', '/api/groups', { name: '  ' })).status).toBe(400);
    expect((await call('PATCH', '/api/sessions/sess-tamil-0001', { group_id: 'nope' })).status).toBe(404);
    expect((await call('DELETE', '/api/sessions/nope')).status).toBe(404);
  });

  it('deletes a session', async () => {
    const r = await call('DELETE', '/api/sessions/sess-tamil-0001');
    expect(r.status).toBe(200);
    expect(r.body.sessions.some((x: any) => x.id === 'sess-tamil-0001')).toBe(false);
  });
});
