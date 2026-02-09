import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '../useEditorStore';

vi.mock('nanoid', () => {
  let counter = 0;
  return {
    nanoid: vi.fn(() => `mock-diff-${++counter}`),
  };
});

// --- Helpers ---

function resetStore() {
  useEditorStore.setState({
    textStates: {},
    activeDiffs: [],
    isReadOnly: false,
  });
}

// --- Tests ---

describe('useEditorStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('setTextState', () => {
    it('should set state for a new segment', () => {
      const result = useEditorStore.getState().setTextState('seg-1', 'user-written');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-written');
    });

    it('should set state for multiple segments independently', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      useEditorStore.getState().setTextState('seg-2', 'ai-generated');

      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-written');
      expect(useEditorStore.getState().textStates['seg-2']).toBe('ai-generated');
    });

    it('should allow valid transition: user-written -> marked-delete', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      const result = useEditorStore.getState().setTextState('seg-1', 'marked-delete');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('marked-delete');
    });

    it('should reject invalid transition: user-written -> ai-generated', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      const result = useEditorStore.getState().setTextState('seg-1', 'ai-generated');

      expect(result).toBe(false);
      // State should remain unchanged
      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-written');
    });

    it('should allow valid transition: ai-generated -> user-edited', () => {
      useEditorStore.getState().setTextState('seg-1', 'ai-generated');
      const result = useEditorStore.getState().setTextState('seg-1', 'user-edited');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-edited');
    });

    it('should allow valid transition: ai-generated -> marked-preserve', () => {
      useEditorStore.getState().setTextState('seg-1', 'ai-generated');
      const result = useEditorStore.getState().setTextState('seg-1', 'marked-preserve');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('marked-preserve');
    });

    it('should allow valid transition: ai-generated -> marked-delete', () => {
      useEditorStore.getState().setTextState('seg-1', 'ai-generated');
      const result = useEditorStore.getState().setTextState('seg-1', 'marked-delete');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('marked-delete');
    });

    it('should allow valid transition: user-written -> user-edited', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      const result = useEditorStore.getState().setTextState('seg-1', 'user-edited');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-edited');
    });

    it('should reject invalid transition: ai-pending -> user-written', () => {
      useEditorStore.getState().setTextState('seg-1', 'ai-pending');
      const result = useEditorStore.getState().setTextState('seg-1', 'user-written');

      expect(result).toBe(false);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('ai-pending');
    });

    it('should allow valid transition: marked-delete -> user-written (toggle back)', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      useEditorStore.getState().setTextState('seg-1', 'marked-delete');
      const result = useEditorStore.getState().setTextState('seg-1', 'user-written');

      expect(result).toBe(true);
      expect(useEditorStore.getState().textStates['seg-1']).toBe('user-written');
    });
  });

  describe('getTextState', () => {
    it('should return undefined for non-existent segment', () => {
      expect(useEditorStore.getState().getTextState('non-existent')).toBeUndefined();
    });

    it('should return the current state for an existing segment', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      expect(useEditorStore.getState().getTextState('seg-1')).toBe('user-written');
    });
  });

  describe('addDiff', () => {
    it('should create entry with correct fields', () => {
      const diffId = useEditorStore.getState().addDiff('old text', 'new text', 42);

      expect(diffId).toBeTruthy();
      expect(typeof diffId).toBe('string');

      const { activeDiffs } = useEditorStore.getState();
      expect(activeDiffs).toHaveLength(1);
      expect(activeDiffs[0]).toEqual({
        id: diffId,
        originalText: 'old text',
        replacementText: 'new text',
        position: 42,
        state: 'pending',
        roundId: null,
      });
    });

    it('should create multiple diffs with unique IDs', () => {
      const id1 = useEditorStore.getState().addDiff('a', 'b', 0);
      const id2 = useEditorStore.getState().addDiff('c', 'd', 10);

      expect(id1).not.toBe(id2);
      expect(useEditorStore.getState().activeDiffs).toHaveLength(2);
    });

    it('should always create with pending state', () => {
      useEditorStore.getState().addDiff('text', 'replacement', 5);

      const { activeDiffs } = useEditorStore.getState();
      expect(activeDiffs[0].state).toBe('pending');
    });
  });

  describe('resolveDiff', () => {
    it('should update state to accepted on accept action', () => {
      const diffId = useEditorStore.getState().addDiff('old', 'new', 0);
      const result = useEditorStore.getState().resolveDiff(diffId, 'accept');

      expect(result).toBeDefined();
      expect(result!.state).toBe('accepted');
      expect(result!.id).toBe(diffId);
    });

    it('should update state to rejected on reject action', () => {
      const diffId = useEditorStore.getState().addDiff('old', 'new', 0);
      const result = useEditorStore.getState().resolveDiff(diffId, 'reject');

      expect(result).toBeDefined();
      expect(result!.state).toBe('rejected');
    });

    it('should update state to restored on restore action', () => {
      const diffId = useEditorStore.getState().addDiff('old', 'new', 0);
      const result = useEditorStore.getState().resolveDiff(diffId, 'restore');

      expect(result).toBeDefined();
      expect(result!.state).toBe('restored');
    });

    it('should return undefined for non-existent diff ID', () => {
      const result = useEditorStore.getState().resolveDiff('non-existent', 'accept');
      expect(result).toBeUndefined();
    });

    it('should persist the resolved state in the store', () => {
      const diffId = useEditorStore.getState().addDiff('old', 'new', 0);
      useEditorStore.getState().resolveDiff(diffId, 'accept');

      const diff = useEditorStore.getState().activeDiffs.find((d) => d.id === diffId);
      expect(diff!.state).toBe('accepted');
    });
  });

  describe('getActiveDiffs', () => {
    it('should return only pending diffs', () => {
      const id1 = useEditorStore.getState().addDiff('a', 'b', 0);
      const id2 = useEditorStore.getState().addDiff('c', 'd', 10);
      useEditorStore.getState().addDiff('e', 'f', 20);

      // Resolve some diffs
      useEditorStore.getState().resolveDiff(id1, 'accept');
      useEditorStore.getState().resolveDiff(id2, 'reject');

      const active = useEditorStore.getState().getActiveDiffs();
      expect(active).toHaveLength(1);
      expect(active[0].originalText).toBe('e');
      expect(active[0].state).toBe('pending');
    });

    it('should return empty array when all diffs are resolved', () => {
      const id1 = useEditorStore.getState().addDiff('a', 'b', 0);
      useEditorStore.getState().resolveDiff(id1, 'accept');

      expect(useEditorStore.getState().getActiveDiffs()).toEqual([]);
    });

    it('should return empty array when no diffs exist', () => {
      expect(useEditorStore.getState().getActiveDiffs()).toEqual([]);
    });
  });

  describe('setReadOnly', () => {
    it('should default to false', () => {
      expect(useEditorStore.getState().isReadOnly).toBe(false);
    });

    it('should toggle to true', () => {
      useEditorStore.getState().setReadOnly(true);
      expect(useEditorStore.getState().isReadOnly).toBe(true);
    });

    it('should toggle back to false', () => {
      useEditorStore.getState().setReadOnly(true);
      useEditorStore.getState().setReadOnly(false);
      expect(useEditorStore.getState().isReadOnly).toBe(false);
    });
  });

  describe('clearTextStates', () => {
    it('should reset all text states', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      useEditorStore.getState().setTextState('seg-2', 'ai-generated');

      useEditorStore.getState().clearTextStates();

      expect(useEditorStore.getState().textStates).toEqual({});
    });
  });

  describe('removeTextState', () => {
    it('should remove a specific segment text state', () => {
      useEditorStore.getState().setTextState('seg-1', 'user-written');
      useEditorStore.getState().setTextState('seg-2', 'ai-generated');

      useEditorStore.getState().removeTextState('seg-1');

      expect(useEditorStore.getState().textStates['seg-1']).toBeUndefined();
      expect(useEditorStore.getState().textStates['seg-2']).toBe('ai-generated');
    });

    it('should not throw when removing non-existent segment', () => {
      expect(() => {
        useEditorStore.getState().removeTextState('non-existent');
      }).not.toThrow();
    });
  });
});
