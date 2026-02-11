import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EventType } from '@/types';
import {
  getWordBoundary,
  getPhraseBoundary,
  getSentenceBoundary,
  getParagraphBoundary,
} from '@/lib/boundaries';
import type { TextRange } from '@/lib/boundaries';

// --- Types ---

export type SelectionLevel = 'word' | 'phrase' | 'sentence' | 'paragraph' | 'all';

export interface DragSelectionData {
  from: number;
  to: number;
  text: string;
  context: string;
  rect: DOMRect;
}

export interface ConstraintData {
  type: 'positive' | 'negative' | 'context';
  text: string;
  from: number;
  to: number;
}

export interface MarkingExtensionOptions {
  onProvenanceEvent?: (
    type: EventType,
    data: Record<string, unknown>,
  ) => void;
  onDragSelection?: ((data: DragSelectionData) => void) | null;
  onConstraintAdd?: ((data: ConstraintData) => void) | null;
}

interface MarkingPluginState {
  selectionLevel: SelectionLevel | null;
  selectedRange: TextRange | null;
  decorations: DecorationSet;
}

// --- Constants ---

const markingPluginKey = new PluginKey('marking');

const SELECTION_CLASS = 'marking-selection';

export type ExpandLevel = 'word' | 'phrase' | 'sentence' | 'paragraph' | 'all';

function getRangeForLevel(
  level: SelectionLevel,
  doc: ProseMirrorNode,
  pos: number,
): { from: number; to: number } {
  switch (level) {
    case 'word':
      return getWordBoundary(doc, pos);
    case 'phrase':
      return getPhraseBoundary(doc, pos);
    case 'sentence':
      return getSentenceBoundary(doc, pos);
    case 'paragraph':
      return getParagraphBoundary(doc, pos);
    case 'all':
      return { from: 0, to: doc.content.size };
  }
}

// --- Decoration Builder ---

