import { describe, it, expect } from 'vitest';
import { computeWordDiff, type DiffSegment } from '../wordDiff';

describe('computeWordDiff', () => {
  it('returns equal for identical strings', () => {
    const result = computeWordDiff('hello world', 'hello world');
    expect(result).toEqual([{ type: 'equal', text: 'hello world' }]);
  });

  it('detects a single word swap', () => {
    const result = computeWordDiff('the good dog', 'the great dog');
    expect(result).toEqual([
      { type: 'equal', text: 'the' },
      { type: 'removed', text: 'good' },
      { type: 'added', text: 'great' },
      { type: 'equal', text: 'dog' },
    ]);
  });

  it('detects word addition', () => {
    const result = computeWordDiff('a cat', 'a big cat');
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'added', text: 'big' },
      { type: 'equal', text: 'cat' },
    ]);
  });

  it('detects word removal', () => {
    const result = computeWordDiff('a big cat', 'a cat');
    expect(result).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'removed', text: 'big' },
      { type: 'equal', text: 'cat' },
    ]);
  });

  it('handles complete rewrite', () => {
    const result = computeWordDiff('hello world', 'foo bar');
    const types = result.map((s) => s.type);
    expect(types).toContain('removed');
    expect(types).toContain('added');
    expect(types).not.toContain('equal');
  });

  it('handles empty original', () => {
    const result = computeWordDiff('', 'new text');
    expect(result).toEqual([{ type: 'added', text: 'new text' }]);
  });

  it('handles empty alternative', () => {
    const result = computeWordDiff('old text', '');
    expect(result).toEqual([{ type: 'removed', text: 'old text' }]);
  });

  it('handles both empty', () => {
    const result = computeWordDiff('', '');
    expect(result).toEqual([]);
  });

  it('uses case-insensitive comparison but preserves alternative casing', () => {
    const result = computeWordDiff('Hello World', 'hello world');
    expect(result).toEqual([{ type: 'equal', text: 'hello world' }]);
  });

  it('handles punctuation attached to words', () => {
    const result = computeWordDiff('good, right?', 'excellent, right?');
    expect(result).toEqual([
      { type: 'removed', text: 'good,' },
      { type: 'added', text: 'excellent,' },
      { type: 'equal', text: 'right?' },
    ]);
  });

  it('merges adjacent segments of the same type', () => {
    const result = computeWordDiff('a b c', 'x y z');
    const removedSegs = result.filter((s: DiffSegment) => s.type === 'removed');
    const addedSegs = result.filter((s: DiffSegment) => s.type === 'added');
    expect(removedSegs.length).toBe(1);
    expect(addedSegs.length).toBe(1);
    expect(removedSegs[0].text).toBe('a b c');
    expect(addedSegs[0].text).toBe('x y z');
  });
});
