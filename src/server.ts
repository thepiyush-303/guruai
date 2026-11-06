// ============================================================
// server.ts — WebSocket server + HTTP static file server
// WS on PORT (default 8765), HTTP on HTTP_PORT (default 3000)
// ============================================================

import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { SessionInitMessage, ServerMessage } from './types';
import { SessionStore } from './session';
import { handleTextMessage, handleBinaryMessage, handleInternalEvent } from './messageHandler';
import { initSpeechServices, endSpeechSession, stopSpeechServices } from './sideEffects';
import { initContextStore } from './contextStore';
import { openSession, sendSessionContext } from './sessionLifecycle';
import { onMemoryUpdated } from './memory/memoryUpdater';
import { handleApi } from './httpApi';
import { onSessionTitled, titleBacklog } from './titler';

const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? '3000', 10);
// The frontend is a Vite app in client/. Production serves its build output;
// `npm run build` inside client/ produces it. During frontend development the
// Vite dev server serves the same files on its own port and talks to this
// process over the WebSocket only.
const PUBLIC_DIR = path.join(__dirname, '..', 'client', 'dist');


const wss = new WebSocketServer({ port: PORT });

// ── HTTP static file server (serves client/dist/) ─────────────
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

const httpServer = http.createServer((req, res) => {
  // JSON / audio API for the client (sessions, voices, voice previews).
  if (req.url?.startsWith('/api/')) {
    void handleApi(req, res);
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
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

httpServer.listen(HTTP_PORT, () => {
  console.log(`[server] HTTP static server listening on http://localhost:${HTTP_PORT}`);
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.warn(`[server] ${PUBLIC_DIR} not found — the frontend has not been built. Run: cd client && npm run build`);
  }
});

console.log(`[server] WebSocket server listening on port ${PORT}`);

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
  // ── Single-session guard ───────────────────────────────────
  if (SessionStore.has()) {
    console.warn('[server] Rejected new connection — a session is already active');
    ws.send(JSON.stringify({
      type: 'error',
      session_id: '',
      code: 'INTERNAL',
      message: 'Server already has an active session. Only one session is supported.',
      recoverable: false,
      timestamp_ms: Date.now(),
    } satisfies ServerMessage));
    ws.close();
    return;
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
      openSession(ws, {
        sessionId: initMsg.session_id,
        preferences: initMsg.preferences,
        resume: initMsg.resume === true,
        groupId: initMsg.group_id,
      });

      // ── Register post-init message handler ────────────────
      ws.on('message', (msgData, msgIsBinary) => {
        if (!initialized) return;
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
  httpServer.close();
  wss.close(() => {
    console.log('[server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received — shutting down gracefully');
  stopSpeechServices();
  httpServer.close();
  wss.close(() => process.exit(0));
});

export { wss };