function buildSelectionDecorations(
  state: MarkingPluginState,
  doc: ProseMirrorNode,
): DecorationSet {
  const decorations: Decoration[] = [];

  if (state.selectedRange && state.selectionLevel) {
    const { from, to } = state.selectedRange;
    if (from >= 0 && to <= doc.content.size && from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: SELECTION_CLASS,
        }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

// --- Helpers ---

function hasActiveDiffAtPos(view: EditorView, pos: number): boolean {
  // Check for diff decorations at this position by looking for diff plugin state
  const diffPluginKey = new PluginKey('diffDecoration');
  const diffState = diffPluginKey.getState(view.state);
  if (!diffState?.diffs) return false;

  for (const diff of diffState.diffs) {
    if (diff.state !== 'pending') continue;
    const from = diff.position;
    const to = from + diff.originalText.length;
    if (pos >= from && pos < to) return true;
  }
  return false;
}

// --- Extension ---

export const MarkingExtension = Extension.create<MarkingExtensionOptions>({
  name: 'marking',

  addOptions() {
    return {
      onProvenanceEvent: undefined,
      onDragSelection: null,
      onConstraintAdd: null,
    };
  },

  addProseMirrorPlugins() {
    const onDragSelection = this.options.onDragSelection ?? null;

    // Map to store global mouseup handlers per EditorView to avoid 'any' and handle multiple instances
    const globalMouseUpHandlers = new WeakMap<EditorView, (e: MouseEvent) => void>();

    // Drag detection state (closure-scoped, not plugin state).
    // We measure the distance between mousedown and mouseup to distinguish
    // a drag-selection from a click (single, double, or triple).
    let mouseDownCoords: { x: number; y: number } | null = null;
    const MIN_DRAG_DISTANCE = 5;

    function getInitialState(): MarkingPluginState {
      return {
        selectionLevel: null,
        selectedRange: null,
        decorations: DecorationSet.empty,
      };
    }

    function hasTextAtPos(doc: ProseMirrorNode, pos: number): boolean {
      // Check if there's actual text content at or near this position
      if (doc.content.size === 0) return false;
      const resolved = doc.resolve(Math.min(pos, doc.content.size));
      const parent = resolved.parent;
      return parent.textContent.trim().length > 0;
    }

    return [
      new Plugin({
        key: markingPluginKey,

        state: {
          init(): MarkingPluginState {
            return getInitialState();
          },

          apply(tr, value, _oldState, newState): MarkingPluginState {
            // Check for explicit state update via meta
            const newPluginState = tr.getMeta(markingPluginKey);
            if (newPluginState) {
              const updated = {
                ...newPluginState,
                decorations: buildSelectionDecorations(
                  newPluginState,
                  newState.doc,
                ),
              };
              return updated;
            }

            // Map decorations through document changes
            if (tr.docChanged) {
              return {
                ...value,
                decorations: value.decorations.map(tr.mapping, tr.doc),
              };
            }

            return value;
          },
        },

        view(editorView) {
          const handleGlobalMouseUp = (e: MouseEvent) => {
            if (!mouseDownCoords || !onDragSelection) {
              mouseDownCoords = null;
              return;
            }

            const dx = e.clientX - mouseDownCoords.x;
            const dy = e.clientY - mouseDownCoords.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            mouseDownCoords = null;

            window.removeEventListener('mouseup', handleGlobalMouseUp);

            // Mouse barely moved — this is a click, not a drag
            if (distance < MIN_DRAG_DISTANCE) return;
            if (!editorView.editable) return;

            // Defer to let ProseMirror sync the selection after the drag
            setTimeout(() => {
              if (!editorView.dom.isConnected) return;

              const { from, to } = editorView.state.selection;
              if (from === to) return;

              // Use exact user selection without word-boundary snapping.
              // Expansion happens later when the user clicks the Alternatives button.
              const text = editorView.state.doc.textBetween(from, to, ' ');
              if (text.trim().length < 2) return;

              // Apply marking decoration so highlight persists when tooltip takes focus
              const tr = editorView.state.tr.setSelection(
                TextSelection.create(editorView.state.doc, from, to),
              );
              const newPluginState: MarkingPluginState = {
                selectionLevel: null,
                selectedRange: { from, to },
                decorations: DecorationSet.empty,
              };
              tr.setMeta(markingPluginKey, newPluginState);
              editorView.dispatch(tr);

              // Get the bounding rect of the browser selection
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return;
              const rect = sel.getRangeAt(0).getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return;

              // Build surrounding context (~200 chars before and after)
              const docSize = editorView.state.doc.content.size;
              const contextStart = Math.max(0, from - 200);
              const contextEnd = Math.min(docSize, to + 200);
              const context = editorView.state.doc.textBetween(
                contextStart,
                contextEnd,
                ' ',
              );

              onDragSelection({ from, to, text, context, rect });
            }, 0);
          };

          // Attach handler to WeakMap so mousedown can access it
          globalMouseUpHandlers.set(editorView, handleGlobalMouseUp);

          return {
            update: () => {},
            destroy: () => {
              window.removeEventListener('mouseup', handleGlobalMouseUp);
              globalMouseUpHandlers.delete(editorView);
            }
          };
        },

        props: {
          handleDOMEvents: {
            mousedown: (view: EditorView, event: Event) => {
              const e = event as MouseEvent;
              mouseDownCoords = { x: e.clientX, y: e.clientY };
              const handler = globalMouseUpHandlers.get(view);
              if (handler) {
                window.addEventListener('mouseup', handler);
              }
              return false;
            },
          },

          decorations(state) {
            const pluginState = markingPluginKey.getState(state) as
              | MarkingPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },

          handleClick(view, _pos, event) {
            // Ignore right-clicks
            if (event.button !== 0) return false;

            // Single click: plain cursor, clear any marking decoration
            const pluginState = markingPluginKey.getState(view.state) as MarkingPluginState;
            if (pluginState?.selectedRange) {
              view.dispatch(
                view.state.tr.setMeta(markingPluginKey, getInitialState()),
              );
            }

            // Return false to allow default cursor placement
            return false;
          },

          handleDoubleClick(view, pos) {
            // Alternative generation now works in all modes (removed isInspectMode check)
            if (!view.editable) return false;
            if (hasActiveDiffAtPos(view, pos)) return false;
            if (!hasTextAtPos(view.state.doc, pos)) return false;

            const doc = view.state.doc;

            // Double-click always selects word. Expansion to phrase/sentence/
            // paragraph/all is handled via tooltip buttons.
            const range = getWordBoundary(doc, pos);

            const text = doc.textBetween(range.from, range.to, '', '').trim();
            if (!text) return false;

            // Select the range and apply decoration
            const tr = view.state.tr.setSelection(
              TextSelection.create(doc, range.from, range.to),
            );
            const newState: MarkingPluginState = {
              selectionLevel: 'word',
              selectedRange: range,
              decorations: DecorationSet.empty,
            };
            newState.decorations = buildSelectionDecorations(newState, doc);
            tr.setMeta(markingPluginKey, newState);
            view.dispatch(tr);

            // Show the tooltip for the selection (same as drag does)
            if (onDragSelection) {
              // Defer slightly to let the browser update the selection rendering
              setTimeout(() => {
                if (!view.dom.isConnected) return;
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;
                const rect = sel.getRangeAt(0).getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return;

                // Build surrounding context (~200 chars before and after)
                const docSize = view.state.doc.content.size;
                const contextStart = Math.max(0, range.from - 200);
                const contextEnd = Math.min(docSize, range.to + 200);
                const context = view.state.doc.textBetween(contextStart, contextEnd, ' ');

                onDragSelection({
                  from: range.from,
                  to: range.to,
                  text,
                  context,
                  rect,
                });
              }, 0);
            }

            return true;
          },

          handleKeyDown(view, event) {
            if (event.key === 'Escape') {
              const pluginState = markingPluginKey.getState(
                view.state,
              ) as MarkingPluginState;
              if (pluginState?.selectedRange) {
                view.dispatch(
                  view.state.tr.setMeta(
                    markingPluginKey,
                    getInitialState(),
                  ),
                );
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

// --- Helper: Get current marking state ---

export function getMarkingState(
  view: EditorView,
): MarkingPluginState | null {
  return (
    (markingPluginKey.getState(view.state) as MarkingPluginState) ?? null
  );
}

// --- Helper: Clear selection ---

export function clearMarkingSelection(view: EditorView): void {
  const pluginState = markingPluginKey.getState(
    view.state,
  ) as MarkingPluginState;
  if (pluginState) {
    view.dispatch(
      view.state.tr.setMeta(markingPluginKey, {
        ...pluginState,
        selectedRange: null,
        selectionLevel: null,
        decorations: DecorationSet.empty,
      }),
    );
  }
}

// --- Helper: Expand selection to a different level ---

export function expandMarkingSelection(
  view: EditorView,
  level: ExpandLevel,
  anchorPos: number,
  explicitRange?: { from: number; to: number },
): { from: number; to: number; text: string } | null {
  const doc = view.state.doc;
  const range = explicitRange ?? getRangeForLevel(level, doc, anchorPos);
  const text = doc.textBetween(range.from, range.to, ' ').trim();
  if (!text) return null;

  // Update editor selection
  const tr = view.state.tr.setSelection(
    TextSelection.create(doc, range.from, range.to),
  );

  // Set marking decoration
  const newState: MarkingPluginState = {
    selectionLevel: level,
    selectedRange: range,
    decorations: DecorationSet.empty,
  };
  newState.decorations = buildSelectionDecorations(newState, doc);
  tr.setMeta(markingPluginKey, newState);
  view.dispatch(tr);

  return { from: range.from, to: range.to, text };
}
