// ============================================================
// session.ts — SessionContext factory and store
// Single-user per PRD §1.2 (no multi-tenancy on local hardware)
// ============================================================

import { SessionContext, ServerState, ConversationMessage } from './types';
import { getSummary, loadRecentTurns } from './contextStore';

export function createSession(sessionId: string): SessionContext {
  const systemPromptStr = [
    'You are a helpful interactive voice assistant.',
    'Ask Questions if you are unsure about anything',
    'Respond concisely in 1-2 sentences.',
    'For tool calls, extract all required parameters before calling.',
    'If required parameters are missing, ask for them conversationally before calling the tool.',
  ].join(' ');

  let systemContent = systemPromptStr;
  
  const summary = getSummary();
  if (summary && summary.text) {
    systemContent += `\n\nPrevious conversation summary: ${summary.text}`;
  }

  const conversationHistory: ConversationMessage[] = [{ role: 'system', content: systemContent }];

  // Load last K turns (6 turns = 3 exchanges) safely
  const recentTurns = loadRecentTurns(6);
  for (const turn of recentTurns) {
    conversationHistory.push({
      role: turn.role,
      content: turn.content
    });
  }

  return {
    sessionId,
    state: ServerState.IDLE,
    audioBuffer: [],
    conversationHistory,
    tokenCount: 0,
    turnStartedAt: null,
    createdAt: Date.now(),
  };
}

// Single active session — enforced at connection time in server.ts
let activeSession: SessionContext | null = null;

export const SessionStore = {
  set(ctx: SessionContext): void {
    activeSession = ctx;
  },

  get(): SessionContext | null {
    return activeSession;
  },

  getOrThrow(): SessionContext {
    if (!activeSession) {
      throw new Error('No active session');
    }
    return activeSession;
  },

  clear(): void {
    if (activeSession) {
      console.log(`[session] Session ${activeSession.sessionId} cleared`);
    }
    activeSession = null;
  },

  has(): boolean {
    return activeSession !== null;
  },
};
