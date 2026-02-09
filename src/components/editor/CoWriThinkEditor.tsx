'use client';

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStateExtension } from '@/extensions/TextStateExtension';
import { ProvenancePlugin } from '@/extensions/ProvenancePlugin';
import {
  DiffDecorationPlugin,
  updateDiffs,
} from '@/extensions/DiffDecorationPlugin';
import {
  ConstraintDecorationPlugin,
  updateConstraintDecorations,
} from '@/extensions/ConstraintDecorationPlugin';
import {
  ContributionDecorationPlugin,
  updateContributionOverlay,
  refreshContributionScores,
} from '@/extensions/ContributionDecorationPlugin';
import type { ScoreAccessor } from '@/extensions/ContributionDecorationPlugin';
import { InspectClickPlugin } from '@/extensions/InspectClickPlugin';
import { DeletionMarkerPlugin } from '@/extensions/DeletionMarkerPlugin';
import { useInspectStore } from '@/stores/useInspectStore';
import { MarkingExtension, clearMarkingSelection, expandMarkingSelection } from '@/extensions/MarkingExtension';
import type { DragSelectionData, ConstraintData, ExpandLevel } from '@/extensions/MarkingExtension';
import { AlternativesTooltip } from '@/components/editor/AlternativesTooltip';
import { useEditorStore } from '@/stores/useEditorStore';
import { useConstraintStore } from '@/stores/useConstraintStore';
import { useLoadingStore } from '@/stores/useLoadingStore';
import { useProvenanceStore } from '@/stores/useProvenanceStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useRoundStore } from '@/stores/useRoundStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { computeD1Base, computeD2Base, computeD3Base } from '@/lib/scoring';
import type { EventType } from '@/types';

// --- Types ---

export interface CoWriThinkEditorHandle {
  getEditor: () => Editor | null;
}

interface CoWriThinkEditorProps {
  initialContent?: JSONContent | string;
  onUpdate?: (content: string) => void;
  onEditorReady?: (editor: Editor) => void;
  className?: string;
}

// --- Stable Callback Refs ---

// These functions access store state at call time via getState(),
// avoiding stale closure issues with TipTap's one-time extension capture.

function handleProvenanceEvent(
  type: EventType,
  data: Record<string, unknown>,
) {
  const event = useProvenanceStore.getState().logEvent(type, data);
  useSessionStore.getState().addProvenanceEvent(event);
}

// Module-level mutable ref for drag-selection tooltip.
// TipTap captures extension options once, so the callback must be stable.
// This mirrors the handleProvenanceEvent pattern above.
let _setTooltipData: ((data: DragSelectionData | null) => void) | null = null;
let _resetActiveLevel: (() => void) | null = null;
let _originalFrom = 0;
let _originalTo = 0;

function handleDragSelection(data: DragSelectionData) {
  _originalFrom = data.from;
  _originalTo = data.to;
  _resetActiveLevel?.();
  _setTooltipData?.(data);
}

function dismissTooltip() {
  _setTooltipData?.(null);
}

function handleConstraintAdd(data: ConstraintData) {
  useConstraintStore.getState().addConstraint(data.type, data.text, data.from, data.to);
}

/**
 * Collect unique, non-null roundId values from textState marks in a document range.
 */
function collectRoundIds(editor: Editor, from: number, to: number): string[] {
  const roundIds = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const textStateMark = node.marks.find((m) => m.type.name === 'textState');
    if (textStateMark?.attrs?.roundId) {
      roundIds.add(textStateMark.attrs.roundId as string);
    }
  });
  return Array.from(roundIds);
}

// --- Component ---

