import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// --- Prompt Templates ---

const LONG_TEXT_WORD_THRESHOLD = 7;

const SYSTEM_PROMPT_SHORT = `You are a writing assistant. Generate exactly {count} alternative phrasings for the selected text.
Each alternative should:
- Preserve the original meaning
- Vary in style, word choice, or sentence structure
- Be roughly similar in length to the original
- Fit naturally in the surrounding context

For each alternative, include a short label (1-3 words) prefixed with a relevant emoji that captures the specific creative direction of that rewrite. Avoid generic labels like "More formal", "Simpler", or "More concise". Instead, be specific to what actually changed — e.g., "🔪 Sharper imagery", "😏 Wry understatement", "🌊 Rhythmic flow", "💔 Emotional weight", "⚡ Clipped urgency".

IMPORTANT: Return your response as valid JSON in this exact format:
{ "alternatives": [{ "text": "alternative 1", "label": "Sharper imagery" }, { "text": "alternative 2", "label": "Wry understatement" }] }

Do not include any other text, explanations, or markdown formatting outside the JSON.`;

const SYSTEM_PROMPT_PARAGRAPH = `You are a writing assistant. Generate exactly 2 alternative rewrites of the entire selected paragraph.

CRITICAL RULES:
- You MUST rewrite the ENTIRE paragraph from start to finish for each alternative
- Each rewrite MUST be similar in length to the original (same number of sentences, similar word count)
- Do NOT summarize or shorten — produce full replacement paragraphs
- Preserve the original meaning and key points
- Each alternative should take a different creative direction (e.g., different tone, structure, or emphasis)
- The rewrites must fit naturally as drop-in replacements

For each alternative, include a short label (1-3 words) prefixed with a relevant emoji that captures the specific creative direction of that rewrite.

IMPORTANT: Return your response as valid JSON in this exact format:
{ "alternatives": [{ "text": "full rewritten paragraph 1...", "label": "🔥 Vivid momentum" }, { "text": "full rewritten paragraph 2...", "label": "🌊 Flowing clarity" }] }

Do not include any other text, explanations, or markdown formatting outside the JSON.`;

function getAlternativeCount(selectedText: string, requestedCount?: number): number {
  if (requestedCount != null && requestedCount >= 1 && requestedCount <= 5) {
    return requestedCount;
  }
  const wordCount = selectedText.trim().split(/\s+/).length;
  return wordCount >= LONG_TEXT_WORD_THRESHOLD ? 2 : 3;
}

function getMaxTokens(selectedText: string): number {
  const wordCount = selectedText.trim().split(/\s+/).length;
  if (wordCount > 80) return 2048;
  if (wordCount > 30) return 1024;
  if (wordCount > 10) return 512;
  return 256;
}

function buildSystemPrompt(selectedText: string, requestedCount?: number, level?: string): string {
  if (level === 'paragraph') {
    return SYSTEM_PROMPT_PARAGRAPH;
  }
  return SYSTEM_PROMPT_SHORT.replace('{count}', String(getAlternativeCount(selectedText, requestedCount)));
}

interface AnnotationCues {
  originalFeedback?: string;       // original text with <PRESERVE>/<AVOID> tags
  suggestionFeedbacks?: string[];  // suggestion texts with <LIKE>/<DISLIKE> tags
}

function buildUserPrompt(selectedText: string, context: string, goal: string, annotations?: AnnotationCues, userInstruction?: string): string {
  const parts: string[] = [];

  if (goal) {
    parts.push(`Writing goal: ${goal}`);
    parts.push('');
  }

  if (context) {
    parts.push('Surrounding context:');
    parts.push(context);
    parts.push('');
  }

  parts.push('Selected text to rephrase:');
  parts.push(selectedText);

  if (annotations) {
    const hasFeedback = annotations.originalFeedback || annotations.suggestionFeedbacks?.length;
    if (hasFeedback) {
      parts.push('');
      parts.push('Writer feedback (words wrapped in tags indicate preferences):');
      parts.push('- <PRESERVE>word</PRESERVE> = keep this word/phrase from the original');
      parts.push('- <AVOID>word</AVOID> = replace or remove this word/phrase');
      parts.push('- <LIKE>word</LIKE> = the writer liked this word from a previous suggestion');
      parts.push('- <DISLIKE>word</DISLIKE> = the writer disliked this word from a previous suggestion');

      if (annotations.originalFeedback) {
        parts.push('');
        parts.push('Original with feedback:');
        parts.push(annotations.originalFeedback);
      }

      if (annotations.suggestionFeedbacks?.length) {
        for (const fb of annotations.suggestionFeedbacks) {
          parts.push('');
          parts.push('Previous suggestion with feedback:');
          parts.push(fb);
        }
      }
    }
  }

  if (userInstruction) {
    parts.push('');
    parts.push('User instruction for the alternatives:');
    parts.push(userInstruction);
  }

  return parts.join('\n');
}

