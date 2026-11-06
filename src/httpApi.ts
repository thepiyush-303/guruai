// ============================================================
// httpApi.ts — the small HTTP API the client uses outside a live session.
//
//   GET    /api/sessions                         { groups, sessions }, newest first
//   PATCH  /api/sessions/:id   {title?, group_id?}  rename / move to a group (null = ungroup)
//   DELETE /api/sessions/:id                     delete a session and its transcript
//   POST   /api/groups         {name}            create a group
//   PATCH  /api/groups/:id     {name}            rename a group
//   DELETE /api/groups/:id                       delete a group (its sessions are kept)
//   GET    /api/profile                          what GuruAI remembers about the student
//   DELETE /api/profile[/:key][?item=]           forget everything / one fact / one list item
//   PATCH  /api/settings      {memory_enabled}   switch remembering personal facts on/off
//   GET    /api/notes/:id                        a session's study notes (JSON)
//   GET    /api/notes/:id/pdf                    the notes as a PDF download
//   GET    /api/voices                           Timbre voices for the configured model
//   GET    /api/voice-preview?voice=&language=   a short spoken sample (audio/wav)
//
// Served by the same HTTP server as the built client, so it is same-origin in
// production; in development Vite proxies /api here (client/vite.config.ts).
// Mutations require a JSON body / non-simple method, which a cross-site page
// cannot send without a CORS preflight this server never grants.
// ============================================================

import * as crypto from 'crypto';
import * as http from 'http';
import {
  createGroup, deleteGroup, deleteSession, getGroup, getSession, listGroups, listSessions,
  moveSession, renameGroup, setSessionTitle,
} from './contextStore';
import { isLanguageId, LANGUAGES } from './languages';
import { SessionStore } from './session';
import { defaultVoice, isVoice, ttsModel, voicesForModel } from './voices';
import { getVoicePreview, PreviewError } from './voicePreview';
import { forgetEverything, forgetProfileFact, loadProfile, memoryEnabled, setMemoryEnabled } from './memory/learnerProfile';
import { loadNotes, notesDefault, setNotesDefault } from './notes/notesAgent';
import { deleteSessionPdf, pdfAvailable, pdfForDownload, pdfUnavailableReason } from './notes/pdf';
import { isValidSessionId } from './session';
import * as fs from 'fs';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected a JSON body');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'Malformed JSON');
}

function snapshot() {
  return { groups: listGroups(), sessions: listSessions() };
}

async function sessionsRoute(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
  if (!getSession(id)) throw new HttpError(404, 'No such session');

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    if ('title' in body) {
      if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'Title must be non-empty text');
      setSessionTitle(id, body.title, 'user');
    }
    if ('group_id' in body) {
      const groupId = body.group_id === null ? null : String(body.group_id);
      if (groupId !== null && !getGroup(groupId)) throw new HttpError(404, 'No such group');
      moveSession(id, groupId);
    }
    json(res, 200, snapshot());
    return;
  }

  if (req.method === 'DELETE') {
    if (SessionStore.get()?.sessionId === id) {
      throw new HttpError(409, 'This session is open. Switch to another session before deleting it.');
    }
    deleteSession(id);
    deleteSessionPdf(id);
    json(res, 200, snapshot());
    return;
  }

  throw new HttpError(405, 'Method not allowed');
}

async function groupsRoute(req: http.IncomingMessage, res: http.ServerResponse, id: string | null): Promise<void> {
  if (id === null) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readJson(req);
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'Group name must be non-empty text');
    const group = createGroup(crypto.randomUUID(), body.name);
    if (!group) throw new HttpError(500, 'Could not create the group');
    json(res, 201, { group, ...snapshot() });
    return;
  }

  if (!getGroup(id)) throw new HttpError(404, 'No such group');
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'Group name must be non-empty text');
    renameGroup(id, body.name);
    json(res, 200, snapshot());
    return;
  }
  if (req.method === 'DELETE') {
    deleteGroup(id);
    json(res, 200, snapshot());
    return;
  }
  throw new HttpError(405, 'Method not allowed');
}

