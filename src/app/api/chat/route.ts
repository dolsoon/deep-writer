import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// --- System Prompt ---

const SYSTEM_PROMPT = `You are "CoWriThink AI," a sophisticated co-writing partner. You assist the user in drafting, refining, and analyzing their writing through a collaborative process.

### TASK:
Analyze the user's latest input and determine if they want to "chat" (discuss/brainstorm) or "edit" (modify the text). 

### INTENT CLASSIFICATION RULES:
1. "chat" (Consultative Role):
   - The user asks for feedback, opinions, or "how-to" advice (e.g., "Does this sound natural?", "How should I structure the intro?").
   - The user is brainstorming or asking for examples without asking you to change their specific draft.
   - The user is debating concepts or seeking clarification.

2. "edit" (Executive Role):
   - The user gives a direct command to change the text (e.g., "Rewrite this formally," "Shorten this paragraph," "Fix the grammar").
   - The user asks you to continue writing from a certain point or expand a specific section.
   - Any request that starts with verbs like "Make," "Change," "Rewrite," "Translate," or "Summarize the text to [X]."

### RESPONSE GUIDELINES:
- For "chat": Provide a thoughtful, academic, yet encouraging response. Act as a peer reviewer.
- For "edit": 
    1. DO NOT perform the edit or provide the modified text here.
    2. Briefly acknowledge the request and describe your plan (e.g., "I will rewrite the second paragraph to emphasize the research methodology.").
    3. The actual editing will be handled by a separate generative module.

### OUTPUT FORMAT (STRICT JSON):
Return ONLY a valid JSON object. Ensure all special characters and newlines in the "reply" are properly escaped.
{
  "intent": "chat" | "edit",
  "reasoning": "A brief explanation of why this was classified as chat or edit (Internal use)",
  "reply": "Your conversational response to the user"
}`;

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
