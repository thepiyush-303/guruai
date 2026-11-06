// ============================================================
// llmText.ts — one-shot, non-streaming LLM text for background jobs
// (session titles, rolling summaries). Never on the voice hot path.
//
// Uses Groq when GROQ_API_KEY is set, otherwise Gemini.
// ============================================================

import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';

const groqKey = process.env.GROQ_API_KEY ?? '';
const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';

const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;
const gemini = !groq && geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;

const GROQ_MODEL = process.env.SUMMARY_MODEL ?? process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';

/** Reasoning models spend tokens thinking first; keep that short. */
function isReasoningModel(model: string): boolean {
  return /gpt-oss|qwq|deepseek-r1|o[13]/i.test(model);
}

export function hasBackgroundLlm(): boolean {
  return groq !== null || gemini !== null;
}

/**
 * Complete `prompt` and return the text (trimmed, <think> blocks removed).
 * `maxTokens` must leave room for a reasoning model's thinking.
 */
export async function completeText(prompt: string, maxTokens: number, temperature = 0.3): Promise<string> {
  if (groq) {
    const result = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      ...(isReasoningModel(GROQ_MODEL) ? { reasoning_effort: 'low' as const } : {}),
    });
    return clean(result.choices[0]?.message?.content ?? '');
  }
  if (gemini) {
    const result = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: maxTokens, temperature },
    });
    return clean(result.text ?? '');
  }
  throw new Error('no LLM key configured (GROQ_API_KEY or GEMINI_API_KEY)');
}

/**
 * Complete `prompt` asking for a JSON object, and parse it. Uses the
 * provider's JSON mode; falls back to extracting the outermost {...} if a
 * model wraps it in prose or code fences. Throws if no object can be parsed.
 */
export async function completeJson(prompt: string, maxTokens: number): Promise<Record<string, unknown>> {
  let raw: string;
  if (groq) {
    const result = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      ...(isReasoningModel(GROQ_MODEL) ? { reasoning_effort: 'low' as const } : {}),
    });
    raw = clean(result.choices[0]?.message?.content ?? '');
  } else if (gemini) {
    const result = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: maxTokens, temperature: 0.2, responseMimeType: 'application/json' },
    });
    raw = clean(result.text ?? '');
  } else {
    throw new Error('no LLM key configured (GROQ_API_KEY or GEMINI_API_KEY)');
  }
  return parseJsonObject(raw);
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const inner = start >= 0 && end > start ? tryParse(raw.slice(start, end + 1)) : null;
  if (inner) return inner;
  throw new Error(`model did not return a JSON object: ${raw.slice(0, 120)}`);
}

function clean(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
