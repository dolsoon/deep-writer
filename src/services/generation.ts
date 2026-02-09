import type { Editor } from '@tiptap/core';
import { nanoid } from 'nanoid';
import type {
  GenerateRequest,
  GenerateResponse,
  GenerateError,
  GapInfo,
  ConstraintInfo,
  GenerateMode,
} from '@/types/generation';
import type { TextState } from '@/types';

// --- Types ---

export interface DocumentScan {
  gaps: GapInfo[];
  constraints: ConstraintInfo[];
  documentWithGaps: string;
}

// --- Document Scanning ---

/**
 * Scan the editor document for marked-delete segments (gaps) and
 * preserved/user-written segments (constraints).
 */
export function scanDocument(editor: Editor): DocumentScan {
  const { doc } = editor.state;
  const gaps: GapInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  const markType = editor.schema.marks.textState;

  if (!markType) {
    return { gaps: [], constraints: [], documentWithGaps: doc.textBetween(0, doc.content.size, '\n', '') };
  }

  // Walk through all text nodes collecting marked segments
  doc.descendants((node, pos) => {
    if (!node.isText) return;

    const textStateMark = node.marks.find((m) => m.type === markType);
    if (!textStateMark) {
      // Unmarked text is treated as a constraint (user-written)
      constraints.push({
        text: node.text ?? '',
        position: { from: pos, to: pos + (node.text?.length ?? 0) },
      });
      return;
    }

    const state = textStateMark.attrs.state as TextState;

    if (state === 'marked-delete') {
      gaps.push({
        id: nanoid(8),
        position: { from: pos, to: pos + (node.text?.length ?? 0) },
        originalText: node.text ?? '',
      });
    } else if (
      state === 'marked-preserve' ||
      state === 'user-written' ||
      state === 'user-edited' ||
      state === 'ai-generated'
    ) {
      constraints.push({
        text: node.text ?? '',
        position: { from: pos, to: pos + (node.text?.length ?? 0) },
      });
    }
  });

  // Build document with [GAP:id] markers
  const documentWithGaps = buildDocumentWithGaps(doc, gaps);

  return { gaps, constraints, documentWithGaps };
}

/**
 * Build the document text with [GAP:id] markers replacing deleted segments.
 */
function buildDocumentWithGaps(
  doc: Parameters<typeof scanDocument>[0]['state']['doc'],
  gaps: GapInfo[],
): string {
  const fullText = doc.textBetween(0, doc.content.size, '\n', '');

  if (gaps.length === 0) return fullText;

  // Sort gaps by position (descending) to replace from end to start
  const sortedGaps = [...gaps].sort(
    (a, b) => b.position.from - a.position.from,
  );

  // Convert positions to character indices for string manipulation
  let result = fullText;
  for (const gap of sortedGaps) {
    const charFrom = doc.textBetween(0, gap.position.from, '', '').length;
    const charTo = charFrom + gap.originalText.length;
    result =
      result.slice(0, charFrom) +
      `[GAP:${gap.id}]` +
      result.slice(charTo);
  }

  return result;
}

// --- Prompt Construction ---

/**
 * Build a GenerateRequest from the document scan and user parameters.
 */
export function buildRequest(
  goal: string,
  scan: DocumentScan,
  mode: GenerateMode,
  userRequest?: string,
): GenerateRequest {
  return {
    goal,
    document: scan.documentWithGaps,
    gaps: scan.gaps,
    constraints: scan.constraints,
    userRequest,
    mode,
  };
}

/**
 * Build a GenerateRequest for prompt bar (selection or continuation mode).
 */
export function buildPromptBarRequest(
  editor: Editor,
  goal: string,
  promptText: string,
  mode: 'selection' | 'continuation',
): GenerateRequest {
  const { doc, selection } = editor.state;

  if (mode === 'selection') {
    const { from, to } = selection;
    const selectedText = doc.textBetween(from, to, '', '');
    const gapId = nanoid(8);

    // Build document with the selection replaced by a gap
    const textBefore = doc.textBetween(0, from, '', '');
    const textAfter = doc.textBetween(to, doc.content.size, '', '');
    const documentWithGap = textBefore + `[GAP:${gapId}]` + textAfter;

    return {
      goal,
      document: documentWithGap,
      gaps: [{ id: gapId, position: { from, to }, originalText: selectedText }],
      constraints: [],
      userRequest: promptText,
      mode: 'selection',
    };
  }

  // Continuation mode
  const cursorPos = selection.from;
  const gapId = nanoid(8);
  const textBefore = doc.textBetween(0, cursorPos, '', '');
  const textAfter = doc.textBetween(cursorPos, doc.content.size, '', '');
  const documentWithGap = textBefore + `[GAP:${gapId}]` + textAfter;

  return {
    goal,
    document: documentWithGap,
    gaps: [{ id: gapId, position: { from: cursorPos, to: cursorPos }, originalText: '' }],
    constraints: [],
    userRequest: promptText,
    mode: 'continuation',
  };
}

/**
 * Build a GenerateRequest for smart-edit mode (chat editing).
 */
export function buildSmartEditRequest(
  editor: Editor,
  goal: string,
  promptText: string,
): GenerateRequest {
  const fullText = editor.state.doc.textBetween(
    0,
    editor.state.doc.content.size,
    '\n\n',  // Use double newline for paragraph separation
  );

  return {
    goal,
    document: fullText,
    gaps: [],
    constraints: [],
    userRequest: promptText,
    mode: 'smart-edit',
  };
}

// --- API Communication ---

/**
 * Call the /api/generate endpoint.
 */
export async function callGenerateAPI(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as GenerateError | null;
    throw new GenerationError(
      errorBody?.error ?? `API error: ${response.status}`,
      errorBody?.retryable ?? true,
    );
  }

  return (await response.json()) as GenerateResponse;
}

// --- Error Class ---

export class GenerationError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'GenerationError';
    this.retryable = retryable;
  }
}
