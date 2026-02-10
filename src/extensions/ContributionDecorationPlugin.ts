import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';

// --- Plugin Key ---

const contributionDecorationPluginKey = new PluginKey('contributionDecoration');

// --- Types ---

export type ScoreAccessor = (roundId: string, dimension: 'd1' | 'd2' | 'd3') => number;

interface ContributionPluginState {
  isActive: boolean;
  scoreAccessor: ScoreAccessor | null;
  decorations: DecorationSet;
}

// --- Constants ---

const LEVEL_CLASSES: Record<number, string> = {
  1: 'contribution-level-1',
  2: 'contribution-level-2',
  3: 'contribution-level-3',
  4: 'contribution-level-4',
  5: 'contribution-level-5',
};

// --- Helpers ---

function scoreToLevel(score: number): number {
  if (score >= 0.80) return 5;
  if (score >= 0.60) return 4;
  if (score >= 0.40) return 3;
  if (score >= 0.20) return 2;
  return 1;
}

// --- Decoration Builder ---

function buildContributionDecorations(
  doc: ProseMirrorNode,
  scoreAccessor: ScoreAccessor,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText) return;

    const textStateMark = node.marks.find((m) => m.type.name === 'textState');
    const roundId: string | null | undefined = textStateMark?.attrs?.roundId;

    let level: number;

    if (!textStateMark || (textStateMark.attrs.state === 'user-written' && !roundId)) {
      level = 5;
    } else if (!roundId) {
      level = 5;
    } else {
      const roundNode = useContributionGraphStore.getState().getNode(roundId);
      const isAlternative = roundNode?.metadata.type === 'alternative';

      if (isAlternative) {
        decorations.push(
          Decoration.inline(pos, pos + node.nodeSize, {
            class: 'contribution-alternative',
          }),
        );
        return;
      }

      const d1 = scoreAccessor(roundId, 'd1');
      const d2 = scoreAccessor(roundId, 'd2');
      const d3 = scoreAccessor(roundId, 'd3');
      const composite = 0.35 * d1 + 0.40 * d2 + 0.25 * d3;
      level = scoreToLevel(composite);
    }

    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        class: LEVEL_CLASSES[level],
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

// --- Extension ---

export const ContributionDecorationPlugin = Extension.create({
  name: 'contributionDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: contributionDecorationPluginKey,

        state: {
          init(): ContributionPluginState {
            return {
              isActive: false,
              scoreAccessor: null,
              decorations: DecorationSet.empty,
            };
          },

          apply(tr, value: ContributionPluginState, _oldState, newState): ContributionPluginState {
            const meta = tr.getMeta(contributionDecorationPluginKey);

            if (meta) {
              const accessor = meta.scoreAccessor ?? value.scoreAccessor;

              if (meta.isActive === true) {
                return {
                  isActive: true,
                  scoreAccessor: accessor,
                  decorations: accessor
                    ? buildContributionDecorations(newState.doc, accessor)
                    : DecorationSet.empty,
                };
              }

              if (meta.isActive === false) {
                return {
                  isActive: false,
                  scoreAccessor: accessor,
                  decorations: DecorationSet.empty,
                };
              }

              if (meta.scoresUpdated === true && value.isActive) {
                const activeAccessor = accessor ?? value.scoreAccessor;
                return {
                  isActive: true,
                  scoreAccessor: activeAccessor,
                  decorations: activeAccessor
                    ? buildContributionDecorations(newState.doc, activeAccessor)
                    : DecorationSet.empty,
                };
              }
            }

            if (tr.docChanged && value.isActive) {
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
            const pluginState = contributionDecorationPluginKey.getState(state) as
              | ContributionPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// --- Helpers ---

export function updateContributionOverlay(
  editor: Editor,
  isActive: boolean,
  scoreAccessor?: ScoreAccessor,
): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(contributionDecorationPluginKey, {
      isActive,
      scoreAccessor,
    }),
  );
}

export function refreshContributionScores(
  editor: Editor,
  scoreAccessor: ScoreAccessor,
): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(contributionDecorationPluginKey, {
      scoresUpdated: true,
      scoreAccessor,
    }),
  );
}
