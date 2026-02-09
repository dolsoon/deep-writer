import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { TextState } from '@/types';
import { useRoundStore } from '@/stores/useRoundStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { computeD3Base } from '@/lib/scoring';
import { useInspectStore } from '@/stores/useInspectStore';

// --- Text State CSS Classes ---

const TEXT_STATE_CLASSES: Record<TextState, string> = {
  'user-written': '',
  'ai-generated': '',
  'ai-pending': '',
  'user-edited': '',
  'marked-preserve': '',
  'marked-delete': '',
  'original-removed':
    'bg-red-50 text-gray-400 dark:bg-red-500/10 dark:text-gray-500',
};

/**
 * Returns Tailwind CSS classes for the given text state.
 */
export function getTextStateClass(state: TextState): string {
  return TEXT_STATE_CLASSES[state] ?? '';
}

// --- TipTap Command Type Augmentation ---

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textState: {
      /**
       * Apply a text state mark to the current selection.
       */
      setTextState: (state: TextState, roundId?: string | null) => ReturnType;
      /**
       * Remove text state mark from the current selection.
       */
      unsetTextState: () => ReturnType;
      /**
       * Toggle a text state mark on the current selection.
       */
      toggleTextState: (state: TextState) => ReturnType;
    };
  }
}

// --- TextState Mark Extension ---

