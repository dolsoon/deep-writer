import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ContributionLevel } from '@/types/contribution';
import { useInspectStore } from '@/stores/useInspectStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { computeCompositeScore, scoreToLevel } from '@/lib/scoring';

// --- Plugin Key ---

export const inspectClickPluginKey = new PluginKey('inspectClick');

// --- Types ---

interface InspectClickPluginState {
  decorations: DecorationSet;
  highlightFrom: number | null;
  highlightTo: number | null;
  highlightLevel: ContributionLevel | null;
}

// --- Level Colors for Highlight Ring ---

const LEVEL_COLORS: Record<ContributionLevel, string> = {
  1: 'rgba(235, 120, 105, 0.6)',
  2: 'rgba(240, 142, 88, 0.55)',
  3: 'rgba(242, 162, 72, 0.55)',
  4: 'rgba(238, 180, 58, 0.55)',
  5: 'rgba(230, 195, 50, 0.6)',
};

// --- Helpers ---

/**
 * Find the contiguous range of text nodes sharing the same roundId
 * within the same parent block node. Returns the absolute from/to
 * positions in the document.
 */
function findContiguousMarkRange(
  doc: ProseMirrorNode,
  pos: number,
  targetRoundId: string | null,
): { from: number; to: number } | null {
  const resolved = doc.resolve(pos);
  const parent = resolved.parent;

  if (!parent.isTextblock) return null;

  // Absolute offset of the parent's content start
  const parentStart = resolved.start();

  let rangeFrom: number | null = null;
  let rangeTo: number | null = null;
  let insideTarget = false;

  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentStart + offset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText) {
      const textStateMark = child.marks.find(
        (m) => m.type.name === 'textState',
      );
      const childRoundId: string | null =
        textStateMark?.attrs?.roundId ?? null;

      if (childRoundId === targetRoundId) {
        if (!insideTarget) {
          // Check if the clicked position falls within or after this child
          // We need to start tracking only if this run includes the click pos
          insideTarget = true;
          rangeFrom = childFrom;
        }
        rangeTo = childTo;
      } else if (insideTarget) {
        // The contiguous run ended. Check if it includes the clicked position.
        if (rangeFrom !== null && rangeTo !== null && pos >= rangeFrom && pos <= rangeTo) {
          return { from: rangeFrom, to: rangeTo };
        }
        // Reset and keep scanning for another run that might contain pos
        insideTarget = false;
        rangeFrom = null;
        rangeTo = null;
      }
    } else {
      // Non-text node breaks any contiguous run
      if (insideTarget) {
        if (rangeFrom !== null && rangeTo !== null && pos >= rangeFrom && pos <= rangeTo) {
          return { from: rangeFrom, to: rangeTo };
        }
        insideTarget = false;
        rangeFrom = null;
        rangeTo = null;
      }
    }

    offset += child.nodeSize;
  }

  // Check if the final run includes the clicked position
  if (rangeFrom !== null && rangeTo !== null && pos >= rangeFrom && pos <= rangeTo) {
    return { from: rangeFrom, to: rangeTo };
  }

  return null;
}

/**
 * Compute contribution scores for a given roundId.
 * For user-written text with no roundId, returns max scores (d1=1, d2=1, d3=1).
 */
function computeScoresForRound(roundId: string | null): {
  concept: number;
  wording: number;
  evaluation: number;
  composite: number;
  level: ContributionLevel;
} {
  if (!roundId) {
    // User-written text: full contribution
    const composite = computeCompositeScore(1, 1, 1);
    return {
      concept: 1,
      wording: 1,
      evaluation: 1,
      composite,
      level: scoreToLevel(composite),
    };
  }

  const graphStore = useContributionGraphStore.getState();
  const d1 = graphStore.accumulatedScore(roundId, 'd1');
  const d2 = graphStore.accumulatedScore(roundId, 'd2');
  const d3 = graphStore.accumulatedScore(roundId, 'd3');
  const composite = computeCompositeScore(d1, d2, d3);

  return {
    concept: d2,
    wording: d1,
    evaluation: d3,
    composite,
    level: scoreToLevel(composite),
  };
}

/**
 * Build a DecorationSet with a single inline highlight ring decoration.
 */
function buildHighlightDecoration(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  level: ContributionLevel,
): DecorationSet {
  if (from >= to || from < 0 || to > doc.content.size) {
    return DecorationSet.empty;
  }

  const color = LEVEL_COLORS[level];
  const decoration = Decoration.inline(from, to, {
    style: `outline: 2px solid ${color}; outline-offset: 1px; border-radius: 3px;`,
    class: 'inspect-highlight-ring',
  });

  return DecorationSet.create(doc, [decoration]);
}

// --- Initial State ---

function getInitialState(): InspectClickPluginState {
  return {
    decorations: DecorationSet.empty,
    highlightFrom: null,
    highlightTo: null,
    highlightLevel: null,
  };
}

// --- Extension ---

