import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform';
import type { EventType } from '@/types';

// --- Types ---

export interface ProvenancePluginOptions {
  onProvenanceEvent?: (type: EventType, data: Record<string, unknown>) => void;
}

// --- Provenance Extension ---

export const ProvenancePlugin = Extension.create<ProvenancePluginOptions>({
  name: 'provenance',

  addOptions() {
    return {
      onProvenanceEvent: undefined,
    };
  },

  addProseMirrorPlugins() {
    const { onProvenanceEvent } = this.options;

    // Typing debounce state (closure variables for side effects)
    let typingBuffer = '';
    let typingPosition = 0;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;

    const flushTypingBuffer = () => {
      if (typingBuffer && onProvenanceEvent) {
        onProvenanceEvent('text-typed', {
          text: typingBuffer,
          position: typingPosition,
        });
        typingBuffer = '';
        typingPosition = 0;
      }
      typingTimer = null;
    };

    return [
      new Plugin({
        key: new PluginKey('provenance'),

        appendTransaction(transactions, _oldState, newState) {
          if (!onProvenanceEvent) return null;
          if (!newState?.doc) return null;

          for (const tr of transactions) {
            if (!tr.docChanged) continue;
            // Skip provenance logging for preview-only transactions
            if (tr.getMeta('previewOnly')) continue;

            for (const step of tr.steps) {
              // Track mark changes (text state applied/removed)
              if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
                const mark = (step as AddMarkStep | RemoveMarkStep).mark;

                if (mark.type.name === 'textState') {
                  const from = (step as unknown as { from: number }).from;
                  const to = (step as unknown as { to: number }).to;
                  const docSize = newState.doc.content.size;
                  if (from < 0 || to > docSize || from >= to) continue;
                  const text = newState.doc.textBetween(from, to, ' ');

                  // Flush any pending typing buffer before logging mark event
                  if (typingBuffer) {
                    flushTypingBuffer();
                  }

                  onProvenanceEvent('mark-applied', {
                    state: mark.attrs.state as string,
                    action: step instanceof AddMarkStep ? 'add' : 'remove',
                    position: from,
                    text,
                  });
                }

                continue;
              }

              // Track text insertions via step maps
              const stepMap = step.getMap();

              stepMap.forEach(
                (
                  _oldStart: number,
                  oldEnd: number,
                  newStart: number,
                  newEnd: number,
                ) => {
                  if (newEnd > newStart && newEnd > oldEnd - _oldStart + newStart) {
                    // Text was inserted (new content is longer than old)
                    const insertedText = newState.doc.textBetween(
                      newStart,
                      newEnd,
                      '',
                    );

                    if (insertedText) {
                      if (!typingBuffer) {
                        typingPosition = newStart;
                      }
                      typingBuffer += insertedText;

                      if (typingTimer) {
                        clearTimeout(typingTimer);
                      }
                      typingTimer = setTimeout(flushTypingBuffer, 300);
                    }
                  }
                },
              );
            }
          }

          return null;
        },
      }),
    ];
  },
});
