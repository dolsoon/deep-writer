import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { RoundAnalysisRequest, RoundAnalysis } from '@/types/contribution';

// --- Constants ---

const MAX_TEXT_LENGTH = 2000;

// --- Prompt Templates ---

const SYSTEM_PROMPT = `You are a writing analysis expert for a human-AI co-writing tool. Analyze this round of interaction and produce per-dimension scores.

Scoring Rubric:

D1 (Wording) -- Who chose the specific words in this round?
  1.0: User typed the words directly
  0.7-0.9: User directed specific wording via prompt ("use academic tone", "replace X with Y")
  0.4-0.6: User edited AI text, or AI closely followed user's phrasing direction
  0.1-0.3: User selected from alternatives without editing
  0.0: AI generated text, user accepted as-is, no wording direction in prompt

D2 (Concept) -- Who decided the idea/direction in this round?
  1.0: User conceived the idea independently (no AI influence in recent chat)
  0.7-0.9: User set constraints + detailed prompt directing content
  0.4-0.6: User gave general direction, AI elaborated significantly
  0.1-0.3: AI suggested direction via chat feedback, user followed
  0.0: AI decided content with no user input

D3 (Evaluation) -- Who judged the quality in this round?
  1.0: User independently evaluated and rejected or substantially rewrote
  0.7-0.9: User critically reviewed, compared options, made deliberate choice
  0.4-0.6: User compared alternatives and selected
  0.2-0.4: User accepted after AI provided evaluation/recommendation in chat
  0.0-0.2: User accepted without review or delegated judgment to AI

Return a JSON object with this exact structure:
{
  "roundId": "<the roundId from input>",
  "scores": { "d1": <0.0-1.0>, "d2": <0.0-1.0>, "d3": <0.0-1.0> },
  "edges": [
    { "to": "<parent roundId>", "dimension": "d1"|"d2"|"d3", "strength": <0.0-1.0>, "reason": "<brief explanation>" }
  ],
  "conceptsPreserved": ["concept1", ...],
  "conceptsAdded": ["concept1", ...],
  "conceptsLost": ["concept1", ...],
  "narrativeSummary": "<one sentence summary of what happened in this round>"
}`;

function buildUserPrompt(request: RoundAnalysisRequest): string {
  const parts: string[] = [];

  const previousText = request.previousText.slice(0, MAX_TEXT_LENGTH);
  const resultText = request.resultText.slice(0, MAX_TEXT_LENGTH);

  parts.push(`Previous text (before this round): "${previousText}"`);
  parts.push('');

  parts.push('Recent chat history:');
  if (request.recentChatHistory.length > 0) {
    for (const msg of request.recentChatHistory) {
      parts.push(`  ${msg.role}: ${msg.content}`);
    }
  } else {
    parts.push('  (none)');
  }
  parts.push('');

  parts.push('User constraints:');
  if (request.userConstraints.length > 0) {
    const formatted = request.userConstraints
      .map((c) => `${c.type}: "${c.text}"`)
      .join(', ');
    parts.push(`  [${formatted}]`);
  } else {
    parts.push('  (none)');
  }
  parts.push('');

  parts.push(`Action: ${request.actionType}`);
  parts.push(`Result text: "${resultText}"`);
  parts.push(`User post-action: ${request.userPostAction}`);
  parts.push(`Parent round IDs: ${request.parentRoundIds.length > 0 ? request.parentRoundIds.join(', ') : '(none)'}`);
  parts.push('');

  parts.push('Tasks:');
  parts.push('1. Score d1, d2, d3 (each 0.0-1.0) for this round based on the rubric.');
  parts.push('2. Identify edges: which previous rounds influenced this round, per dimension? For each edge: target roundId, dimension, strength (0-1), reason.');
  parts.push('3. List concepts preserved, added, lost.');
  parts.push('4. Write a one-sentence narrative summary.');

  return parts.join('\n');
}

// --- Request Validation ---

