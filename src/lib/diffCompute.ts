import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { DiffEntry } from '@/types';
import { diffChars } from 'diff';

// --- Types ---

export interface DiffHighlight {
  from: number;
  to: number;
}

export interface DiffViewData {
  originalDocJSON: Record<string, unknown>;
  modifiedDocJSON: Record<string, unknown>;
  originalHighlights: DiffHighlight[];
  modifiedHighlights: DiffHighlight[];
}

// --- Word-level diff with position tracking (LCS-based, matching tooltip behavior) ---

interface WordToken {
  word: string;
  from: number;
  to: number;
}

function tokenizeWithPositions(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({ word: match[0], from: match.index, to: match.index + match[0].length });
  }
  return tokens;
}

function computeWordDiffHighlights(
  originalText: string,
  replacementText: string,
): { origHL: DiffHighlight[]; modHL: DiffHighlight[] } {
  const origTokens = tokenizeWithPositions(originalText);
  const modTokens = tokenizeWithPositions(replacementText);
  const m = origTokens.length;
  const n = modTokens.length;

  // LCS table (case-insensitive, same as tooltip's computeWordDiff)
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origTokens[i - 1].word.toLowerCase() === modTokens[j - 1].word.toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find removed/added word indices
  const removedIdx: number[] = [];
  const addedIdx: number[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origTokens[i - 1].word.toLowerCase() === modTokens[j - 1].word.toLowerCase()) {
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      addedIdx.push(j - 1);
      j--;
    } else {
      removedIdx.push(i - 1);
      i--;
    }
  }

  // Convert to position-based highlights, merging adjacent tokens
  removedIdx.sort((a, b) => a - b);
  addedIdx.sort((a, b) => a - b);

  const origHL: DiffHighlight[] = [];
  for (const idx of removedIdx) {
    const t = origTokens[idx];
    const last = origHL[origHL.length - 1];
    if (last && last.to >= t.from) {
      last.to = t.to;
    } else {
      origHL.push({ from: t.from, to: t.to });
    }
  }

  const modHL: DiffHighlight[] = [];
  for (const idx of addedIdx) {
    const t = modTokens[idx];
    const last = modHL[modHL.length - 1];
    if (last && last.to >= t.from) {
      last.to = t.to;
    } else {
      modHL.push({ from: t.from, to: t.to });
    }
  }

  return { origHL, modHL };
}

// --- Compute diff views for split panels ---

export function computeDiffViews(
  editorState: EditorState,
  pendingDiffs: DiffEntry[],
): DiffViewData {
  const originalDocJSON = editorState.doc.toJSON() as Record<string, unknown>;

  const sorted = [...pendingDiffs].sort((a, b) => a.position - b.position);
  const { tr } = editorState;
  tr.setMeta('programmaticTextState', true);
  tr.setMeta('previewOnly', true);
  const markType = editorState.schema.marks.textState;

  const originalHighlights: DiffHighlight[] = [];
  const modifiedHighlights: DiffHighlight[] = [];

  for (const diff of sorted) {
    const from = tr.mapping.map(diff.position);
    // Use explicit endPosition if available; otherwise calculate from text length
    const rawTo = diff.endPosition !== undefined
      ? tr.mapping.map(diff.endPosition)
      : tr.mapping.map(diff.position + diff.originalText.length);
    const to = Math.min(rawTo, tr.doc.content.size);

    if (from < 0 || from > to) {
      continue;
    }

    // Word-level diff with position tracking (LCS-based, same as tooltip)
    const { origHL, modHL } = computeWordDiffHighlights(diff.originalText, diff.replacementText);

    for (const hl of origHL) {
      originalHighlights.push({ from: diff.position + hl.from, to: diff.position + hl.to });
    }

    tr.insertText(diff.replacementText, from, to);

    if (markType && diff.roundId) {
      tr.addMark(
        from,
        from + diff.replacementText.length,
        markType.create({ state: 'ai-generated', roundId: diff.roundId }),
      );
    }

    for (const hl of modHL) {
      modifiedHighlights.push({ from: from + hl.from, to: from + hl.to });
    }
  }

  const modifiedState = editorState.apply(tr);
  const modifiedDocJSON = modifiedState.doc.toJSON() as Record<string, unknown>;

  return {
    originalDocJSON,
    modifiedDocJSON,
    originalHighlights,
    modifiedHighlights,
  };
}

// --- Apply all diffs to the real editor ---

export function applyAllDiffs(
  editor: Editor,
  pendingDiffs: DiffEntry[],
): void {
  const sorted = [...pendingDiffs].sort((a, b) => a.position - b.position);
  const { tr } = editor.state;
  const markType = editor.schema.marks.textState;

  for (const diff of sorted) {
    const from = tr.mapping.map(diff.position);
    const rawTo = diff.endPosition !== undefined
      ? tr.mapping.map(diff.endPosition)
      : tr.mapping.map(diff.position + diff.originalText.length);
    const to = Math.min(rawTo, tr.doc.content.size);
    tr.insertText(diff.replacementText, from, to);

    // Apply ai-generated mark with roundId to the replacement text
    if (markType) {
      tr.addMark(
        from,
        from + diff.replacementText.length,
        markType.create({ state: 'ai-generated', roundId: diff.roundId }),
      );
    }
  }

  tr.setMeta('programmaticTextState', true);
  editor.view.dispatch(tr);
}

