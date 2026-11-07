// ============================================================
// server.ts — one HTTP server for everything: the built client, the /api
// routes, and the WebSocket (upgrade on /ws).
// Port: HTTP_PORT, else PORT (what hosting platforms set), else 3000.
// ============================================================

import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { SessionInitMessage, ServerMessage } from './types';
import { SessionStore } from './session';
import { handleTextMessage, handleBinaryMessage, handleInternalEvent } from './messageHandler';
import { initSpeechServices, endSpeechSession, stopSpeechServices, setVoiceOutput } from './sideEffects';
import { initContextStore } from './contextStore';
import { openSession, sendNotesUpdate, sendSessionContext } from './sessionLifecycle';
import { onNotesChanged } from './notes/notesAgent';
import { closePdfBrowser, schedulePdf } from './notes/pdf';
import { onMemoryUpdated } from './memory/memoryUpdater';
import { handleApi } from './httpApi';
import { onSessionTitled, titleBacklog } from './titler';

// One port, because hosting platforms (Railway, Render, Fly) expose exactly
// one and hand it over as PORT. Locally HTTP_PORT (3000) is used if set.
const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? process.env.PORT ?? '3000', 10);
/** The WebSocket shares the HTTP port, on this path. */
const WS_PATH = '/ws';
// The frontend is a Vite app in client/. Production serves its build output;
// `npm run build` inside client/ produces it. During frontend development the
// Vite dev server serves the same files on its own port and talks to this
// process over the WebSocket only.
const PUBLIC_DIR = path.join(__dirname, '..', 'client', 'dist');


// ── HTTP static file server (serves client/dist/) ─────────────
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.woff2': 'font/woff2',   // KaTeX fonts for formulas in the notes
  '.woff':  'font/woff',
  '.ttf':   'font/ttf',
  '.png':   'image/png',
  '.json':  'application/json',
};

const httpServer = http.createServer((req, res) => {
  // JSON / audio API for the client (sessions, voices, voice previews).
  if (req.url?.startsWith('/api/')) {
    void handleApi(req, res);
    return;
  }

  // The client routes (/, /new, /s/<id>, /settings) are all the same page.
  const pathname = (req.url ?? '/').split(/[?#]/)[0];
  const isRoute = !path.extname(pathname);
  const urlPath = pathname === '/' || isRoute ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));

  // Security: prevent directory traversal outside client/dist/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// The WebSocket rides on the same server: upgrades to /ws (others are refused).
const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

httpServer.listen(HTTP_PORT, () => {
  console.log(`[server] listening on http://localhost:${HTTP_PORT} (app + /api) and ws://localhost:${HTTP_PORT}${WS_PATH}`);
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.warn(`[server] ${PUBLIC_DIR} not found — the frontend has not been built. Run: cd client && npm run build`);
  }
});


// Open the durable transcript store (disables itself if better-sqlite3 is absent).
initContextStore();

// Session titles are generated in the background; tell the open client.
onSessionTitled((sessionId, title) => {
  const ws = activeWs;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'session_updated', session_id: sessionId, title } satisfies ServerMessage));
  }
});
// Lesson progress changes after each background memory update.
onMemoryUpdated((sessionId, view) => {
  const ws = activeWs;
  if (ws && ws.readyState === WebSocket.OPEN && SessionStore.get()?.sessionId === sessionId) {
    sendSessionContext(ws, sessionId, view);
  }
});
// Notes changed (new blocks, or switched on/off): show them, and re-render the PDF soon.
onNotesChanged((sessionId, state) => {
  if (state.enabled) schedulePdf(sessionId);
  const ws = activeWs;
  if (ws && ws.readyState === WebSocket.OPEN && SessionStore.get()?.sessionId === sessionId) {
    sendNotesUpdate(ws, sessionId, state);
  }
});
// Name sessions saved before titles were generated.
setTimeout(titleBacklog, 3000);

