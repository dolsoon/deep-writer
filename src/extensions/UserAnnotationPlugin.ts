import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// --- Plugin Key ---

const userAnnotationPluginKey = new PluginKey('userAnnotation');

// --- Types ---

export interface AnnotationRange {
  from: number;
  to: number;
  level: number; // 1 | 2 | 3
}

interface AnnotationPluginState {
  isActive: boolean;
  tool: 'highlight' | 'eraser';
  level: number;
  ranges: AnnotationRange[];
  decorations: DecorationSet;
  isPainting: boolean;
  paintStart: number | null;
  paintEnd: number | null;
}

// --- Constants ---

const ANNOTATION_CLASSES: Record<number, string> = {
  1: 'user-annotation-1',
  2: 'user-annotation-2',
  3: 'user-annotation-3',
};

const PREVIEW_CLASS_HIGHLIGHT = 'user-annotation-preview';
const PREVIEW_CLASS_ERASER = 'user-annotation-eraser-preview';

// --- Helpers ---

function posFromEvent(view: EditorView, event: MouseEvent): number | null {
  const coords = { left: event.clientX, top: event.clientY };
  const pos = view.posAtCoords(coords);
  return pos ? pos.pos : null;
}

function buildDecorations(
  doc: import('@tiptap/pm/model').Node,
  ranges: AnnotationRange[],
): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    ranges.map((r) =>
      Decoration.inline(r.from, r.to, {
        class: ANNOTATION_CLASSES[r.level] ?? ANNOTATION_CLASSES[3],
      }),
    ),
  );
}

function buildPreviewDecoration(
  paintStart: number,
  paintEnd: number,
  tool: 'highlight' | 'eraser',
): Decoration[] {
  const from = Math.min(paintStart, paintEnd);
  const to = Math.max(paintStart, paintEnd);
  if (from >= to) return [];
  return [
    Decoration.inline(from, to, {
      class: tool === 'highlight' ? PREVIEW_CLASS_HIGHLIGHT : PREVIEW_CLASS_ERASER,
    }),
  ];
}

// --- Range Logic ---
// Paint sets the level directly on the range (overwrites, no stacking).

function applyAnnotation(
  existing: AnnotationRange[],
  newFrom: number,
  newTo: number,
  level: number,
): AnnotationRange[] {
  if (newFrom >= newTo) return existing;

  const result: AnnotationRange[] = [];

  for (const r of existing) {
    // No overlap -- keep as is
    if (r.to <= newFrom || r.from >= newTo) {
      result.push(r);
      continue;
    }
    // Partial overlap -- keep non-overlapping parts
    if (r.from < newFrom) {
      result.push({ from: r.from, to: newFrom, level: r.level });
    }
    if (r.to > newTo) {
      result.push({ from: newTo, to: r.to, level: r.level });
    }
  }

  // Add the new range with the selected level
  result.push({ from: newFrom, to: newTo, level });

  return consolidateRanges(result);
}

function removeAnnotation(
  existing: AnnotationRange[],
  eraseFrom: number,
  eraseTo: number,
): AnnotationRange[] {
  if (eraseFrom >= eraseTo) return existing;

  const result: AnnotationRange[] = [];

  for (const r of existing) {
    if (r.to <= eraseFrom || r.from >= eraseTo) {
      result.push(r);
      continue;
    }
    if (r.from < eraseFrom) {
      result.push({ from: r.from, to: eraseFrom, level: r.level });
    }
    if (r.to > eraseTo) {
      result.push({ from: eraseTo, to: r.to, level: r.level });
    }
  }

  return consolidateRanges(result);
}

function consolidateRanges(ranges: AnnotationRange[]): AnnotationRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: AnnotationRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.from <= last.to && curr.level === last.level) {
      last.to = Math.max(last.to, curr.to);
    } else {
      merged.push(curr);
    }
  }

  return merged.filter((r) => r.from < r.to);
}

function mapRanges(
  ranges: AnnotationRange[],
  mapping: { map: (pos: number, bias?: number) => number },
): AnnotationRange[] {
  const mapped: AnnotationRange[] = [];
  for (const r of ranges) {
    const from = mapping.map(r.from, 1);
    const to = mapping.map(r.to, -1);
    if (from < to) {
      mapped.push({ from, to, level: r.level });
    }
  }
  return mapped;
}

// --- Extension ---

