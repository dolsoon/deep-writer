import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { DiffEntry } from '@/types';

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

// --- Compute diff views for split panels ---

export function computeDiffViews(
  editorState: EditorState,
  pendingDiffs: DiffEntry[],
): DiffViewData {
  const originalDocJSON = editorState.doc.toJSON() as Record<string, unknown>;

  // Original highlights: positions of text that will be deleted
  const originalHighlights: DiffHighlight[] = pendingDiffs.map((diff) => ({
    from: diff.position,
    to: diff.position + diff.originalText.length,
  }));

  // Build modified document by applying all replacements via ProseMirror transaction
  const sorted = [...pendingDiffs].sort((a, b) => a.position - b.position);
  const { tr } = editorState;
  // Mark this transaction as programmatic to prevent automatic mark fixing
  tr.setMeta('programmaticTextState', true);
  tr.setMeta('previewOnly', true);
  const markType = editorState.schema.marks.textState;

  const modifiedHighlights: DiffHighlight[] = [];

  console.log('[DEBUG] computeDiffViews - Diff 처리 시작:', {
    diffCount: sorted.length,
    diffs: sorted.map(d => ({ id: d.id, roundId: d.roundId, hasRoundId: !!d.roundId }))
  });

  for (const diff of sorted) {
    const from = tr.mapping.map(diff.position);
    const to = tr.mapping.map(diff.position + diff.originalText.length);
    tr.insertText(diff.replacementText, from, to);

    // Apply ai-generated mark with roundId so modified editor carries proper marks
    if (markType && diff.roundId) {
      console.log('[DEBUG] computeDiffViews - 마크 적용:', {
        diffId: diff.id,
        roundId: diff.roundId,
        from,
        to: from + diff.replacementText.length,
        textLength: diff.replacementText.length
      });
      tr.addMark(
        from,
        from + diff.replacementText.length,
        markType.create({ state: 'ai-generated', roundId: diff.roundId }),
      );
    } else {
      console.warn('[DEBUG] computeDiffViews - 마크 스킵:', {
        diffId: diff.id,
        hasMarkType: !!markType,
        hasRoundId: !!diff.roundId,
        roundId: diff.roundId
      });
    }

    modifiedHighlights.push({
      from,
      to: from + diff.replacementText.length,
    });
  }

  const modifiedState = editorState.apply(tr);
  const modifiedDocJSON = modifiedState.doc.toJSON() as Record<string, unknown>;

  // Verify marks in the modified document JSON
  let markedTextNodes = 0;
  const jsonMarkSamples: any[] = [];
  if (modifiedDocJSON.content && Array.isArray(modifiedDocJSON.content)) {
    const checkNode = (node: any) => {
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(checkNode);
      }
      if (node.type === 'text' && node.marks) {
        markedTextNodes++;
        // Sample first few marked text nodes
        if (jsonMarkSamples.length < 3) {
          jsonMarkSamples.push({
            text: node.text?.slice(0, 30),
            marks: node.marks
          });
        }
      }
    };
    modifiedDocJSON.content.forEach(checkNode);
  }
  console.log('[DEBUG] computeDiffViews - JSON 생성 완료:', {
    markedTextNodes,
    jsonMarkSamples,
    hasContent: !!modifiedDocJSON.content
  });

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

  console.log('[DEBUG] applyAllDiffs 시작:', {
    diffCount: sorted.length,
    diffs: sorted.map(d => ({ id: d.id, roundId: d.roundId, text: d.replacementText.slice(0, 30) }))
  });

  for (const diff of sorted) {
    const from = tr.mapping.map(diff.position);
    const to = tr.mapping.map(diff.position + diff.originalText.length);
    tr.insertText(diff.replacementText, from, to);

    // Apply ai-generated mark with roundId to the replacement text
    if (markType) {
      console.log('[DEBUG] Diff 마크 적용:', {
        diffId: diff.id,
        roundId: diff.roundId,
        roundIdExists: !!diff.roundId,
        from,
        to: from + diff.replacementText.length
      });
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