export const InspectClickPlugin = Extension.create({
  name: 'inspectClick',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: inspectClickPluginKey,

        state: {
          init(): InspectClickPluginState {
            return getInitialState();
          },

          apply(
            tr: Transaction,
            value: InspectClickPluginState,
            _oldState: EditorState,
            newState: EditorState,
          ): InspectClickPluginState {
            // Check for explicit state update via meta
            const meta = tr.getMeta(inspectClickPluginKey);
            if (meta) {
              if (meta.clear) {
                return getInitialState();
              }

              if (
                meta.highlightFrom != null &&
                meta.highlightTo != null &&
                meta.highlightLevel != null
              ) {
                return {
                  highlightFrom: meta.highlightFrom,
                  highlightTo: meta.highlightTo,
                  highlightLevel: meta.highlightLevel,
                  decorations: buildHighlightDecoration(
                    newState.doc,
                    meta.highlightFrom,
                    meta.highlightTo,
                    meta.highlightLevel,
                  ),
                };
              }
            }

            // Map decorations through document changes
            if (tr.docChanged && value.highlightFrom !== null) {
              const mappedFrom = tr.mapping.map(value.highlightFrom);
              const mappedTo = tr.mapping.map(value.highlightTo!);

              if (mappedFrom >= mappedTo) {
                return getInitialState();
              }

              return {
                ...value,
                highlightFrom: mappedFrom,
                highlightTo: mappedTo,
                decorations: value.decorations.map(tr.mapping, tr.doc),
              };
            }

            return value;
          },
        },

        props: {
          decorations(state: EditorState): DecorationSet {
            const pluginState = inspectClickPluginKey.getState(state) as
              | InspectClickPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },

          handleClick(
            view: EditorView,
            pos: number,
            event: MouseEvent,
          ): boolean {
            const inspectState = useInspectStore.getState();

            // When inspect mode is OFF, do nothing
            if (!inspectState.isInspectMode) {
              return false;
            }

            // Only handle left clicks
            if (event.button !== 0) {
              return true;
            }

            const { doc } = view.state;

            // Resolve the clicked position
            const resolved = doc.resolve(pos);
            const parent = resolved.parent;

            // Find the text node at the clicked position
            if (!parent.isTextblock) {
              useInspectStore.getState().clearSelectedSegment();
              view.dispatch(
                view.state.tr.setMeta(inspectClickPluginKey, { clear: true }),
              );
              return true;
            }

            // Find the inline node at the offset within the parent
            const offset = resolved.parentOffset;
            let childOffset = 0;
            let targetNode: ProseMirrorNode | null = null;

            for (let i = 0; i < parent.childCount; i++) {
              const child = parent.child(i);
              if (
                childOffset <= offset &&
                offset < childOffset + child.nodeSize
              ) {
                targetNode = child;
                break;
              }
              childOffset += child.nodeSize;
            }

            // Click on empty area or non-text node
            if (!targetNode || !targetNode.isText) {
              useInspectStore.getState().clearSelectedSegment();
              view.dispatch(
                view.state.tr.setMeta(inspectClickPluginKey, { clear: true }),
              );
              return true;
            }

            // Check for textState mark
            const textStateMark = targetNode.marks.find(
              (m) => m.type.name === 'textState',
            );

            if (!textStateMark) {
              // Undecorated text: clear selection
              useInspectStore.getState().clearSelectedSegment();
              view.dispatch(
                view.state.tr.setMeta(inspectClickPluginKey, { clear: true }),
              );
              return true;
            }

            // Read mark attributes
            const roundId: string | null =
              textStateMark.attrs.roundId ?? null;

            // Find full contiguous range with same roundId
            const range = findContiguousMarkRange(doc, pos, roundId);

            if (!range) {
              useInspectStore.getState().clearSelectedSegment();
              view.dispatch(
                view.state.tr.setMeta(inspectClickPluginKey, { clear: true }),
              );
              return true;
            }

            // Extract text
            const text = doc.textBetween(range.from, range.to, '', '');

            // Compute scores
            const scores = computeScoresForRound(roundId);

            // Update inspect store
            useInspectStore.getState().setSelectedSegment({
              text,
              position: { from: range.from, to: range.to },
              roundId,
              scores: {
                composite: scores.composite,
                concept: scores.concept,
                wording: scores.wording,
                evaluation: scores.evaluation,
              },
              level: scores.level,
            });

            // Apply highlight decoration
            view.dispatch(
              view.state.tr.setMeta(inspectClickPluginKey, {
                highlightFrom: range.from,
                highlightTo: range.to,
                highlightLevel: scores.level,
              }),
            );

            return true;
          },
        },

        // Use view lifecycle to subscribe to store changes
        view(editorView: EditorView) {
          const unsubscribe = useInspectStore.subscribe((state, prevState) => {
            // When selectedSegment is cleared externally, remove decoration
            if (prevState.selectedSegment && !state.selectedSegment) {
              editorView.dispatch(
                editorView.state.tr.setMeta(inspectClickPluginKey, {
                  clear: true,
                }),
              );
            }

            // When inspect mode is turned off, clear everything
            if (prevState.isInspectMode && !state.isInspectMode) {
              editorView.dispatch(
                editorView.state.tr.setMeta(inspectClickPluginKey, {
                  clear: true,
                }),
              );
            }
          });

          return {
            update() {
              // No-op: decorations are managed via transactions
            },
            destroy() {
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