export const UserAnnotationPlugin = Extension.create({
  name: 'userAnnotation',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: userAnnotationPluginKey,

        state: {
          init(): AnnotationPluginState {
            return {
              isActive: false,
              tool: 'highlight',
              level: 2,
              ranges: [],
              decorations: DecorationSet.empty,
              isPainting: false,
              paintStart: null,
              paintEnd: null,
            };
          },

          apply(tr, value: AnnotationPluginState, _oldState, newState): AnnotationPluginState {
            const meta = tr.getMeta(userAnnotationPluginKey);

            if (meta) {
              if (meta.activate !== undefined) {
                const isActive = meta.activate;
                const tool = meta.tool ?? value.tool;
                const level = meta.level ?? value.level;
                return {
                  ...value,
                  isActive,
                  tool,
                  level,
                  isPainting: false,
                  paintStart: null,
                  paintEnd: null,
                  decorations: isActive
                    ? buildDecorations(newState.doc, value.ranges)
                    : DecorationSet.empty,
                };
              }

              if (meta.setTool !== undefined) {
                return { ...value, tool: meta.setTool };
              }

              if (meta.setLevel !== undefined) {
                return { ...value, level: meta.setLevel };
              }

              if (meta.addAnnotation) {
                const { from, to, level } = meta.addAnnotation;
                const newRanges = applyAnnotation(value.ranges, from, to, level ?? value.level);
                return {
                  ...value,
                  ranges: newRanges,
                  paintEnd: null,
                  decorations: buildDecorations(newState.doc, newRanges),
                };
              }

              if (meta.removeAnnotation) {
                const { from, to } = meta.removeAnnotation;
                const newRanges = removeAnnotation(value.ranges, from, to);
                return {
                  ...value,
                  ranges: newRanges,
                  paintEnd: null,
                  decorations: buildDecorations(newState.doc, newRanges),
                };
              }

              if (meta.clearAll) {
                return {
                  ...value,
                  ranges: [],
                  decorations: DecorationSet.empty,
                };
              }

              if (meta.setPainting !== undefined) {
                const newPaintEnd = meta.paintEnd ?? value.paintEnd;
                const newPaintStart = meta.paintStart ?? value.paintStart;
                const painting = meta.setPainting;

                const preview = (painting && newPaintStart !== null && newPaintEnd !== null)
                  ? buildPreviewDecoration(newPaintStart, newPaintEnd, value.tool)
                  : [];
                const rangeDecos = value.ranges.map((r) =>
                  Decoration.inline(r.from, r.to, {
                    class: ANNOTATION_CLASSES[r.level] ?? ANNOTATION_CLASSES[3],
                  }),
                );

                return {
                  ...value,
                  isPainting: painting,
                  paintStart: newPaintStart,
                  paintEnd: newPaintEnd,
                  decorations: DecorationSet.create(newState.doc, [...rangeDecos, ...preview]),
                };
              }
            }

            if (tr.docChanged && value.ranges.length > 0) {
              const newRanges = mapRanges(value.ranges, tr.mapping);
              return {
                ...value,
                ranges: newRanges,
                decorations: value.isActive
                  ? buildDecorations(newState.doc, newRanges)
                  : DecorationSet.empty,
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = userAnnotationPluginKey.getState(state) as
              | AnnotationPluginState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },

          attributes(state): Record<string, string> {
            const pluginState = userAnnotationPluginKey.getState(state) as
              | AnnotationPluginState
              | undefined;
            if (!pluginState?.isActive) return {};
            return {
              class: pluginState.tool === 'highlight'
                ? 'annotation-highlight-mode'
                : 'annotation-eraser-mode',
            };
          },

          handleDOMEvents: {
            mousedown(view: EditorView, event: MouseEvent) {
              const pluginState = userAnnotationPluginKey.getState(view.state) as
                | AnnotationPluginState
                | undefined;
              if (!pluginState?.isActive) return false;

              const pos = posFromEvent(view, event);
              if (pos === null) return false;

              view.dispatch(
                view.state.tr.setMeta(userAnnotationPluginKey, {
                  setPainting: true,
                  paintStart: pos,
                  paintEnd: pos,
                }),
              );

              event.preventDefault();
              return true;
            },

            mousemove(view: EditorView, event: MouseEvent) {
              const pluginState = userAnnotationPluginKey.getState(view.state) as
                | AnnotationPluginState
                | undefined;
              if (!pluginState?.isActive || !pluginState.isPainting) return false;

              const pos = posFromEvent(view, event);
              if (pos === null) return false;

              view.dispatch(
                view.state.tr.setMeta(userAnnotationPluginKey, {
                  setPainting: true,
                  paintEnd: pos,
                }),
              );
              return true;
            },

            mouseup(view: EditorView, event: MouseEvent) {
              const pluginState = userAnnotationPluginKey.getState(view.state) as
                | AnnotationPluginState
                | undefined;
              if (!pluginState?.isActive || !pluginState.isPainting) return false;

              const endPos = posFromEvent(view, event);
              if (endPos === null || pluginState.paintStart === null) {
                view.dispatch(
                  view.state.tr.setMeta(userAnnotationPluginKey, {
                    setPainting: false,
                  }),
                );
                return true;
              }

              const from = Math.min(pluginState.paintStart, endPos);
              const to = Math.max(pluginState.paintStart, endPos);

              // Stop painting
              view.dispatch(
                view.state.tr.setMeta(userAnnotationPluginKey, {
                  setPainting: false,
                }),
              );

              // Apply annotation at current level, or erase
              if (from < to) {
                if (pluginState.tool === 'highlight') {
                  view.dispatch(
                    view.state.tr.setMeta(userAnnotationPluginKey, {
                      addAnnotation: { from, to, level: pluginState.level },
                    }),
                  );
                } else {
                  view.dispatch(
                    view.state.tr.setMeta(userAnnotationPluginKey, {
                      removeAnnotation: { from, to },
                    }),
                  );
                }
              }

              return true;
            },
          },
        },
      }),
    ];
  },
});

// --- Helper Functions ---

export function activateAnnotationMode(editor: Editor, tool: 'highlight' | 'eraser', level?: number): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(userAnnotationPluginKey, {
      activate: true,
      tool,
      level,
    }),
  );
}

export function deactivateAnnotationMode(editor: Editor): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(userAnnotationPluginKey, {
      activate: false,
    }),
  );
}

export function setAnnotationTool(editor: Editor, tool: 'highlight' | 'eraser'): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(userAnnotationPluginKey, {
      setTool: tool,
    }),
  );
}

export function setAnnotationLevel(editor: Editor, level: number): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(userAnnotationPluginKey, {
      setLevel: level,
    }),
  );
}

export function clearAllAnnotations(editor: Editor): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta(userAnnotationPluginKey, {
      clearAll: true,
    }),
  );
}

export function getAnnotationRanges(editor: Editor): AnnotationRange[] {
  const pluginState = userAnnotationPluginKey.getState(editor.state) as
    | AnnotationPluginState
    | undefined;
  return pluginState?.ranges ?? [];
}