function profileSnapshot() {
  return { memory_enabled: memoryEnabled(), notes_default: notesDefault(), profile: loadProfile() };
}

async function notesRoute(req: http.IncomingMessage, res: http.ServerResponse, id: string, sub: string | undefined): Promise<void> {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  if (!isValidSessionId(id) || !getSession(id)) throw new HttpError(404, 'No such session');

  if (sub === undefined) {
    const { enabled, notebook } = loadNotes(id);
    json(res, 200, { enabled, notebook, pdf_available: pdfAvailable(), pdf_reason: pdfUnavailableReason() });
    return;
  }
  if (sub !== 'pdf') throw new HttpError(404, 'Not found');
  if (!pdfAvailable()) throw new HttpError(503, pdfUnavailableReason() ?? 'PDF is unavailable');

  let out: Awaited<ReturnType<typeof pdfForDownload>>;
  try {
    out = await pdfForDownload(id);
  } catch (err) {
    throw new HttpError(503, pdfUnavailableReason() ?? `Could not make the PDF: ${(err as Error).message}`);
  }
  if (!out) throw new HttpError(404, 'There are no notes in this session yet');
  const data = fs.readFileSync(out.file);
  const ascii = out.filename.replace(/[^\x20-\x7e]/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': data.length,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function profileRoute(req: http.IncomingMessage, res: http.ServerResponse, key: string | null, item: string | null): Promise<void> {
  if (req.method === 'GET' && key === null) {
    json(res, 200, profileSnapshot());
    return;
  }
  if (req.method === 'DELETE') {
    if (key === null) forgetEverything();
    else if (!forgetProfileFact(key, item ?? undefined)) throw new HttpError(404, 'Nothing remembered under that name');
    json(res, 200, profileSnapshot());
    return;
  }
  throw new HttpError(405, 'Method not allowed');
}

export async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api', resource, id?]

  try {
    if (parts.length > 4 || (parts.length === 4 && parts[1] !== 'notes')) throw new HttpError(404, 'Not found');
    const [, resource, id, sub] = parts;

    if (resource === 'notes' && id) {
      return await notesRoute(req, res, decodeURIComponent(id), sub);
    }

    if (resource === 'sessions') {
      if (id) return await sessionsRoute(req, res, decodeURIComponent(id));
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      json(res, 200, snapshot());
      return;
    }

    if (resource === 'groups') {
      return await groupsRoute(req, res, id ? decodeURIComponent(id) : null);
    }

    if (resource === 'profile') {
      return await profileRoute(req, res, id ? decodeURIComponent(id) : null, url.searchParams.get('item'));
    }

    if (resource === 'settings' && !id) {
      if (req.method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
      const body = await readJson(req);
      if ('memory_enabled' in body) {
        if (typeof body.memory_enabled !== 'boolean') throw new HttpError(400, 'memory_enabled must be true or false');
        setMemoryEnabled(body.memory_enabled);
      }
      if ('notes_default' in body) {
        if (typeof body.notes_default !== 'boolean') throw new HttpError(400, 'notes_default must be true or false');
        setNotesDefault(body.notes_default);
      }
      json(res, 200, profileSnapshot());
      return;
    }

    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

    if (resource === 'voices' && !id) {
      json(res, 200, { model: ttsModel(), default_voice: defaultVoice(), voices: voicesForModel() });
      return;
    }

    if (resource === 'voice-preview' && !id) {
      const voice = url.searchParams.get('voice');
      const language = url.searchParams.get('language') ?? 'en';
      if (!isVoice(voice)) throw new HttpError(400, `Unknown voice for ${ttsModel()}: ${voice}`);
      if (!isLanguageId(language)) throw new HttpError(400, `Unknown language: ${language}`);
      const wav = await getVoicePreview(voice, LANGUAGES[language]);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.length,
        'Cache-Control': 'private, max-age=86400',
      });
      res.end(wav);
      return;
    }

    throw new HttpError(404, 'Not found');
  } catch (err) {
    const status = err instanceof HttpError || err instanceof PreviewError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 500) console.error(`[api] ${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) json(res, status, { error: message });
  }
}
