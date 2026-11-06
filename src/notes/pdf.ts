// ============================================================
// pdf.ts — the study notes as a printable A4 PDF.
//
// Rendered by a real browser engine (system Google Chrome via
// playwright-core) because only a browser shapes Indic scripts correctly —
// conjuncts and matras break in pdfkit/jsPDF (ADR G8). System Noto fonts
// cover every supported script, so rendering works offline and nothing is
// bundled. Formulas are rendered with KaTeX before printing.
//
// The PDF is re-rendered in the background a few seconds after the notes
// change, so a download is usually instant; a download of stale notes
// renders on the spot. If no browser can be launched, PDF is disabled with a
// clear reason and the in-app notes keep working.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import katex from 'katex';
import { getSession } from '../contextStore';
import { getLanguage } from '../languages';
import { blockCount, type Notebook, type NoteBlock } from './notebook';
import { loadNotes } from './notesAgent';

const NOTES_DIR = process.env.NOTES_DIR ?? path.join('data', 'notes');
const RENDER_DEBOUNCE_MS = Number(process.env.PDF_DEBOUNCE_MS ?? 5000);
/** Close the browser after this long without a render, to free memory. */
const BROWSER_IDLE_MS = 60_000;

// ── HTML (pure) ───────────────────────────────────────────────

export interface NotesMeta {
  sessionTitle: string | null;
  languageLabel: string;
  htmlLang: string;
  level: string;
  date: string;
  /** file:// URL of katex.min.css (its fonts are resolved relative to it). */
  katexCssHref: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const KIND_LABEL: Record<string, string> = {
  definition: 'Definition',
  formula: 'Formula',
  example: 'Example',
  tip: 'Remember',
  question: 'Practice',
};

export function formulaHtml(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'html', strict: 'ignore' });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

function blockHtml(b: NoteBlock): string {
  const label = KIND_LABEL[b.kind];
  const formula = b.latex ? `<div class="formula">${formulaHtml(b.latex)}</div>` : '';
  const text = b.text ? `<p>${esc(b.text)}</p>` : '';
  if (b.kind === 'point') return `<li class="point">${esc(b.text)}${formula}</li>`;
  return `<div class="block ${b.kind}">${label ? `<span class="tag">${label}</span>` : ''}${formula}${text}</div>`;
}