export const TextStateExtension = Mark.create({
  name: 'textState',

  addOptions() {
    return {
      // Disable automatic user-written mark fixing for preview/readonly editors
      disableAutoMarkFix: false,
    };
  },

  addAttributes() {
    return {
      state: {
        default: 'user-written',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-text-state') || 'user-written',
        renderHTML: (attributes: Record<string, unknown>) => {
          const state = attributes.state as TextState;
          return {
            'data-text-state': state,
            class: getTextStateClass(state),
          };
        },
      },
      roundId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-round-id') || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.roundId) return {};
          return { 'data-round-id': attributes.roundId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-text-state]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes ?? {}, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setTextState:
        (state: TextState, roundId?: string | null) =>
        ({ commands }) => {
          return commands.setMark(this.name, { state, roundId: roundId ?? null });
        },

      unsetTextState:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },

      toggleTextState:
        (state: TextState) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, { state });
        },
    };
  },

  addProseMirrorPlugins() {
    const markType = this.type;
    const disableAutoMarkFix = this.options.disableAutoMarkFix;

    // Debounce state: reuse the same inline-edit round for consecutive
    // keystrokes that edit text from the same parent roundId.
    let activeInlineEditRoundId: string | null = null;
    let activeInlineEditParentId: string | null = null;
    let inlineEditTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEditEnd: number = -1;
    let pendingDeleteDirection: 'backspace' | 'delete' | null = null;
    let lastActionWasDeletion = false;
    const INLINE_EDIT_DEBOUNCE_MS = 2000;

    function resetInlineEditState() {
      activeInlineEditRoundId = null;
      activeInlineEditParentId = null;
      inlineEditTimer = null;
      lastEditEnd = -1;
    }

    /**
     * If the text at `pos` in the given document carries an ai-generated
     * mark with a roundId, return that roundId. Otherwise return null.
     */
    function getAiRoundIdFromDoc(doc: import('@tiptap/pm/model').Node, pos: number): string | null {
      if (pos < 0 || pos >= doc.content.size) return null;
      const resolved = doc.resolve(pos);
      const parent = resolved.parent;
      if (!parent.isTextblock) return null;

      let offset = 0;
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        const childFrom = offset;
        const childTo = childFrom + child.nodeSize;
        if (childFrom <= resolved.parentOffset && resolved.parentOffset < childTo && child.isText) {
          const tsm = child.marks.find((m) => m.type === markType);
          if (tsm && tsm.attrs.state === 'ai-generated' && tsm.attrs.roundId) {
            return tsm.attrs.roundId as string;
          }
        }
        offset += child.nodeSize;
      }
      return null;
    }

    function getAiRoundIdAt(view: import('@tiptap/pm/view').EditorView, pos: number): string | null {
      return getAiRoundIdFromDoc(view.state.doc, pos);
    }

    /**
     * Get or create an inline-edit round for the given parent roundId.
     * Consecutive keystrokes within the debounce window reuse the same round.
     */
    function getOrCreateInlineEditRound(parentRoundId: string): string {
      if (activeInlineEditRoundId && activeInlineEditParentId === parentRoundId) {
        // Reset the debounce timer
        if (inlineEditTimer) clearTimeout(inlineEditTimer);
        inlineEditTimer = setTimeout(resetInlineEditState, INLINE_EDIT_DEBOUNCE_MS);
        return activeInlineEditRoundId;
      }

      // Create a new inline-edit round
      const round = useRoundStore.getState().createRound({
        type: 'inline-edit',
        parentRounds: [parentRoundId],
        prompt: null,
        promptLength: 0,
        constraintCount: 0,
        constraintTypes: [],
        generationMode: 'inline-edit',
        diffActions: { accepted: 0, rejected: 0, edited: 1 },
        events: [],
      });

      // Add graph node with edges inheriting concept from parent
      useContributionGraphStore.getState().addNode(
        round.roundId,
        { d1: 1.0, d2: 0.0, d3: computeD3Base('edited') },
        { prompt: null, constraints: [], action: 'edited', type: 'inline-edit' },
      );

      // Add edges: D2 (concept) inherited from parent with high strength
      const node = useContributionGraphStore.getState().getNode(round.roundId);
      if (node) {
        node.edges.push(
          { to: parentRoundId, dimension: 'd2', strength: 0.8, reason: 'concept inherited from AI generation' },
        );
      }

      activeInlineEditRoundId = round.roundId;
      activeInlineEditParentId = parentRoundId;
      if (inlineEditTimer) clearTimeout(inlineEditTimer);
      inlineEditTimer = setTimeout(resetInlineEditState, INLINE_EDIT_DEBOUNCE_MS);

      return round.roundId;
    }

    return [
      new Plugin({
        key: new PluginKey('textStateInput'),

        // Flush debounce when entering inspect mode so the current
        // inline-edit round is finalized before LLM analysis runs.
        view() {
          const unsubscribe = useInspectStore.subscribe((state, prev) => {
            if (state.isInspectMode && !prev.isInspectMode && inlineEditTimer) {
              clearTimeout(inlineEditTimer);
              resetInlineEditState();
            }
          });
          return { destroy: unsubscribe };
        },

        props: {
          /**
           * Track Backspace/Delete direction for edit trace coalescing.
           */
          handleKeyDown(_view, event) {
            if (event.key === 'Backspace') {
              pendingDeleteDirection = 'backspace';
            } else if (event.key === 'Delete') {
              pendingDeleteDirection = 'delete';
            }
            return false;
          },

          /**
           * Intercept keyboard text input to ensure user-typed text always
           * gets 'user-written' mark. When editing within AI-generated text,
           * creates an inline-edit round linked to the parent AI round via
           * graph edges, preserving concept-level contribution tracking.
           */
          handleTextInput(view, from, to, text) {
            // Check if we're editing within AI-generated text
            const parentRoundId = getAiRoundIdAt(view, from);

            let roundId: string | null = null;
            if (parentRoundId) {
              const isNewRound = !activeInlineEditRoundId || activeInlineEditParentId !== parentRoundId;
              roundId = getOrCreateInlineEditRound(parentRoundId);

              const replacedText = view.state.doc.textBetween(from, to);
              const store = useRoundStore.getState();

              if (isNewRound) {
                // First edit: capture original text being replaced
                if (replacedText.length > 0 || text.length > 0) {
                  store.appendEditTrace(roundId, { original: replacedText, replacement: text });
                }
                lastEditEnd = from + text.length;
              } else if (from === lastEditEnd && replacedText === '') {
                // Typing at end of previous replacement — extend it
                store.extendLastEditTrace(roundId, text);
                lastEditEnd = from + text.length;
              } else {
                // New edit position within same round — new trace entry
                if (replacedText.length > 0 || text.length > 0) {
                  store.appendEditTrace(roundId, { original: replacedText, replacement: text });
                }
                lastEditEnd = from + text.length;
              }
            }

            const userMark = markType.create({
              state: 'user-written',
              roundId,
            });

            const { tr } = view.state;
            tr.insertText(text, from, to);

            // Override any inherited mark on the inserted range
            const insertEnd = from + text.length;
            tr.removeMark(from, insertEnd, markType);
            tr.addMark(from, insertEnd, userMark);

            lastActionWasDeletion = false;
            tr.setMeta('userTypedHandled', true);
            view.dispatch(tr);
            return true;
          },
        },

        /**
         * Safety net for IME/composition input that bypasses handleTextInput.
         * Also detects deletions within AI-generated text (Backspace, Delete,
         * Ctrl+Backspace, Cut, etc.) and records edit traces.
         */
        appendTransaction(transactions, oldState, newState) {
          // Skip all tracking for preview/readonly editors
          if (disableAutoMarkFix) return null;

          // --- Deletion detection: record edit traces for AI text removals ---
          for (const transaction of transactions) {
            if (!transaction.docChanged) continue;
            if (transaction.getMeta('programmaticTextState')) continue;
            if (transaction.getMeta('userTypedHandled')) continue;

            for (const step of transaction.steps) {
              const map = step.getMap();
              map.forEach(
                (oldStart: number, oldEnd: number, _newStart: number, _newEnd: number) => {
                  const oldLen = oldEnd - oldStart;
                  const newLen = _newEnd - _newStart;
                  if (oldLen === 0 || newLen >= oldLen) return; // not a net deletion

                  const deletedText = oldState.doc.textBetween(oldStart, oldEnd);
                  if (!deletedText) return;

                  // Check if deleted region had AI marks
                  let aiRoundId: string | null = null;
                  oldState.doc.nodesBetween(oldStart, oldEnd, (node) => {
                    if (!node.isText || aiRoundId) return;
                    const tsm = node.marks.find((m) => m.type === markType);
                    if (tsm && tsm.attrs.state === 'ai-generated' && tsm.attrs.roundId) {
                      aiRoundId = tsm.attrs.roundId as string;
                    }
                  });

                  if (!aiRoundId) return;

                  const isNewRound = !activeInlineEditRoundId || activeInlineEditParentId !== aiRoundId;
                  const roundId = getOrCreateInlineEditRound(aiRoundId);
                  const store = useRoundStore.getState();
                  const insertedText = newLen > 0 ? newState.doc.textBetween(_newStart, _newEnd) : '';
                  const isSingleChar = oldLen - newLen === 1;

                  if (isNewRound || !lastActionWasDeletion || !isSingleChar) {
                    // New round, first deletion, or multi-char (selection/word delete)
                    store.appendEditTrace(roundId, { original: deletedText, replacement: insertedText });
                  } else if (pendingDeleteDirection === 'backspace') {
                    // Consecutive backspace: prepend to last trace's original
                    store.prependLastEditTraceOriginal(roundId, deletedText);
                  } else {
                    // Consecutive delete or unknown: append to last trace's original
                    store.appendLastEditTraceOriginal(roundId, deletedText);
                  }

                  lastEditEnd = _newStart;
                  lastActionWasDeletion = true;
                  pendingDeleteDirection = null;
                },
              );
            }
          }

          // --- Mark fix: ensure user-typed text gets 'user-written' mark ---
          // Skip if disabled (for preview/readonly editors)
          if (disableAutoMarkFix) return null;

          let needsFix = false;

          for (const transaction of transactions) {
            if (!transaction.docChanged) continue;
            if (transaction.getMeta('programmaticTextState')) continue;
            if (transaction.getMeta('userTypedHandled')) continue;

            for (const step of transaction.steps) {
              const map = step.getMap();
              map.forEach(
                (_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
                  if (newEnd <= newStart) return;
                  newState.doc.nodesBetween(newStart, newEnd, (node) => {
                    if (!node.isText) return;
                    const tsm = node.marks.find((m) => m.type === markType);
                    if (tsm && tsm.attrs.state !== 'user-written') {
                      needsFix = true;
                    }
                  });
                },
              );
            }
          }

          if (!needsFix) return null;

          const tr = newState.tr;
          for (const transaction of transactions) {
            if (!transaction.docChanged) continue;
            if (transaction.getMeta('programmaticTextState')) continue;
            if (transaction.getMeta('userTypedHandled')) continue;

            for (const step of transaction.steps) {
              const map = step.getMap();
              map.forEach(
                (_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
                  if (newEnd <= newStart) return;
                  newState.doc.nodesBetween(newStart, newEnd, (node, pos) => {
                    if (!node.isText) return;
                    const tsm = node.marks.find((m) => m.type === markType);
                    if (tsm && tsm.attrs.state !== 'user-written') {
                      const nodeFrom = Math.max(pos, newStart);
                      const nodeTo = Math.min(pos + node.nodeSize, newEnd);
                      tr.removeMark(nodeFrom, nodeTo, markType);
                      tr.addMark(
                        nodeFrom,
                        nodeTo,
                        markType.create({ state: 'user-written', roundId: null }),
                      );
                    }
                  });
                },
              );
            }
          }

          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});