// ── Initialize speech services (Gnani STT/TTS + Vosk captions) ─
// Wire STT, caption and LLM events through the state machine.
initSpeechServices((eventType, payload) => {
  const ctx = SessionStore.get();
  if (!ctx) return;  // no active session — discard event
  const ws = activeWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  handleInternalEvent(eventType, payload, ws, ctx);
});

// Track the currently active WS connection for subprocess callbacks
let activeWs: WebSocket | null = null;

wss.on('connection', (ws: WebSocket) => {
  // ── One session at a time: the newest connection wins ─────
  // Moving to another session in the app (or reloading the page) opens a new
  // socket before the old one's close has arrived. The old one is retired
  // here, and its late events are ignored below.
  if (activeWs && activeWs !== ws) {
    const old = activeWs;
    console.log('[server] New connection replaces the previous one');
    if (SessionStore.has()) endSpeechSession();
    SessionStore.clear();
    activeWs = null;
    old.close(4000, 'replaced by a newer connection');
  }

  // Track this connection for subprocess callbacks
  activeWs = ws;
  console.log('[server] Client connected — waiting for session_init');

  // ── Wait for session_init handshake ──────────────────────
  let initialized = false;

  // Timeout: close connection if session_init not received within 10s
  const initTimeout = setTimeout(() => {
    if (!initialized) {
      console.warn('[server] session_init timeout — closing connection');
      ws.close();
    }
  }, 10_000);

  ws.on('message', (data, isBinary) => {
    // ── Pre-init: accept only session_init ──────────────────
    if (!initialized) {
      if (activeWs !== ws) return; // replaced before it said hello
      if (isBinary) {
        console.warn('[server] Binary frame received before session_init — ignoring');
        return;
      }

      let initMsg: SessionInitMessage;
      try {
        initMsg = JSON.parse(data.toString()) as SessionInitMessage;
      } catch {
        console.error('[server] Malformed session_init JSON — closing');
        ws.close();
        return;
      }

      if (initMsg.type !== 'session_init') {
        console.warn(`[server] Expected session_init, got: ${initMsg.type} — closing`);
        ws.close();
        return;
      }

      // ── Open (or resume) the study session ─────────────────
      initialized = true;
      clearTimeout(initTimeout);
      // Spoken replies on/off: per device, so it travels with the connection.
      setVoiceOutput(initMsg.voice_output !== false);
      openSession(ws, {
        sessionId: initMsg.session_id,
        preferences: initMsg.preferences,
        resume: initMsg.resume === true,
        groupId: initMsg.group_id,
      });

      // ── Register post-init message handler ────────────────
      ws.on('message', (msgData, msgIsBinary) => {
        if (!initialized || activeWs !== ws) return; // retired connection
        const currentCtx = SessionStore.getOrThrow();

        if (msgIsBinary) {
          handleBinaryMessage(msgData as Buffer, ws, currentCtx);
        } else {
          handleTextMessage(msgData.toString(), ws, currentCtx);
        }
      });

      return;
    }
  });

  // ── Connection teardown ────────────────────────────────────
  ws.on('close', (code, reason) => {
    clearTimeout(initTimeout);
    if (activeWs !== ws) {
      console.log(`[server] Retired connection closed (code=${code})`);
      return; // a newer connection owns the session now
    }
    const sessionId = SessionStore.get()?.sessionId ?? 'unknown';
    console.log(`[server] Connection closed — session=${sessionId} code=${code} reason=${reason.toString() || '(none)'}`);
    if (initialized) endSpeechSession();
    SessionStore.clear();
    activeWs = null;
    initialized = false;
  });

  ws.on('error', (err) => {
    console.error(`[server] WebSocket error: ${err.message}`);
    // Connection will emit 'close' after this, which handles cleanup
  });
});

wss.on('error', (err) => {
  console.error(`[server] WebSocketServer fatal error: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[server] SIGINT received — shutting down gracefully');
  stopSpeechServices();
  void closePdfBrowser();
  httpServer.close();
  wss.close(() => {
    console.log('[server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down gracefully');
  stopSpeechServices();
  void closePdfBrowser();
  httpServer.close();
  wss.close(() => process.exit(0));
});

export { wss };
