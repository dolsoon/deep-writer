import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { GenerateRequest, GenerateResponse } from '@/types/generation';

// --- Prompt Templates ---

const SYSTEM_PROMPT_GAP_FILLING = `You are a writing assistant for CoWriThink. Generate text ONLY for the [GAP] markers. Preserve all other text exactly. Match the tone, style, and argument direction of the preserved text.

IMPORTANT: Return your response as valid JSON in this exact format:
{ "gaps": [{ "id": "<gap_id>", "text": "<generated text>" }] }

Do not include any other text, explanations, or markdown formatting outside the JSON.`;

const SYSTEM_PROMPT_SMART_EDIT = `You are a writing assistant. The user provides an editing instruction.
Return the COMPLETE edited document incorporating their changes.

Return valid JSON: { "editedDocument": "the full edited text" }`;

function buildUserPrompt(request: GenerateRequest): string {
  const parts: string[] = [];

  parts.push(`User Goal: ${request.goal}`);
  parts.push('');

  if (request.mode === 'smart-edit') {
    parts.push('Current document:');
    parts.push(request.document);
    parts.push('');
    parts.push(`User's editing instruction: ${request.userRequest ?? 'Edit the document'}`);
    parts.push('');
    parts.push('Return the complete edited document as: { "editedDocument": "<full edited text>" }');
  } else if (request.mode === 'continuation') {
    parts.push('Document context:');
    parts.push(request.document);
    parts.push('');
    parts.push(`Continue writing from the indicated position. ${request.userRequest ?? ''}`);
    parts.push('');
    parts.push('Return the continuation as: { "gaps": [{ "id": "continuation", "text": "<your text>" }] }');
  } else {
    parts.push('Document with gaps:');
    parts.push(request.document);
    parts.push('');

    if (request.userRequest) {
      parts.push(`User request: ${request.userRequest}`);
      parts.push('');
    }

    parts.push('Instructions:');
    parts.push('- Fill each [GAP] with coherent text that connects smoothly with surrounding preserved segments.');
    parts.push('- Respect the user\'s writing goal.');
    parts.push('- Do not modify preserved text.');
    parts.push('- Return the gap fills as structured JSON: { "gaps": [{ "id": "<gap_id>", "text": "generated text" }] }');
  }

  return parts.join('\n');
}

// --- Response Parsing ---

function parseGenerateResponse(content: string, gapIds: string[]): GenerateResponse | null {
  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try direct JSON parse
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Not valid JSON, try extracting JSON from prose
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Also failed
      }
    }
  }

  if (!parsed) return null;

  // Case 1: Standard format { "gaps": [{ "id": "...", "text": "..." }] }
  if (parsed.gaps && Array.isArray(parsed.gaps)) {
    // Validate that each gap has id and text strings
    const validGaps = (parsed.gaps as Array<Record<string, unknown>>).filter(
      (g) => typeof g.id === 'string' && typeof g.text === 'string',
    );
    if (validGaps.length > 0) {
      return { gaps: validGaps as Array<{ id: string; text: string }> };
    }
  }

  // Case 2: Model returned { "text": "..." } or { "content": "..." } -- wrap into gaps format
  const textContent = parsed.text ?? parsed.content ?? parsed.response ?? parsed.result;
  if (typeof textContent === 'string' && gapIds.length > 0) {
    return { gaps: [{ id: gapIds[0], text: textContent }] };
  }

  // Case 3: Model returned { "<gap_id>": "text" } -- extract by gap IDs
  const gapResults: Array<{ id: string; text: string }> = [];
  for (const gapId of gapIds) {
    if (typeof parsed[gapId] === 'string') {
      gapResults.push({ id: gapId, text: parsed[gapId] as string });
    }
  }
  if (gapResults.length > 0) {
    return { gaps: gapResults };
  }

  // Case 4: Model returned plain text (not JSON) -- use as single gap fill
  if (gapIds.length > 0 && typeof content === 'string' && content.length > 0) {
    // Only if parsing truly failed and we have raw text
    if (!parsed.gaps) {
      return { gaps: [{ id: gapIds[0], text: cleaned }] };
    }
  }

  return null;
}

/**
 * Attempt to salvage text from a truncated JSON response (finish_reason: "length").
 * The response typically looks like: { "gaps": [{ "id": "abc", "text": "some text that got cut
 * We extract whatever text was generated before truncation.
 */
