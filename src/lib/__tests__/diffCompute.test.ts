import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import { schema as basicSchema } from '@tiptap/pm/schema-basic';
import type { DiffEntry } from '@/types';
import { computeDiffViews } from '@/lib/diffCompute';

// Build a schema with the textState mark (matching TextStateExtension)
const schema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks: basicSchema.spec.marks.append({
    textState: {
      attrs: {
        state: { default: 'user-written' },
        roundId: { default: null },
      },
      parseDOM: [{ tag: 'span[data-text-state]', getAttrs: (el: HTMLElement) => ({
        state: el.getAttribute('data-text-state'),
        roundId: el.getAttribute('data-round-id'),
      })}],
      toDOM(mark) {
        return ['span', { 'data-text-state': mark.attrs.state, 'data-round-id': mark.attrs.roundId }, 0];
      },
    },
  }),
});

function createEmptyState(): EditorState {
  return EditorState.create({ schema });
}

function createStateWithText(text: string): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({ schema, doc });
}

describe('computeDiffViews', () => {
  it('should handle empty doc → insert text (smart-edit path, no endPosition)', () => {
    const state = createEmptyState();
    console.log('Empty doc size:', state.doc.content.size);
    console.log('Empty doc textContent:', JSON.stringify(state.doc.textContent));
    console.log('Empty doc JSON:', JSON.stringify(state.doc.toJSON()));

    const diff: DiffEntry = {
      id: 'test-1',
      originalText: '',
      replacementText: 'Once upon a time there was a story.',
      position: 1,
      // no endPosition (smart-edit path)
      state: 'pending',
      roundId: 'round-1',
    };

    const result = computeDiffViews(state, [diff]);

    console.log('originalDocJSON:', JSON.stringify(result.originalDocJSON));
    console.log('modifiedDocJSON:', JSON.stringify(result.modifiedDocJSON));
    console.log('originalHighlights:', result.originalHighlights);
    console.log('modifiedHighlights:', result.modifiedHighlights);

    // Modified should contain the replacement text
    const modJSON = result.modifiedDocJSON as { content: Array<{ content?: Array<{ text?: string }> }> };
    const modText = modJSON.content?.[0]?.content?.[0]?.text ?? '';
    expect(modText).toBe('Once upon a time there was a story.');
  });

  it('should handle empty doc → insert text (fallback path, with endPosition=1)', () => {
    const state = createEmptyState();
    // For empty doc: docSize=2, firstPos=1, endPos=Math.max(1, 2-1)=1
    const diff: DiffEntry = {
      id: 'test-2',
      originalText: '',
      replacementText: 'A tale of two cities.',
      position: 1,
      endPosition: 1, // fallback path sets endPosition
      state: 'pending',
      roundId: 'round-2',
    };

    const result = computeDiffViews(state, [diff]);

    console.log('Fallback - modifiedDocJSON:', JSON.stringify(result.modifiedDocJSON));

    const modJSON = result.modifiedDocJSON as { content: Array<{ content?: Array<{ text?: string }> }> };
    const modText = modJSON.content?.[0]?.content?.[0]?.text ?? '';
    expect(modText).toBe('A tale of two cities.');
  });

  it('should handle non-empty doc → replacement (with endPosition)', () => {
    const state = createStateWithText('Hello world');
    console.log('Doc size:', state.doc.content.size);
    console.log('Doc textContent:', JSON.stringify(state.doc.textContent));

    // Replace entire text: position=1, endPosition=docSize-1=12
    const diff: DiffEntry = {
      id: 'test-3',
      originalText: 'Hello world',
      replacementText: 'Goodbye world',
      position: 1,
      endPosition: 12, // 1 + "Hello world".length = 12
      state: 'pending',
      roundId: 'round-3',
    };

    const result = computeDiffViews(state, [diff]);

    console.log('Replacement - originalDocJSON:', JSON.stringify(result.originalDocJSON));
    console.log('Replacement - modifiedDocJSON:', JSON.stringify(result.modifiedDocJSON));

    const origJSON = result.originalDocJSON as { content: Array<{ content?: Array<{ text?: string }> }> };
    const origText = origJSON.content?.[0]?.content?.[0]?.text ?? '';
    expect(origText).toBe('Hello world');

    const modJSON = result.modifiedDocJSON as { content: Array<{ content?: Array<{ text?: string }> }> };
    const modText = modJSON.content?.[0]?.content?.[0]?.text ?? '';
    expect(modText).toBe('Goodbye world');
  });

  it('should handle non-empty doc → full replacement via fallback path', () => {
    const state = createStateWithText('Original document text here.');
    const docSize = state.doc.content.size;
    console.log('Doc size:', docSize); // 2 + 28 = 30

    // Fallback: position=1, endPosition=docSize-1=29
    const diff: DiffEntry = {
      id: 'test-4',
      originalText: 'Original document text here.',
      replacementText: 'Completely new text was generated by AI.',
      position: 1,
      endPosition: docSize - 1,
      state: 'pending',
      roundId: 'round-4',
    };

    const result = computeDiffViews(state, [diff]);

    console.log('Full replacement - modifiedDocJSON:', JSON.stringify(result.modifiedDocJSON));

    const modJSON = result.modifiedDocJSON as { content: Array<{ content?: Array<{ text?: string }> }> };
    const modText = modJSON.content?.[0]?.content?.[0]?.text ?? '';
    expect(modText).toBe('Completely new text was generated by AI.');
  });
});
