import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TextState, EventType } from '@/types';
import {
  getWordBoundary,
  getPhraseBoundary,
  getSentenceBoundary,
} from '@/lib/boundaries';
import type { TextRange } from '@/lib/boundaries';

// --- Types ---

export type SelectionLevel = 'word' | 'phrase' | 'sentence';

export interface MarkingExtensionOptions {
  onProvenanceEvent?: (
    type: EventType,
    data: Record<string, unknown>,
  ) => void;
}

interface MarkingPluginState {
  clickCount: number;
  lastClickRegion: TextRange | null;
  selectionLevel: SelectionLevel | null;
  selectedRange: TextRange | null;
  editModeActive: boolean;
  editModeSegment: TextRange | null;
  editModeOriginalText: string | null;
  decorations: DecorationSet;
}

// --- Constants ---

const markingPluginKey = new PluginKey('marking');

const SELECTION_CLASSES: Record<SelectionLevel, string> = {
  word: 'marking-selection-word',
  phrase: 'marking-selection-phrase',
  sentence: 'marking-selection-sentence',
};

const EDIT_MODE_CLASS = 'marking-edit-mode';

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
          class: SELECTION_CLASSES[state.selectionLevel],
        }),
      );
    }
  }

  if (state.editModeActive && state.editModeSegment) {
    const { from, to } = state.editModeSegment;
    if (from >= 0 && to <= doc.content.size && from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: EDIT_MODE_CLASS,
        }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

// --- Helpers ---

function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.from < b.to && b.from < a.to;
}

