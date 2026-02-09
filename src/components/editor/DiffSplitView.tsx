'use client';

import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import type { DiffEntry } from '@/types';
import { TextStateExtension } from '@/extensions/TextStateExtension';
import type { DiffHighlight } from '@/lib/diffCompute';
import { computeDiffViews } from '@/lib/diffCompute';
import { useSyncScroll } from '@/hooks/useSyncScroll';
import { getPhraseBoundary } from '@/lib/boundaries';
import { KeepDeleteTooltip } from '@/components/editor/KeepDeleteTooltip';

// --- Highlight Extension (lightweight, read-only decorations) ---

const highlightPluginKey = new PluginKey('diffHighlight');

function createHighlightExtension(
  highlights: DiffHighlight[],
  className: string,
) {
  return Extension.create({
    name: `diffHighlight-${className}`,

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: highlightPluginKey,
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              for (const h of highlights) {
                const from = Math.max(0, h.from);
                const to = Math.min(h.to, state.doc.content.size);
                if (from < to) {
                  decorations.push(
                    Decoration.inline(from, to, { class: className }),
                  );
                }
              }
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
}

// --- DiffPanel (individual read-only editor panel) ---

interface DiffPanelProps {
  docJSON: Record<string, unknown>;
  highlights: DiffHighlight[];
  highlightClass: string;
  label: string;
  editable?: boolean;
  onEditorReady?: (editor: Editor) => void;
}

function DiffPanel({ docJSON, highlights, highlightClass, label, editable = false, onEditorReady }: DiffPanelProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        TextStateExtension.configure({
          disableAutoMarkFix: true, // Preserve marks from computeDiffViews
        }),
        createHighlightExtension(highlights, highlightClass),
      ],
      content: docJSON,
      editable,
    },
    [docJSON, highlights, highlightClass],
  );

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {label}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 text-gray-900 dark:text-gray-100">
        <EditorContent
          editor={editor}
          className="max-w-none text-sm leading-relaxed focus:outline-none"
        />
      </div>
    </div>
  );
}

// --- Clause selection state ---

interface ClauseSelection {
  from: number;
  to: number;
  rect: DOMRect;
}

// --- DiffSplitView (main split container) ---

interface DiffSplitViewProps {
  editor: Editor;
  pendingDiffs: DiffEntry[];
  onModifiedEditorReady?: (editor: Editor) => void;
}

export function DiffSplitView({ editor, pendingDiffs, onModifiedEditorReady }: DiffSplitViewProps) {
  const modifiedEditorRef = useRef<Editor | null>(null);
  const [clauseSelection, setClauseSelection] = useState<ClauseSelection | null>(null);

  const diffData = useMemo(
    () => computeDiffViews(editor.state, pendingDiffs),
    [editor.state, pendingDiffs],
  );

  const { leftRef, rightRef, handleLeftScroll, handleRightScroll } =
    useSyncScroll();

  // Store the modified editor reference and forward to parent callback
  const handleModifiedEditorReady = useCallback(
    (ed: Editor) => {
      modifiedEditorRef.current = ed;
      onModifiedEditorReady?.(ed);
    },
    [onModifiedEditorReady],
  );

  // Handle mouseup on Modified panel: snap selection to clause boundaries
  const handleModifiedMouseUp = useCallback(() => {
    const modEditor = modifiedEditorRef.current;
    if (!modEditor || modEditor.isDestroyed) return;

    const { from, to } = modEditor.state.selection;
    // Only act on drag selections (non-collapsed)
    if (from === to) {
      return;
    }

    const doc = modEditor.state.doc;

    // Snap both endpoints to the nearest phrase (clause) boundary
    const startBoundary = getPhraseBoundary(doc, from);
    const endBoundary = getPhraseBoundary(doc, to);
    const snappedFrom = startBoundary.from;
    const snappedTo = endBoundary.to;

    if (snappedFrom >= snappedTo) return;

    // Update ProseMirror selection to snapped range
    modEditor.chain().focus().setTextSelection({ from: snappedFrom, to: snappedTo }).run();

    // Get the visual rect of the snapped selection for tooltip positioning
    const { view } = modEditor;
    const startCoords = view.coordsAtPos(snappedFrom);
    const endCoords = view.coordsAtPos(snappedTo);
    const rect = new DOMRect(
      Math.min(startCoords.left, endCoords.left),
      startCoords.top,
      Math.abs(endCoords.right - startCoords.left),
      endCoords.bottom - startCoords.top,
    );

    setClauseSelection({ from: snappedFrom, to: snappedTo, rect });
  }, []);

  // Keep button: apply marked-preserve to snapped selection
  const handleKeep = useCallback(() => {
    const modEditor = modifiedEditorRef.current;
    if (!modEditor || !clauseSelection) return;

    modEditor
      .chain()
      .focus()
      .setTextSelection({ from: clauseSelection.from, to: clauseSelection.to })
      .setTextState('marked-preserve')
      .run();

    setClauseSelection(null);
  }, [clauseSelection]);

  // Delete button: apply marked-delete to snapped selection
  const handleDelete = useCallback(() => {
    const modEditor = modifiedEditorRef.current;
    if (!modEditor || !clauseSelection) return;

    modEditor
      .chain()
      .focus()
      .setTextSelection({ from: clauseSelection.from, to: clauseSelection.to })
      .setTextState('marked-delete')
      .run();

    setClauseSelection(null);
  }, [clauseSelection]);

  // Dismiss tooltip
  const handleDismiss = useCallback(() => {
    setClauseSelection(null);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        ref={leftRef}
        onScroll={handleLeftScroll}
        className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      >
        <DiffPanel
          docJSON={diffData.originalDocJSON}
          highlights={diffData.originalHighlights}
          highlightClass="diff-highlight-removed"
          label="Original"
        />
      </div>
      <div
        ref={rightRef}
        onScroll={handleRightScroll}
        onMouseUp={handleModifiedMouseUp}
        className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-gray-900"
      >
        <DiffPanel
          docJSON={diffData.modifiedDocJSON}
          highlights={diffData.modifiedHighlights}
          highlightClass="diff-highlight-added"
          label="Modified"
          editable
          onEditorReady={handleModifiedEditorReady}
        />
      </div>
      {clauseSelection && (
        <KeepDeleteTooltip
          selectionRect={clauseSelection.rect}
          onKeep={handleKeep}
          onDelete={handleDelete}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}