function validateRequest(body: unknown): body is RoundAnalysisRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;

  if (typeof req.roundId !== 'string' || req.roundId.length === 0) return false;
  if (typeof req.actionType !== 'string') return false;
  if (!['generation', 'alternative', 'inline-edit', 'user-typed'].includes(req.actionType)) return false;
  if (typeof req.resultText !== 'string') return false;
  if (typeof req.previousText !== 'string') return false;
  // At least one of previousText or resultText must be non-empty (pure deletion is valid)
  if (req.previousText.length === 0 && req.resultText.length === 0) return false;

  return true;
}

// --- Response Validation ---

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function validateAnalysisResponse(data: unknown): RoundAnalysis | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // Validate roundId
  if (typeof obj.roundId !== 'string' || obj.roundId.length === 0) return null;

  // Validate scores
  if (!obj.scores || typeof obj.scores !== 'object') return null;
  const scores = obj.scores as Record<string, unknown>;
  if (!isValidScore(scores.d1) || !isValidScore(scores.d2) || !isValidScore(scores.d3)) return null;

  // Validate edges array
  if (!Array.isArray(obj.edges)) return null;

  // Validate narrativeSummary
  if (typeof obj.narrativeSummary !== 'string') return null;

  // Normalize edges -- filter out any malformed entries
  const edges = (obj.edges as Array<Record<string, unknown>>)
    .filter((e) =>
      typeof e.to === 'string' &&
      typeof e.dimension === 'string' &&
      ['d1', 'd2', 'd3'].includes(e.dimension) &&
      typeof e.strength === 'number' &&
      e.strength >= 0 &&
      e.strength <= 1 &&
      typeof e.reason === 'string',
    )
    .map((e) => ({
      to: e.to as string,
      dimension: e.dimension as 'd1' | 'd2' | 'd3',
      strength: e.strength as number,
      reason: e.reason as string,
    }));

  return {
    roundId: obj.roundId as string,
    scores: {
      d1: scores.d1 as number,
      d2: scores.d2 as number,
      d3: scores.d3 as number,
    },
    edges,
    conceptsPreserved: Array.isArray(obj.conceptsPreserved)
      ? (obj.conceptsPreserved as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    conceptsAdded: Array.isArray(obj.conceptsAdded)
      ? (obj.conceptsAdded as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    conceptsLost: Array.isArray(obj.conceptsLost)
      ? (obj.conceptsLost as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    narrativeSummary: obj.narrativeSummary as string,
  };
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('x-openai-api-key') || process.env.OPENAI_API_KEY;
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
      { error: 'Invalid request. roundId, actionType, and resultText are required.', retryable: false },
      { status: 400 },
    );
  }

  const analysisRequest = body as RoundAnalysisRequest;

  // Build prompt
  const userPrompt = buildUserPrompt(analysisRequest);

  // Call OpenAI API with timeout
  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const message = completion.choices[0]?.message;
    const content = message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'Empty response from AI.', retryable: true },
        { status: 502 },
      );
    }

    // Parse JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('[/api/analyze-round] JSON parse failed. Raw:', content.slice(0, 500));
      return NextResponse.json(
        { error: 'Malformed JSON response from AI.', retryable: true },
        { status: 502 },
      );
    }

    // Validate response structure
    const analysis = validateAnalysisResponse(parsed);
    if (!analysis) {
      console.error('[/api/analyze-round] Validation failed. Parsed:', JSON.stringify(parsed).slice(0, 500));
      return NextResponse.json(
        { error: 'AI response did not match expected schema.', retryable: true },
        { status: 502 },
      );
    }

    return NextResponse.json(analysis);
  } catch (error: unknown) {
    clearTimeout(timeout);

    // Handle abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Analysis request timed out.', retryable: true },
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
        { error: 'Analysis failed due to API error.', retryable: true },
        { status: error.status ?? 502 },
      );
    }

    // Network or unknown error
    return NextResponse.json(
      { error: 'Network error during analysis.', retryable: true },
      { status: 502 },
    );
  }
}