export const CoWriThinkEditor = forwardRef<CoWriThinkEditorHandle, CoWriThinkEditorProps>(
  function CoWriThinkEditor(
    { initialContent = '', onUpdate, onEditorReady, className = '' },
    ref,
  ) {
    const isReadOnly = useEditorStore((s) => s.isReadOnly);
    const isGenerating = useLoadingStore((s) => s.isGenerating);
    const activeDiffs = useEditorStore((s) => s.activeDiffs);
    const sessionGoal = useSessionStore((s) => s.session?.goal ?? '');
    const constraints = useConstraintStore((s) => s.constraints);
    const isInspectMode = useInspectStore((s) => s.isInspectMode);
    const graphNodeCount = useContributionGraphStore((s) => s.nodes.size);
    const editorRef = useRef<ReturnType<typeof useEditor>>(null);

    // Drag-selection tooltip state
    const [tooltipData, setTooltipData] = useState<DragSelectionData | null>(null);
    const [activeLevel, setActiveLevel] = useState<ExpandLevel | 'word'>('word');
    const handleTooltipDismiss = useCallback(() => {
      setTooltipData(null);
      setActiveLevel('word');
      // Clear the marking decoration when tooltip is dismissed
      if (editorRef.current?.view) {
        clearMarkingSelection(editorRef.current.view);
      }
    }, []);

    const handleExpandSelection = useCallback((level: ExpandLevel) => {
      if (!editorRef.current?.view || !tooltipData) return;
      const view = editorRef.current.view;
      const explicit = level === 'word' ? { from: _originalFrom, to: _originalTo } : undefined;
      const result = expandMarkingSelection(view, level, _originalFrom, explicit);
      if (!result) return;

      setActiveLevel(level);

      const doc = view.state.doc;
      const docSize = doc.content.size;
      const contextStart = Math.max(0, result.from - 200);
      const contextEnd = Math.min(docSize, result.to + 200);
      const context = doc.textBetween(contextStart, contextEnd, ' ');

      // Use ProseMirror coordsAtPos for rect computation (works without DOM focus)
      const coordsFrom = view.coordsAtPos(result.from);
      const coordsTo = view.coordsAtPos(result.to);
      const rect = new DOMRect(
        coordsFrom.left,
        coordsFrom.top,
        coordsTo.right - coordsFrom.left,
        coordsTo.bottom - coordsFrom.top,
      );

      setTooltipData({
        from: result.from,
        to: result.to,
        text: result.text,
        context,
        rect,
      });
    }, [tooltipData]);

    // Diff interaction handler using getState() for fresh store access
    const handleDiffInteraction = useRef(
      (diffId: string, action: 'accept' | 'reject' | 'restore') => {
        useEditorStore.getState().resolveDiff(diffId, action);
        const event = useProvenanceStore.getState().logEvent('diff-resolved', {
          diffId,
          action,
        });
        useSessionStore.getState().addProvenanceEvent(event);

        // Immediately update decorations with remaining pending diffs
        if (editorRef.current) {
          const pendingDiffs = useEditorStore.getState().getActiveDiffs();
          updateDiffs(editorRef.current, pendingDiffs);
        }
      },
    );

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Ensure marks are preserved
          dropcursor: { color: '#3b82f6' },
        }),
        TextStateExtension,
        ProvenancePlugin.configure({
          onProvenanceEvent: handleProvenanceEvent,
        }),
        DiffDecorationPlugin.configure({
          onDiffInteraction: (diffId, action) =>
            handleDiffInteraction.current(diffId, action),
        }),
        ConstraintDecorationPlugin,
        ContributionDecorationPlugin,
        InspectClickPlugin,
        DeletionMarkerPlugin,
        MarkingExtension.configure({
          onProvenanceEvent: handleProvenanceEvent,
          onDragSelection: handleDragSelection,
          onConstraintAdd: handleConstraintAdd,
        }),
      ],
      content: initialContent,
      editable: !isReadOnly && !isGenerating,
      onUpdate: ({ editor: ed }) => {
        // Persist document state to session store
        useSessionStore.getState().updateDocumentState(ed.getJSON());
        // Dismiss drag-selection tooltip when document content changes
        dismissTooltip();
        // Call external callback if provided
        onUpdate?.(ed.getHTML());
      },
    });

    // Keep editor ref in sync
    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    // Wire up the module-level tooltip callback so the MarkingExtension
    // can set React state even though TipTap captured options once.
    useEffect(() => {
      _setTooltipData = setTooltipData;
      _resetActiveLevel = () => setActiveLevel('word');
      return () => {
        _setTooltipData = null;
        _resetActiveLevel = null;
      };
    }, []);

    // Expose editor instance to parent via ref
    useImperativeHandle(ref, () => ({
      getEditor: () => editor,
    }), [editor]);

    // Notify parent when editor is ready
    useEffect(() => {
      if (editor && onEditorReady) {
        onEditorReady(editor);
      }
    }, [editor, onEditorReady]);

    // Expose editor to window for debugging (development only)
    useEffect(() => {
      if (editor && typeof window !== 'undefined') {
        (window as typeof window & { __TIPTAP_EDITOR__?: typeof editor }).__TIPTAP_EDITOR__ = editor;
        return () => {
          delete (window as typeof window & { __TIPTAP_EDITOR__?: typeof editor }).__TIPTAP_EDITOR__;
        };
      }
    }, [editor]);

    // Sync decoration state when activeDiffs change externally
    useEffect(() => {
      if (!editor) return;
      const pendingDiffs = activeDiffs.filter((d) => d.state === 'pending');
      updateDiffs(editor, pendingDiffs);
    }, [editor, activeDiffs]);

    // Sync constraint decorations when constraints change
    useEffect(() => {
      if (!editor) return;
      updateConstraintDecorations(editor, constraints);
    }, [editor, constraints]);

    // Sync contribution overlay when inspect mode changes
    useEffect(() => {
      if (!editor) return;
      // Suppress overlay during active diff review (REQ-VIS-026)
      const hasPending = useEditorStore.getState().activeDiffs.some((d) => d.state === 'pending');
      const shouldActivate = isInspectMode && !hasPending;
      const scoreAccessor: ScoreAccessor = (roundId, dimension) =>
        useContributionGraphStore.getState().accumulatedScore(roundId, dimension);
      updateContributionOverlay(editor, shouldActivate, scoreAccessor);
    }, [editor, isInspectMode, activeDiffs]);

    // Refresh contribution overlay when graph scores update
    useEffect(() => {
      if (!editor || !isInspectMode) return;
      const scoreAccessor: ScoreAccessor = (roundId, dimension) =>
        useContributionGraphStore.getState().accumulatedScore(roundId, dimension);
      refreshContributionScores(editor, scoreAccessor);
    }, [editor, isInspectMode, graphNodeCount]);

    return (
      <div
        className={`flex-1 text-gray-900 dark:text-gray-100 ${className}`}
      >
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none dark:prose-invert focus:outline-none"
        />
        {tooltipData && editor && (
          <>
            <AlternativesTooltip
              selectionRect={tooltipData.rect}
              selectedText={tooltipData.text}
              context={tooltipData.context}
              goal={sessionGoal}
              onReplace={(alternative) => {
                // Collect parentRounds from the text being replaced
                const parentRoundIds = collectRoundIds(editor, tooltipData.from, tooltipData.to);

                // Create alternative round
                const round = useRoundStore.getState().createRound({
                  type: 'alternative',
                  parentRounds: parentRoundIds,
                  prompt: null,
                  promptLength: 0,
                  constraintCount: 0,
                  constraintTypes: [],
                  generationMode: 'alternative',
                  diffActions: { accepted: 0, rejected: 0, edited: 0 },
                  events: [],
                });

                // Create graph node with base scores
                const d1 = computeD1Base('ai-generated', 'alternative');
                const d2 = computeD2Base({
                  promptLength: 0,
                  constraintCount: 0,
                  type: 'alternative',
                });
                const d3 = computeD3Base('alt-selected');
                useContributionGraphStore.getState().addNode(round.roundId, { d1, d2, d3 }, {
                  prompt: null,
                  constraints: [],
                  action: 'alt-selected',
                  type: 'alternative',
                  previousText: tooltipData.text,
                  resultText: alternative,
                });

                if (activeLevel === 'paragraph') {
                  // Paragraph mode: creates diff (roundId not applied to text yet)
                  useEditorStore.getState().addDiff(
                    tooltipData.text,
                    alternative,
                    tooltipData.from,
                    round.roundId,
                  );
                  const activeDiffs = useEditorStore.getState().getActiveDiffs();
                  updateDiffs(editor, activeDiffs);
                  handleTooltipDismiss();
                } else {
                  // Word/sentence mode: direct insertion with roundId mark
                  const { tr } = editor.state;
                  tr.insertText(alternative, tooltipData.from, tooltipData.to);
                  const markType = editor.schema.marks.textState;
                  if (markType) {
                    tr.addMark(
                      tooltipData.from,
                      tooltipData.from + alternative.length,
                      markType.create({ state: 'ai-generated', roundId: round.roundId }),
                    );
                  }
                  tr.setMeta('programmaticTextState', true);
                  editor.view.dispatch(tr);
                  setTooltipData(null);
                }
              }}
              onDismiss={handleTooltipDismiss}
              onExpandSelection={handleExpandSelection}
              activeLevel={activeLevel}
            />
          </>
        )}
      </div>
    );
  },
);