// --- Compute individual diffs from smart-edit response ---

export interface SmartEditDiff {
  originalText: string;
  replacementText: string;
  position: number;
}

/**
 * Build a character-level mapping from text index to ProseMirror position.
 * Accounts for paragraph separators ('\n\n') inserted by textBetween.
 */
function buildCharToPmMap(editor: Editor): number[] {
  const charMap: number[] = [];
  let isFirstBlock = true;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;

    // Add separator entries for '\n\n' between paragraphs
    if (!isFirstBlock) {
      charMap.push(-1); // \n
      charMap.push(-1); // \n
    }
    isFirstBlock = false;

    // Add each text character's absolute PM position
    node.forEach((child, childOffset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          charMap.push(pos + 1 + childOffset + i);
        }
      }
    });

    return false; // Don't descend further
  });

  return charMap;
}

/**
 * Compare original and edited documents character by character.
 * Returns an array of SmartEditDiff objects with accurate ProseMirror positions.
 * Adjacent changes are merged into single diffs.
 */
export function computeSmartEditDiffs(
  editor: Editor,
  originalText: string,
  editedText: string,
): SmartEditDiff[] {
  // 1. Build character-level mapping
  const charMap = buildCharToPmMap(editor);

  if (charMap.length !== originalText.length) {
    return []; // Fallback to single diff
  }

  // 2. Compute character-level diff
  const changes = diffChars(originalText, editedText);

  // 3. Collect raw diffs with PM positions
  const rawDiffs: SmartEditDiff[] = [];
  let textPos = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change.removed) {
      const next = (i + 1 < changes.length && changes[i + 1].added) ? changes[i + 1] : null;
      const pmPos = charMap[textPos];

      if (pmPos === undefined || pmPos === -1) {
        // Skip changes at separator positions
        textPos += change.value.length;
        if (next) i++;
        continue;
      }

      if (next) {
        // Replacement: removed + added
        rawDiffs.push({
          originalText: change.value,
          replacementText: next.value,
          position: pmPos,
        });
        textPos += change.value.length;
        i++; // Skip the added part
      } else {
        // Pure deletion
        rawDiffs.push({
          originalText: change.value,
          replacementText: '',
          position: pmPos,
        });
        textPos += change.value.length;
      }
    } else if (change.added) {
      // Pure addition (no preceding removal)
      const pmPos = textPos < charMap.length
        ? charMap[textPos]
        : (charMap.length > 0 ? charMap[charMap.length - 1] + 1 : 1);

      if (pmPos !== -1) {
        rawDiffs.push({
          originalText: '',
          replacementText: change.value,
          position: pmPos,
        });
      }
    } else {
      // Unchanged - advance position
      textPos += change.value.length;
    }
  }

  // 4. Merge adjacent diffs (gap <= 2 chars) to reduce noise
  const merged: SmartEditDiff[] = [];
  for (const diff of rawDiffs) {
    const last = merged[merged.length - 1];
    if (last) {
      const lastEndPm = last.position + last.originalText.length;
      const gap = diff.position - lastEndPm;

      if (gap >= 0 && gap <= 2) {
        // Grab the unchanged gap text from the original
        const lastEndTextIdx = charMap.indexOf(lastEndPm);
        const diffStartTextIdx = charMap.indexOf(diff.position);

        if (lastEndTextIdx >= 0 && diffStartTextIdx >= 0 && diffStartTextIdx >= lastEndTextIdx) {
          const gapText = originalText.slice(lastEndTextIdx, diffStartTextIdx);
          last.originalText += gapText + diff.originalText;
          last.replacementText += gapText + diff.replacementText;
          continue;
        }
      }
    }
    merged.push({ ...diff });
  }

  return merged;
}

// --- Clean up stale marks after diff acceptance ---

/**
 * Remove only 'marked-delete' and 'original-removed' textState marks
 * from the document. Preserves 'ai-generated', 'user-written',
 * 'user-edited', and 'marked-preserve' marks for contribution tracking.
 */
export function cleanStaleTextStateMarks(editor: Editor): void {
  const markType = editor.schema.marks.textState;
  if (!markType) return;

  const { tr } = editor.state;
  let modified = false;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const tsm = node.marks.find((m) => m.type === markType);
    if (
      tsm &&
      (tsm.attrs.state === 'marked-delete' ||
       tsm.attrs.state === 'original-removed')
    ) {
      tr.removeMark(pos, pos + node.nodeSize, tsm);
      modified = true;
    }
  });

  if (modified) {
    tr.setMeta('programmaticTextState', true);
    editor.view.dispatch(tr);
  }
}
