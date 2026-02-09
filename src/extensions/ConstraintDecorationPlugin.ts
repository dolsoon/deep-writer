import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Constraint, ConstraintType } from '@/stores/useConstraintStore';

// --- Plugin Key ---

const constraintDecorationPluginKey = new PluginKey('constraintDecoration');

// --- Constants ---

const TYPE_TO_CLASS: Record<ConstraintType, string> = {
  positive: 'constraint-highlight-positive',
  keep: 'constraint-highlight-keep',
  negative: 'constraint-highlight-negative',
  delete: 'constraint-highlight-delete',
  context: 'constraint-highlight-context',
};

// --- Decoration Builder ---

function buildDecorations(
  constraints: Constraint[],
  doc: ProseMirrorNode,
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const c of constraints) {
    const from = c.from;
    const to = c.to;

    if (from < 0 || to > doc.content.size || from >= to) continue;

    decorations.push(
      Decoration.inline(from, to, {
        class: TYPE_TO_CLASS[c.type],
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

// --- Extension ---

export const ConstraintDecorationPlugin = Extension.create({
  name: 'constraintDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: constraintDecorationPluginKey,

        state: {
          init() {
            return {
              constraints: [] as Constraint[],
              decorations: DecorationSet.empty,
            };
          },

          apply(tr, value, _oldState, newState) {
            const update = tr.getMeta(constraintDecorationPluginKey);
            if (update) {
              return {
                constraints: update.constraints,
                decorations: buildDecorations(update.constraints, newState.doc),
              };
            }

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
            const pluginState = constraintDecorationPluginKey.getState(state) as
              | { decorations: DecorationSet }
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// --- Helper: Push constraints into the plugin ---

export function updateConstraintDecorations(
  editor: Editor,
  constraints: Constraint[],
): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(constraintDecorationPluginKey, { constraints }),
  );
}