function getTextStateAtPos(
  view: EditorView,
  pos: number,
): TextState | null {
  const resolvedPos = view.state.doc.resolve(pos);
  const marks = resolvedPos.marks();
  for (const mark of marks) {
    if (mark.type.name === 'textState') {
      return mark.attrs.state as TextState;
    }
  }
  return null;
}

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
    };
  },

  addProseMirrorPlugins() {
    const { onProvenanceEvent } = this.options;

    // Debounce timer for single-click vs double-click disambiguation
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingClick: { view: EditorView; pos: number } | null = null;

    const emitProvenance = (
      type: EventType,
      data: Record<string, unknown>,
    ) => {
      onProvenanceEvent?.(type, data);
    };

    function clearPendingClick() {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      pendingClick = null;
    }

    function getInitialState(): MarkingPluginState {
      return {
        clickCount: 0,
        lastClickRegion: null,
        selectionLevel: null,
        selectedRange: null,
        editModeActive: false,
        editModeSegment: null,
        editModeOriginalText: null,
        decorations: DecorationSet.empty,
      };
    }

    function applyToggle(
      view: EditorView,
      from: number,
      to: number,
      level: SelectionLevel,
    ) {
      const { state } = view;
      const doc = state.doc;
      const text = doc.textBetween(from, to, '', '');

      // Check existing text state in the range
      const currentState = getTextStateAtPos(view, from);

      const { tr } = state;
      const markType = state.schema.marks.textState;
      if (!markType) return;

      if (currentState === 'marked-delete') {
        // Toggle back to unmarked - remove the mark
        tr.removeMark(from, to, markType);
        emitProvenance('mark-applied', {
          action: 'unmark',
          text,
          position: from,
          granularity: level,
        });
      } else if (currentState === 'marked-preserve') {
        // Toggle preserved to deleted
        tr.removeMark(from, to, markType);
        tr.addMark(from, to, markType.create({ state: 'marked-delete' }));
        emitProvenance('mark-applied', {
          action: 'delete',
          text,
          position: from,
          granularity: level,
        });
      } else {
        // Unmarked or other -> mark as deleted
        tr.addMark(from, to, markType.create({ state: 'marked-delete' }));
        emitProvenance('mark-applied', {
          action: 'delete',
          text,
          position: from,
          granularity: level,
        });
      }

      view.dispatch(tr);
    }

    function exitEditMode(
      view: EditorView,
      pluginState: MarkingPluginState,
    ) {
      if (!pluginState.editModeActive || !pluginState.editModeSegment) return;

      const { from, to } = pluginState.editModeSegment;
      const currentText = view.state.doc.textBetween(from, to, '', '');
      const originalText = pluginState.editModeOriginalText ?? '';

      // If text was modified, mark as user-edited
      if (currentText !== originalText) {
        const markType = view.state.schema.marks.textState;
        if (markType) {
          const { tr } = view.state;
          tr.addMark(from, to, markType.create({ state: 'user-edited' }));
          view.dispatch(tr);
        }
        emitProvenance('edit-in-place', {
          original: originalText,
          new: currentText,
          position: from,
        });
      }

      // Reset edit mode in plugin state
      view.dispatch(
        view.state.tr.setMeta(markingPluginKey, {
          ...pluginState,
          editModeActive: false,
          editModeSegment: null,
          editModeOriginalText: null,
        }),
      );
    }

    function processClick(view: EditorView, pos: number) {
      const { state } = view;
      const doc = state.doc;
      const pluginState = markingPluginKey.getState(state) as MarkingPluginState;

      // Check if click is in an active diff region - skip marking
      if (hasActiveDiffAtPos(view, pos)) return;

      // If in edit mode and clicking outside the edit segment, exit edit mode
      if (pluginState.editModeActive && pluginState.editModeSegment) {
        const { from, to } = pluginState.editModeSegment;
        if (pos < from || pos >= to) {
          exitEditMode(view, pluginState);
        } else {
          return; // Click inside edit segment, let native editing handle it
        }
      }

      // Progressive granularity logic
      const wordRange = getWordBoundary(doc, pos);

      let newClickCount: number;
      if (
        pluginState.lastClickRegion &&
        rangesOverlap(wordRange, pluginState.lastClickRegion)
      ) {
        newClickCount = Math.min(pluginState.clickCount + 1, 3);
      } else {
        newClickCount = 1;
      }

      // Determine selection based on click count
      let selectedRange: TextRange;
      let level: SelectionLevel;

      switch (newClickCount) {
        case 1:
          selectedRange = getWordBoundary(doc, pos);
          level = 'word';
          break;
        case 2:
          selectedRange = getPhraseBoundary(doc, pos);
          level = 'phrase';
          break;
        case 3:
          selectedRange = getSentenceBoundary(doc, pos);
          level = 'sentence';
          break;
        default:
          selectedRange = getSentenceBoundary(doc, pos);
          level = 'sentence';
      }

      // If clicking again at max level (3+), toggle the mark
      if (
        pluginState.clickCount >= 3 &&
        pluginState.lastClickRegion &&
        rangesOverlap(wordRange, pluginState.lastClickRegion)
      ) {
        applyToggle(view, selectedRange.from, selectedRange.to, level);
      }

      // On second click at same level, toggle the mark
      if (
        newClickCount > 1 &&
        pluginState.selectedRange &&
        pluginState.selectionLevel === level
      ) {
        // Already at this level and clicking again - means we've expanded, not toggling
        // Toggle happens when re-clicking at max level (handled above)
      }

      // Update plugin state
      const newState: MarkingPluginState = {
        ...pluginState,
        clickCount: newClickCount,
        lastClickRegion: selectedRange,
        selectionLevel: level,
        selectedRange,
        decorations: DecorationSet.empty, // will be rebuilt
      };
      newState.decorations = buildSelectionDecorations(newState, doc);

      view.dispatch(view.state.tr.setMeta(markingPluginKey, newState));

      // If first click (word level), also apply toggle
      if (newClickCount === 1) {
        applyToggle(view, selectedRange.from, selectedRange.to, level);
      }
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

        props: {
          decorations(state) {
            const pluginState = markingPluginKey.getState(state) as
              | MarkingPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },

          handleClick(view, pos, event) {
            // Ignore right-clicks
            if (event.button !== 0) return false;

            // Don't handle if editor is not editable
            if (!view.editable) return false;

            clearPendingClick();

            // Debounce to distinguish from double-click
            pendingClick = { view, pos };
            clickTimer = setTimeout(() => {
              if (pendingClick) {
                processClick(pendingClick.view, pendingClick.pos);
                pendingClick = null;
              }
            }, 200);

            return true;
          },

          handleDoubleClick(view, pos) {
            // Cancel any pending single click
            clearPendingClick();

            if (!view.editable) return false;

            // Check if in diff region
            if (hasActiveDiffAtPos(view, pos)) return false;

            const pluginState = markingPluginKey.getState(view.state) as MarkingPluginState;

            // Expand to sentence for a useful edit region
            const sentenceRange = getSentenceBoundary(view.state.doc, pos);
            const editRange = sentenceRange;
            const originalText = view.state.doc.textBetween(
              editRange.from,
              editRange.to,
              '',
              '',
            );

            const newState: MarkingPluginState = {
              ...pluginState,
              editModeActive: true,
              editModeSegment: editRange,
              editModeOriginalText: originalText,
              selectedRange: null,
              selectionLevel: null,
              clickCount: 0,
              lastClickRegion: null,
            };
            newState.decorations = buildSelectionDecorations(
              newState,
              view.state.doc,
            );

            view.dispatch(
              view.state.tr.setMeta(markingPluginKey, newState),
            );

            // Place cursor at click position for native editing
            const tr = view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(pos)),
            );
            view.dispatch(tr);

            return true;
          },

          handleKeyDown(view, event) {
            const pluginState = markingPluginKey.getState(view.state) as MarkingPluginState;

            if (event.key === 'Escape' && pluginState.editModeActive) {
              exitEditMode(view, pluginState);
              return true;
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

// --- Helper: Exit edit mode programmatically ---

export function forceExitEditMode(view: EditorView): void {
  const pluginState = markingPluginKey.getState(
    view.state,
  ) as MarkingPluginState;
  if (pluginState?.editModeActive) {
    const { editModeSegment, editModeOriginalText } = pluginState;
    if (editModeSegment) {
      const currentText = view.state.doc.textBetween(
        editModeSegment.from,
        editModeSegment.to,
        '',
        '',
      );
      if (currentText !== (editModeOriginalText ?? '')) {
        const markType = view.state.schema.marks.textState;
        if (markType) {
          const { tr } = view.state;
          tr.addMark(
            editModeSegment.from,
            editModeSegment.to,
            markType.create({ state: 'user-edited' }),
          );
          view.dispatch(tr);
        }
      }
    }
    view.dispatch(
      view.state.tr.setMeta(markingPluginKey, {
        ...pluginState,
        editModeActive: false,
        editModeSegment: null,
        editModeOriginalText: null,
        selectedRange: null,
        selectionLevel: null,
        clickCount: 0,
        lastClickRegion: null,
        decorations: DecorationSet.empty,
      }),
    );
  }
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
        clickCount: 0,
        lastClickRegion: null,
        decorations: DecorationSet.empty,
      }),
    );
  }
}