function repairTruncatedResponse(content: string, gapIds: string[]): GenerateResponse | null {
  if (gapIds.length === 0) return null;

  // Match all "id": "...", "text": "..." pairs, including the last partial one
  const gapPattern = /"id"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/g;
  const results: Array<{ id: string; text: string }> = [];
  let match;

  while ((match = gapPattern.exec(content)) !== null) {
    const id = match[1];
    let text = match[2];
    // Unescape JSON string escapes
    try {
      text = JSON.parse(`"${text}"`);
    } catch {
      // If unescape fails, use raw text with basic cleanup
      text = text.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (text.length > 0) {
      results.push({ id, text });
    }
  }

  if (results.length > 0) {
    return { gaps: results };
  }

  return null;
}

/**
 * Parse smart-edit mode response.
 * Expected format: { "editedDocument": "..." }
 */
function parseSmartEditResponse(content: string): { editedDocument: string } | null {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed.editedDocument === 'string') {
      return { editedDocument: parsed.editedDocument };
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

// --- Request Validation ---

function validateRequest(body: unknown): body is GenerateRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;

  if (typeof req.goal !== 'string' || req.goal.length === 0) return false;
  if (typeof req.document !== 'string') return false;
  if (!Array.isArray(req.gaps)) return false;
  if (!Array.isArray(req.constraints)) return false;
  if (!['regenerate', 'selection', 'continuation', 'smart-edit'].includes(req.mode as string)) return false;

  return true;
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured.', retryable: false },
      { status: 500 },
    );
  }

  // Parse and validate request body
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
      { error: 'Invalid request format.', retryable: false },
      { status: 400 },
    );
  }

  const generateRequest = body as GenerateRequest;

  // Calculate max tokens based on gap sizes and mode
  const totalGapChars = generateRequest.gaps.reduce(
    (sum, gap) => sum + gap.originalText.length,
    0,
  );
  const maxTokens = generateRequest.mode === 'continuation'
    ? 2048  // Continuation/first-draft needs more room
    : Math.max(1024, Math.min(4096, Math.ceil(totalGapChars * 3)));

  // Build prompt
  const userPrompt = buildUserPrompt(generateRequest);
  const systemPrompt = generateRequest.mode === 'smart-edit'
    ? SYSTEM_PROMPT_SMART_EDIT
    : SYSTEM_PROMPT_GAP_FILLING;

  // Call OpenAI API with timeout
  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const message = completion.choices[0]?.message;
    const content = message?.content;
    const finishReason = completion.choices[0]?.finish_reason;

    if (!content) {
      console.error('[/api/generate] Empty content. refusal:', message?.refusal);
      return NextResponse.json(
        { error: 'Empty response from AI. Please try again.', retryable: true },
        { status: 502 },
      );
    }

    // Parse response based on mode
    if (generateRequest.mode === 'smart-edit') {
      const parsed = parseSmartEditResponse(content);

      if (!parsed) {
        console.error('[/api/generate] Smart-edit parse failed. Raw:', content.slice(0, 1000));
        return NextResponse.json(
          { error: 'AI response was incomplete. Please try again.', retryable: true },
          { status: 502 },
        );
      }

      // Validate that edited document is not suspiciously short (possible truncation)
      if (parsed.editedDocument.length < generateRequest.document.length * 0.3) {
        console.error('[/api/generate] Edited document suspiciously short. Possible truncation.');
        return NextResponse.json(
          { error: 'AI response was incomplete. Please try again.', retryable: true },
          { status: 502 },
        );
      }

      return NextResponse.json(parsed);
    } else {
      // Gap-filling modes
      const gapIds = generateRequest.gaps.map((g) => g.id);
      let parsed = parseGenerateResponse(content, gapIds);

      // If standard parsing failed and response was truncated, try to salvage partial text
      if (!parsed && finishReason === 'length') {
        console.warn('[/api/generate] Response truncated (finish_reason: length). Attempting repair.');
        parsed = repairTruncatedResponse(content, gapIds);
      }

      if (!parsed) {
        console.error('[/api/generate] Parse failed. Raw:', content.slice(0, 1000));
        return NextResponse.json(
          { error: 'AI response was incomplete. Please try again.', retryable: true },
          { status: 502 },
        );
      }

      return NextResponse.json(parsed);
    }
  } catch (error: unknown) {
    clearTimeout(timeout);

    // Handle abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out. Please try again.', retryable: true },
        { status: 504 },
      );
    }

    // Handle OpenAI API errors
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: 'Rate limited. Please wait and retry.', retryable: true },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: 'Generation failed. Please try again.', retryable: true },
        { status: error.status ?? 502 },
      );
    }

    // Network or unknown error
    return NextResponse.json(
      { error: 'Network error. Please try again.', retryable: true },
      { status: 503 },
    );
  }
}
