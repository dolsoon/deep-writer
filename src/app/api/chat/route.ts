import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// --- System Prompt ---

const SYSTEM_PROMPT = `You are a writing assistant for CoWriThink. The user is working on a writing document with a specific goal.

Your job is to:
1. Classify the user's latest message intent as "chat" or "edit"
2. Provide a helpful response

Intent classification:
- "chat": the user is asking a question, requesting feedback, brainstorming, discussing ideas, or seeking advice about their writing
- "edit": the user is requesting a specific modification, rewrite, expansion, shortening, continuation, or structural change to the document text

IMPORTANT: Return your response as valid JSON in this exact format:
{ "intent": "chat" | "edit", "reply": "your conversational response" }

For "chat" intent: provide a thoughtful, helpful response to the user's question or discussion.
For "edit" intent: briefly acknowledge the edit request and describe what you will do. Do NOT include the actual edited text in your reply -- the edit will be generated separately by the editing system.

Do not include any text outside the JSON.`;

// --- Types ---

interface ChatRequestMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatRequestMessage[];
  document: string;
  goal: string;
}

interface ChatResponse {
  intent: 'chat' | 'edit';
  reply: string;
}

// --- Validation ---

function validateRequest(body: unknown): body is ChatRequest {
  if (typeof body !== 'object' || body === null) return false;
  const obj = body as Record<string, unknown>;

  if (!Array.isArray(obj.messages) || obj.messages.length === 0) return false;

  const lastMsg = obj.messages[obj.messages.length - 1];
  if (typeof lastMsg !== 'object' || lastMsg === null) return false;
  if ((lastMsg as Record<string, unknown>).role !== 'user') return false;

  return true;
}

// --- Response Parsing ---

function parseChatResponse(content: string): ChatResponse | null {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed.intent === 'chat' || parsed.intent === 'edit') &&
      typeof parsed.reply === 'string'
    ) {
      return { intent: parsed.intent, reply: parsed.reply };
    }
  } catch {
    // Try extracting JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*"intent"\s*:\s*"(chat|edit)"[\s\S]*"reply"\s*:\s*"([\s\S]*?)"\s*\}/);
    if (jsonMatch) {
      return { intent: jsonMatch[1] as 'chat' | 'edit', reply: jsonMatch[2] };
    }
  }

  return null;
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured.', retryable: false },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.', retryable: false },
      { status: 400 },
    );
  }

  if (!validateRequest(body)) {
    return NextResponse.json(
      { error: 'Invalid request. messages array with at least one user message is required.', retryable: false },
      { status: 400 },
    );
  }

  const { messages, document: docText, goal } = body;

  // Build OpenAI messages
  const contextMessage = [
    goal ? `Writing goal: ${goal}` : '',
    docText ? `\nCurrent document:\n${docText}` : '\nThe document is currently empty.',
  ].filter(Boolean).join('\n');

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contextMessage },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o',
        messages: openaiMessages,
        response_format: { type: 'json_object' },
        max_tokens: 512,
        temperature: 0.7,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: 'No response from AI.', retryable: true },
        { status: 502 },
      );
    }

    const parsed = parseChatResponse(content);
    if (!parsed) {
      // Fallback: treat as chat with raw content as reply
      return NextResponse.json({
        intent: 'chat',
        reply: content.replace(/[{}"`]/g, '').trim() || 'I couldn\'t process that. Could you try rephrasing?',
      });
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    clearTimeout(timeout);

    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out.', retryable: true },
        { status: 504 },
      );
    }

    const isRateLimit = err instanceof OpenAI.APIError && err.status === 429;
    return NextResponse.json(
      {
        error: isRateLimit ? 'Rate limited. Please wait a moment.' : 'Failed to process chat message.',
        retryable: true,
      },
      { status: isRateLimit ? 429 : 500 },
    );
  }
}
