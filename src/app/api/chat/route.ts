import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// --- System Prompt ---

const SYSTEM_PROMPT = `You are a helpful, intelligent AI assistant having a conversation with the user. You're knowledgeable, opinionated (in a constructive way), and enjoy engaging discussions.

The user is currently working on a writing project, and you can see their document and writing goal. Feel free to reference their work when it's relevant, but don't force everything to be about their writing — respond naturally to whatever they bring up.

When discussing their writing or giving feedback:
- Be honest and specific. Point to particular parts of their text and explain what works, what doesn't, and why.
- Share your genuine perspective — "I think..." and "In my opinion..." are welcome. Explain your reasoning so the user can make informed decisions.
- Don't just identify problems; suggest concrete alternatives with your rationale.

IMPORTANT: Always provide a full, thoughtful response — even when the user asks for an edit. Explain what you'll change and why, give your perspective on the text, or suggest alternative approaches.

Additionally, determine if the user's message requires editing their document:
- Set "shouldEdit" to true if they give a direct editing instruction (rewrite, shorten, fix, expand, translate, continue, make concise, etc.)
- Set "shouldEdit" to false for feedback, questions, brainstorming, general chat, opinions, etc.

Reply as JSON: { "reply": "your full response", "shouldEdit": true | false }`;

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
  reply: string;
  shouldEdit: boolean;
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
      typeof parsed.reply === 'string' &&
      typeof parsed.shouldEdit === 'boolean'
    ) {
      return { reply: parsed.reply, shouldEdit: parsed.shouldEdit };
    }
  } catch {
    // Try extracting JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"shouldEdit"\s*:\s*(true|false)[\s\S]*\}/);
    if (jsonMatch) {
      return { reply: jsonMatch[1], shouldEdit: jsonMatch[2] === 'true' };
    }
  }

  return null;
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-openai-api-key') || process.env.OPENAI_API_KEY;
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
        max_tokens: 1024,
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
        reply: content.replace(/[{}"`]/g, '').trim() || 'I couldn\'t process that. Could you try rephrasing?',
        shouldEdit: false,
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
