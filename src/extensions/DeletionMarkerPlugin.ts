import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useInspectStore } from '@/stores/useInspectStore';

// --- Plugin Key ---

const deletionMarkerPluginKey = new PluginKey('deletionMarker');

// --- Types ---

interface DeletionMarkerState {
  /** All tracked decorations (persisted even when inspect mode is off) */
  stored: DecorationSet;
  /** Whether decorations are currently visible */
  visible: boolean;
}

// --- Widget Factory ---

function createMarkerElement(deletedText: string, roundId: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'deletion-marker';
  span.setAttribute('data-round-id', roundId);
  const preview = deletedText.length > 60
    ? deletedText.slice(0, 60) + '...'
    : deletedText;
  span.title = `Deleted: "${preview}"`;
  return span;
}

// --- Extension ---

export const DeletionMarkerPlugin = Extension.create({
  name: 'deletionMarker',

  addProseMirrorPlugins() {
    const markType = this.editor.schema.marks.textState;

    return [
      new Plugin({
        key: deletionMarkerPluginKey,

        state: {
          init(): DeletionMarkerState {
            return {
              stored: DecorationSet.empty,
              visible: false,
            };
          },

          apply(tr, value, oldState): DeletionMarkerState {
            const { stored: storedDecorations, visible } = value;
            let stored = storedDecorations;

            // Map existing decorations through document changes
            if (tr.docChanged) {
              stored = stored.map(tr.mapping, tr.doc);
            }

            // Handle visibility toggle from store subscription
            const meta = tr.getMeta(deletionMarkerPluginKey);
            if (meta?.setVisible !== undefined) {
              return { stored, visible: meta.setVisible as boolean };
            }

            // Detect new deletions within AI-generated text
            if (tr.docChanged && !tr.getMeta('programmaticTextState') && !tr.getMeta('userTypedHandled')) {
              for (const step of tr.steps) {
                const map = step.getMap();
                map.forEach(
                  (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
                    const oldLen = oldEnd - oldStart;
                    const newLen = newEnd - newStart;
                    if (oldLen <= newLen) return; // not a net deletion

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

                    const widget = Decoration.widget(
                      newStart,
                      createMarkerElement(deletedText, aiRoundId),
                      {
                        side: -1,
                        ignoreSelection: true,
                        key: `del-${aiRoundId}-${Date.now()}`,
                      },
                    );
                    stored = stored.add(tr.doc, [widget]);
                  },
                );
              }
            }

            return { stored, visible };
          },
        },

        props: {
          decorations(state) {
            const pluginState = deletionMarkerPluginKey.getState(state) as
              | DeletionMarkerState
              | undefined;
            if (!pluginState?.visible) return DecorationSet.empty;
            return pluginState.stored;
          },
        },

        // Subscribe to inspect mode changes
        view(editorView: EditorView) {
          const unsubscribe = useInspectStore.subscribe((state, prevState) => {
            if (state.isInspectMode !== prevState.isInspectMode) {
              editorView.dispatch(
                editorView.state.tr.setMeta(deletionMarkerPluginKey, {
                  setVisible: state.isInspectMode,
                }),
              );
            }
          });

          return {
            update() {
              // No-op: decorations managed via plugin state
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
