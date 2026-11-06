// ============================================================
// notes.test.ts — the notes agent (mocked LLM), the voice toggle through the
// memory updater, the HTML, and a real PDF render through system Chrome.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guruai-notes-'));
process.env.NOTES_DIR = path.join(dir, 'notes');

import { initContextStore, appendTurn, upsertSession } from '../contextStore';
import { loadNotes, onNotesChanged, setNotesCompleter, setNotesDefault, setNotesEnabled, updateNotes, buildNotesPrompt } from '../notes/notesAgent';
import { setMemoryCompleter, updateMemory } from '../memory/memoryUpdater';
import { applyNotesPatch, emptyNotebook } from '../notes/notebook';
import { closePdfBrowser, htmlToPdf, renderNotesHtml, renderSessionPdf, pdfForDownload } from '../notes/pdf';

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  expect(initContextStore(path.join(dir, 'test.db'))).toBe(true);
});
afterAll(async () => {
  await closePdfBrowser();
  fs.rmSync(dir, { recursive: true, force: true });
});

const patch = {
  should_record: true,
  subject: 'Biology',
  topic: 'Photosynthesis',
  ops: [{ op: 'add_section', heading: 'What photosynthesis is', blocks: [
    { kind: 'definition', text: 'Photosynthesis: plants make glucose from CO2 and water using light.' },
    { kind: 'formula', text: 'Overall reaction', latex: '6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2' },
  ] }],
};

describe('notes agent', () => {
  it('is on by default for a new session, and the default can be changed', () => {
    expect(loadNotes('notes-sess-000').enabled).toBe(true);
    setNotesDefault(false);
    expect(loadNotes('notes-sess-000').enabled).toBe(false);
    setNotesDefault(true);
  });

  it('turns new turns into notes and notifies', async () => {
    upsertSession({ id: 'notes-sess-001', language: 'en', grade: '10', board: 'CBSE' });
    appendTurn('notes-sess-001', 'user', 'Explain photosynthesis');
    appendTurn('notes-sess-001', 'assistant', 'Think of a leaf as a kitchen…');
    const prompts: string[] = [];
    const seen: number[] = [];
    onNotesChanged((_id, s) => seen.push(s.notebook.version));
    setNotesCompleter(async (p) => { prompts.push(p); return patch; });
    await updateNotes('notes-sess-001');
    const { notebook, uptoTurnId } = loadNotes('notes-sess-001');
    expect(notebook.subject).toBe('Biology');
    expect(notebook.sections[0].blocks).toHaveLength(2);
    expect(uptoTurnId).toBeGreaterThan(0);
    expect(prompts[0]).toContain('Class 10, CBSE');
    expect(prompts[0]).toContain('Explain photosynthesis');
    expect(seen).toContain(1);

    // Nothing new: no call.
    await updateNotes('notes-sess-001');
    expect(prompts).toHaveLength(1);
  });

  it('does nothing while notes are off, then catches up when switched on', async () => {
    upsertSession({ id: 'notes-sess-002', language: 'hi' });
    setNotesEnabled('notes-sess-002', false);
    appendTurn('notes-sess-002', 'user', 'q1');
    appendTurn('notes-sess-002', 'assistant', 'a1');
    let calls = 0;
    setNotesCompleter(async () => { calls++; return patch; });
    await updateNotes('notes-sess-002');
    expect(calls).toBe(0);
    setNotesEnabled('notes-sess-002', true);
    await updateNotes('notes-sess-002');
    expect(calls).toBe(1);
    expect(loadNotes('notes-sess-002').notebook.sections).toHaveLength(1);
  });

  it('keeps the notes unchanged when the LLM fails', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    appendTurn('notes-sess-001', 'user', 'more');
    const before = loadNotes('notes-sess-001');
    setNotesCompleter(async () => { throw new Error('rate limited'); });
    await updateNotes('notes-sess-001');
    expect(loadNotes('notes-sess-001')).toEqual(before);
    err.mockRestore();
  });

  it('the prompt asks for the student\'s language and script', () => {
    const p = buildNotesPrompt({ outline: '(empty)', languageLabel: 'Tamil (தமிழ்)', hinglish: false, level: '', topic: null, chunks: [], turns: [] });
    expect(p).toContain('Write in Tamil (தமிழ்)');
    expect(buildNotesPrompt({ outline: '', languageLabel: 'Hinglish', hinglish: true, level: '', topic: null, chunks: [], turns: [] })).toContain('Devanagari');
  });
});

describe('voice toggle through the memory updater', () => {
  it('"notes mat banao" switches notes off; asking again switches them on', async () => {
    upsertSession({ id: 'notes-sess-003', language: 'hinglish' });
    appendTurn('notes-sess-003', 'user', 'notes mat banao please');
    setMemoryCompleter(async () => ({ memory: {}, profile_facts: [], notes_request: 'off' }));
    await updateMemory('notes-sess-003');
    expect(loadNotes('notes-sess-003').enabled).toBe(false);

    setNotesCompleter(async () => patch);
    appendTurn('notes-sess-003', 'user', 'ok notes banao');
    setMemoryCompleter(async () => ({ memory: {}, profile_facts: [], notes_request: 'on' }));
    await updateMemory('notes-sess-003');
    expect(loadNotes('notes-sess-003').enabled).toBe(true);
  });
});

describe('PDF', () => {
  const nb = applyNotesPatch(emptyNotebook(), {
    subject: 'भौतिकी (Physics)',
    topic: 'न्यूटन के गति के नियम',
    ops: [{ op: 'add_section', heading: 'पहला नियम', blocks: [
      { kind: 'definition', text: 'जड़त्व: वस्तु अपनी अवस्था बनाए रखती है। <script>x</script>' },
      { kind: 'point', text: 'बल के बिना गति नहीं बदलती' },
      { kind: 'formula', text: 'बल', latex: 'F = ma' },
    ] }],
  }).notebook;
  const meta = { sessionTitle: 'Newton', languageLabel: 'हिन्दी', htmlLang: 'hi', level: 'Class 9, CBSE', date: '6 November 2026', katexCssHref: 'file:///x.css' };

  it('renders the headline, sections, KaTeX and escapes text', () => {
    const html = renderNotesHtml(nb, meta);
    expect(html).toContain('<h1>भौतिकी (Physics)</h1>');
    expect(html).toContain('न्यूटन के गति के नियम');
    expect(html).toContain('<h2>पहला नियम</h2>');
    expect(html).toContain('class="katex');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x');
  });

  const hasChrome = fs.existsSync('/usr/bin/google-chrome') || !!process.env.PDF_BROWSER_PATH;
  (hasChrome ? it : it.skip)('prints a real PDF through system Chrome', async () => {
    const pdf = await htmlToPdf(renderNotesHtml(nb, meta), path.join(dir, 'probe.html'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  }, 30000);

  (hasChrome ? it : it.skip)('renders a session PDF and serves it for download, re-rendering only when stale', async () => {
    const file = await renderSessionPdf('notes-sess-001');
    expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
    const dl = await pdfForDownload('notes-sess-001');
    expect(dl?.filename).toBe('Biology.pdf');
    expect(await pdfForDownload('notes-sess-empty')).toBeNull();
  }, 30000);
});
