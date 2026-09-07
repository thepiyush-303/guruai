import Groq from 'groq-sdk';
import { getSummary, getUnsummarizedTurns, getMaxTurnId, updateSummary } from './contextStore';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? '',
});

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant'; // Fast instruct model for summarization
const SUMMARY_THRESHOLD = 6; 
let isSummarizing = false;

export async function runSummarizerBackground(): Promise<void> {
  if (isSummarizing) return;
  isSummarizing = true;

  try {
    const maxTurnId = getMaxTurnId();
    const oldSummary = getSummary();
    const coversUpTo = oldSummary ? oldSummary.covers_up_to_turn : 0;

    // unsummarized = how many turn IDs exist beyond what we last summarized
    const unsummarizedCount = maxTurnId - coversUpTo;
    if (unsummarizedCount < SUMMARY_THRESHOLD) {
      return;
    }

    // Fetch all turns with id > coversUpTo (the ones not yet folded in)
    const turns = getUnsummarizedTurns(coversUpTo, unsummarizedCount);

    if (turns.length === 0) return;

    const turnLines = turns
      .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');

    const promptText = `You are an AI assistant maintaining a rolling memory of a conversation.
Here is the previous summary of the conversation:
${oldSummary && oldSummary.text ? oldSummary.text : 'No previous summary.'}

Here are the new conversation turns to fold into the summary:
${turnLines}

Write a concise, narrative summary combining the previous information and the new turns. Keep it under 100 words. Focus on key facts, user preferences, and important context. Do not use conversational filler or introductory phrases.`;

    console.log('[summarizer] Running background summarization...');
    const result = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: promptText }],
      max_tokens: 300,
      temperature: 0.3, 
    });

    const newSummaryText = result.choices[0]?.message?.content?.trim();
    if (newSummaryText) {
      // The last turn we are summarizing is the highest ID in the array
      // Wait, we need the `id` of the turn to save it in `covers_up_to_turn`
      const maxId = turns[turns.length - 1].id;
      if (maxId !== undefined) {
        updateSummary(newSummaryText, maxId);
        console.log(`[summarizer] Summary updated successfully. Covers up to turn ID ${maxId}.`);
      }
    }
  } catch (err) {
    console.error('[summarizer] Failed during background summarization:', err);
  } finally {
    isSummarizing = false;
  }
}