export function renderNotesHtml(nb: Notebook, meta: NotesMeta): string {
  const headline = nb.subject ?? meta.sessionTitle ?? 'Study notes';
  const sections = nb.sections
    .map((s) => {
      // Consecutive points form one list; everything else is its own box.
      const parts: string[] = [];
      let points: string[] = [];
      const flush = () => {
        if (points.length) parts.push(`<ul>${points.join('')}</ul>`);
        points = [];
      };
      for (const b of s.blocks) {
        if (b.kind === 'point') points.push(blockHtml(b));
        else {
          flush();
          parts.push(blockHtml(b));
        }
      }
      flush();
      return `<section><h2>${esc(s.heading)}</h2>${parts.join('')}</section>`;
    })
    .join('');

  const facts = [meta.level, meta.languageLabel, meta.date].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html>
<html lang="${esc(meta.htmlLang)}">
<head>
<meta charset="utf-8">
<title>${esc(headline)}</title>
<link rel="stylesheet" href="${esc(meta.katexCssHref)}">
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1d2430; font: 11.5pt/1.55 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali',
    'Noto Sans Gujarati', 'Noto Sans Gurmukhi', 'Noto Sans Kannada', 'Noto Sans Malayalam', 'Noto Sans Tamil',
    'Noto Sans Telugu', sans-serif; }
  header { border-bottom: 2px solid #2b6cb0; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-size: 8.5pt; letter-spacing: .2em; text-transform: uppercase; color: #2b6cb0; font-weight: 600; }
  h1 { font-size: 22pt; line-height: 1.2; margin: 6px 0 2px; }
  .topic { font-size: 13pt; color: #44506a; margin: 0; }
  .facts { font-size: 9pt; color: #6b7690; margin-top: 6px; }
  .session { font-size: 9.5pt; color: #6b7690; margin: 2px 0 0; }
  section { margin: 0 0 16px; break-inside: auto; }
  h2 { font-size: 13.5pt; margin: 0 0 8px; padding: 4px 0 4px 10px; border-left: 4px solid #2b6cb0; background: #f1f5fb; break-after: avoid; }
  ul { margin: 0 0 8px; padding-left: 20px; }
  li.point { margin: 2px 0; }
  .block { margin: 8px 0; padding: 8px 12px; border-radius: 6px; break-inside: avoid; }
  .block p { margin: 0; }
  .tag { display: inline-block; font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; margin-bottom: 2px; }
  .definition { background: #eef4ff; border: 1px solid #c9d9f5; } .definition .tag { color: #2b6cb0; }
  .formula { background: #fbfaf2; } .block.formula { border: 1px solid #e6dfb8; } .block.formula .tag { color: #8a6d00; }
  .example { background: #f0faf3; border: 1px solid #c6e8d0; } .example .tag { color: #237a3f; }
  .tip { background: #fff6ec; border: 1px solid #f3d5b0; } .tip .tag { color: #b35b00; }
  .question { background: #f6f2fc; border: 1px solid #ddd0f0; } .question .tag { color: #6b3fa0; }
  .katex-display { margin: 4px 0; }
  footer { margin-top: 24px; font-size: 8pt; color: #98a2b8; text-align: center; }
</style>
</head>
<body>
<header>
  <div class="brand">GuruAI · Study notes</div>
  <h1>${esc(headline)}</h1>
  ${nb.topic ? `<p class="topic">${esc(nb.topic)}</p>` : ''}
  ${meta.sessionTitle && meta.sessionTitle !== headline ? `<p class="session">${esc(meta.sessionTitle)}</p>` : ''}
  <div class="facts">${facts}</div>
</header>
${sections || '<p>No notes yet.</p>'}
<footer>Made with GuruAI</footer>
</body>
</html>`;
}

export function notesMetaFor(sessionId: string): NotesMeta {
  const s = getSession(sessionId);
  const lang = getLanguage(s?.language);
  const level = [s?.grade ? (s.grade === 'college' ? 'College' : `Class ${s.grade}`) : '', s?.board === 'STATE' ? 'State board' : s?.board ?? '']
    .filter((x) => x && x !== 'OTHER')
    .join(', ');
  return {
    sessionTitle: s?.title ?? null,
    languageLabel: lang.id === 'en' ? 'English' : lang.nativeLabel,
    htmlLang: lang.id === 'hinglish' ? 'hi' : lang.id,
    level,
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
    katexCssHref: pathToFileURL(require.resolve('katex/dist/katex.min.css')).href,
  };
}

// ── Browser (lazy, reused, closed when idle) ──────────────────

type Browser = import('playwright-core').Browser;
let browser: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let unavailableReason: string | null = null;

/** False once a launch has failed; the reason says how to fix it. */
export function pdfAvailable(): boolean {
  return unavailableReason === null;
}

export function pdfUnavailableReason(): string | null {
  return unavailableReason;
}

async function getBrowser(): Promise<Browser> {
  if (unavailableReason) throw new Error(unavailableReason);
  if (!browser) {
    browser = (async () => {
      const { chromium } = await import('playwright-core');
      const executablePath = process.env.PDF_BROWSER_PATH || undefined;
      const channel = executablePath ? undefined : process.env.PDF_BROWSER_CHANNEL || 'chrome';
      return chromium.launch({ executablePath, channel, headless: true });
    })();
    browser.catch((err: Error) => {
      unavailableReason =
        `PDF needs Google Chrome (or set PDF_BROWSER_PATH to a Chromium executable). ` +
        `Launch failed: ${err.message.split('\n')[0]}`;
      console.error(`[pdf] ${unavailableReason}`);
      browser = null;
    });
  }
  return browser;
}

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closePdfBrowser(), BROWSER_IDLE_MS);
}

export async function closePdfBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const b = browser;
  browser = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
}

/** Render HTML to PDF bytes. */
export async function htmlToPdf(html: string, workFile: string): Promise<Buffer> {
  const b = await getBrowser();
  touchIdle();
  // A real file:// page, so the KaTeX stylesheet and its fonts load.
  fs.writeFileSync(workFile, html);
  const page = await b.newPage();
  try {
    await page.goto(pathToFileURL(path.resolve(workFile)).href, { waitUntil: 'load' });
    // Wait for web fonts (KaTeX) — a string expression, since this file is compiled without DOM types.
    await page.evaluate('document.fonts.ready.then(() => true)');
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close().catch(() => undefined);
    fs.rm(workFile, { force: true }, () => undefined);
  }
}

// ── Per-session PDFs ──────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<string>>();

function pdfPath(sessionId: string): string {
  return path.join(NOTES_DIR, `${sessionId}.pdf`);
}
function versionPath(sessionId: string): string {
  return path.join(NOTES_DIR, `${sessionId}.version`);
}

function renderedVersion(sessionId: string): number {
  try {
    return Number(fs.readFileSync(versionPath(sessionId), 'utf8')) || -1;
  } catch {
    return -1;
  }
}

/** Render this session's notes to data/notes/<id>.pdf (deduped per session). */
export function renderSessionPdf(sessionId: string): Promise<string> {
  const pending = inFlight.get(sessionId);
  if (pending) return pending;
  const job = (async () => {
    const { notebook } = loadNotes(sessionId);
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    const pdf = await htmlToPdf(renderNotesHtml(notebook, notesMetaFor(sessionId)), path.join(NOTES_DIR, `${sessionId}.html`));
    fs.writeFileSync(pdfPath(sessionId), pdf);
    fs.writeFileSync(versionPath(sessionId), String(notebook.version));
    console.log(`[pdf] ${sessionId.slice(0, 8)}: rendered v${notebook.version} (${pdf.length} bytes)`);
    return pdfPath(sessionId);
  })().finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, job);
  return job;
}

/** After the notes change: re-render a few seconds later (debounced). */
export function schedulePdf(sessionId: string): void {
  if (!pdfAvailable()) return;
  const t = timers.get(sessionId);
  if (t) clearTimeout(t);
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId);
      renderSessionPdf(sessionId).catch((err: Error) => console.error(`[pdf] render failed: ${err.message}`));
    }, RENDER_DEBOUNCE_MS),
  );
}

/** The PDF for a download: the stored file if current, otherwise rendered now. */
export async function pdfForDownload(sessionId: string): Promise<{ file: string; filename: string } | null> {
  const { notebook } = loadNotes(sessionId);
  if (blockCount(notebook) === 0) return null;
  const file =
    renderedVersion(sessionId) === notebook.version && fs.existsSync(pdfPath(sessionId))
      ? pdfPath(sessionId)
      : await renderSessionPdf(sessionId);
  const name = (notebook.subject ?? getSession(sessionId)?.title ?? 'GuruAI notes').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return { file, filename: `${name || 'GuruAI notes'}.pdf` };
}

/** Remove a session's PDF files (session deleted). */
export function deleteSessionPdf(sessionId: string): void {
  for (const f of [pdfPath(sessionId), versionPath(sessionId)]) fs.rm(f, { force: true }, () => undefined);
}