// --- Response Parsing ---

interface Alternative {
  text: string;
  label: string;
}

interface AlternativesResponse {
  alternatives: Alternative[];
}

function normalizeItem(item: unknown): Alternative | null {
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text : '';
    const label = typeof obj.label === 'string' ? obj.label : '';
    if (text.length > 0) {
      return { text, label };
    }
  }
  // Backward compat: plain string
  if (typeof item === 'string' && item.length > 0) {
    return { text: item, label: '' };
  }
  return null;
}

function normalizeArray(arr: unknown[]): Alternative[] {
  return arr.map(normalizeItem).filter((a): a is Alternative => a !== null);
}

function parseAlternativesResponse(content: string): AlternativesResponse | null {
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

  // Case 1: Standard format { "alternatives": [...] }
  if (parsed.alternatives && Array.isArray(parsed.alternatives)) {
    const alternatives = normalizeArray(parsed.alternatives);
    if (alternatives.length > 0) {
      return { alternatives };
    }
  }

  // Case 2: Model returned an array at top level
  if (Array.isArray(parsed)) {
    const alternatives = normalizeArray(parsed);
    if (alternatives.length > 0) {
      return { alternatives };
    }
  }

  // Case 3: Model returned { "options": [...] } or { "suggestions": [...] }
  const altArray = parsed.options ?? parsed.suggestions ?? parsed.rephrased ?? parsed.results;
  if (Array.isArray(altArray)) {
    const alternatives = normalizeArray(altArray);
    if (alternatives.length > 0) {
      return { alternatives };
    }
  }

  return null;
}

// --- Request Validation ---

interface AlternativesRequest {
  selectedText: string;
  context: string;
  goal: string;
  count?: number;
  level?: string;
}

function validateRequest(body: unknown): body is AlternativesRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;

  if (typeof req.selectedText !== 'string' || req.selectedText.trim().length === 0) return false;
  if (req.selectedText.length > 2000) return false;

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
      { error: 'Invalid request. selectedText is required and must be at most 500 characters.', retryable: false },
      { status: 400 },
    );
  }

  const selectedText = body.selectedText.trim();
  const context = typeof body.context === 'string' ? body.context : '';
  const goal = typeof body.goal === 'string' ? body.goal : '';
  const requestedCount = typeof body.count === 'number' ? body.count : undefined;
  const level = typeof body.level === 'string' ? body.level : undefined;
  const annotations = (body as unknown as Record<string, unknown>).annotations as AnnotationCues | undefined;
  const userInstruction = typeof (body as unknown as Record<string, unknown>).userInstruction === 'string'
    ? ((body as unknown as Record<string, unknown>).userInstruction as string).trim() || undefined
    : undefined;

  // Build prompt
  const systemPrompt = buildSystemPrompt(selectedText, requestedCount, level);
  const userPrompt = buildUserPrompt(selectedText, context, goal, annotations, userInstruction);

  // Call OpenAI API with timeout
  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeoutMs = level === 'paragraph' ? 30000 : 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: getMaxTokens(selectedText),
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const message = completion.choices[0]?.message;
    const content = message?.content;
    const finishReason = completion.choices[0]?.finish_reason;

    if (!content) {
      console.error('[/api/alternatives] Empty content. refusal:', message?.refusal);
      return NextResponse.json(
        { error: 'Empty response from AI. Please try again.', retryable: true },
        { status: 502 },
      );
    }

    // Parse response
    const parsed = parseAlternativesResponse(content);
    if (!parsed) {
      console.error('[/api/alternatives] Parse failed. Raw:', content.slice(0, 1000));
      return NextResponse.json(
        { error: `Could not parse AI response. Raw: ${content.slice(0, 200)}`, retryable: true },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
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
