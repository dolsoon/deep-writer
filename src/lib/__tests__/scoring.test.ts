import { describe, it, expect } from 'vitest';
import {
  computeD1Base,
  computeD2Base,
  computeD3Base,
  computeCompositeScore,
  scoreToLevel,
} from '@/lib/scoring';

describe('scoring', () => {
  // ─── AC-SCORE-001: D1 Wording ──────────────────────────────────────

  describe('computeD1Base', () => {
    it('returns 1.0 for user-written text', () => {
      expect(computeD1Base('user-written')).toBe(1.0);
    });

    it('returns 0.5 for user-edited text', () => {
      expect(computeD1Base('user-edited')).toBe(0.5);
    });

    it('returns 0.0 for ai-generated in a generation round', () => {
      expect(computeD1Base('ai-generated', 'generation')).toBe(0.0);
    });

    it('returns 0.1 for ai-generated alternative without subsequent edit', () => {
      expect(computeD1Base('ai-generated', 'alternative', false)).toBe(0.1);
    });

    it('returns 0.5 for ai-generated alternative with subsequent edit', () => {
      expect(computeD1Base('ai-generated', 'alternative', true)).toBe(0.5);
    });

    it('returns 0.0 for ai-generated with no round type specified', () => {
      expect(computeD1Base('ai-generated')).toBe(0.0);
    });

    it('returns 0.0 for other mark states', () => {
      expect(computeD1Base('ai-pending')).toBe(0.0);
      expect(computeD1Base('marked-preserve')).toBe(0.0);
      expect(computeD1Base('marked-delete')).toBe(0.0);
      expect(computeD1Base('original-removed')).toBe(0.0);
    });
  });

  // ─── AC-SCORE-002: D2 Direction-Setting ────────────────────────────

  describe('computeD2Base', () => {
    it('returns 0.0 for no prompt and no constraints', () => {
      expect(computeD2Base({ promptLength: 0, constraintCount: 0 })).toBe(0.0);
    });

    it('returns 0.1 for short prompt (<15 chars), no constraints', () => {
      expect(computeD2Base({ promptLength: 10, constraintCount: 0 })).toBe(0.1);
    });

    it('returns 0.3 for medium prompt (15-50 chars), no constraints', () => {
      expect(computeD2Base({ promptLength: 30, constraintCount: 0 })).toBe(0.3);
    });

    it('returns 0.9 for long prompt (>50 chars) with 2 constraints', () => {
      expect(computeD2Base({ promptLength: 60, constraintCount: 2 })).toBe(0.9);
    });

    it('caps at 1.0 for long prompt with 4 constraints', () => {
      expect(computeD2Base({ promptLength: 60, constraintCount: 4 })).toBe(1.0);
    });

    it('returns 0.3 base for alternative type with no prompt or constraints', () => {
      expect(
        computeD2Base({ promptLength: 0, constraintCount: 0, type: 'alternative' }),
      ).toBe(0.3);
    });

    it('adds prompt contribution on top of alternative base', () => {
      expect(
        computeD2Base({ promptLength: 30, constraintCount: 0, type: 'alternative' }),
      ).toBe(0.6);
    });

    it('caps at 1.0 for alternative with long prompt and constraints', () => {
      expect(
        computeD2Base({ promptLength: 60, constraintCount: 3, type: 'alternative' }),
      ).toBe(1.0);
    });

    it('handles exactly 15 chars as medium prompt', () => {
      expect(computeD2Base({ promptLength: 15, constraintCount: 0 })).toBe(0.3);
    });

    it('handles exactly 50 chars as medium prompt', () => {
      expect(computeD2Base({ promptLength: 50, constraintCount: 0 })).toBe(0.3);
    });

    it('constraint contribution maxes at 3 effective constraints', () => {
      expect(computeD2Base({ promptLength: 0, constraintCount: 3 })).toBeCloseTo(0.6);
      expect(computeD2Base({ promptLength: 0, constraintCount: 5 })).toBeCloseTo(0.6);
    });
  });

  // ─── AC-SCORE-003: D3 Curation ────────────────────────────────────

  describe('computeD3Base', () => {
    it('returns 0.2 for accepted', () => {
      expect(computeD3Base('accepted')).toBe(0.2);
    });

    it('returns 0.7 for edited', () => {
      expect(computeD3Base('edited')).toBe(0.7);
    });

    it('returns 1.0 for rejected', () => {
      expect(computeD3Base('rejected')).toBe(1.0);
    });

    it('returns 0.6 for alt-selected', () => {
      expect(computeD3Base('alt-selected')).toBe(0.6);
    });

    it('returns 0.8 for alt-selected-edited', () => {
      expect(computeD3Base('alt-selected-edited')).toBe(0.8);
    });

    it('returns 0.0 for unknown actions', () => {
      expect(computeD3Base('unknown')).toBe(0.0);
      expect(computeD3Base('')).toBe(0.0);
    });
  });

  // ─── AC-SCORE-004: Composite Score ────────────────────────────────

  describe('computeCompositeScore', () => {
    it('returns 1.0 for all dimensions at maximum', () => {
      expect(computeCompositeScore(1.0, 1.0, 1.0)).toBe(1.0);
    });

    it('returns ~0.05 for (0.0, 0.0, 0.2)', () => {
      expect(computeCompositeScore(0.0, 0.0, 0.2)).toBeCloseTo(0.05);
    });

    it('returns ~0.63 for (0.5, 0.7, 0.7)', () => {
      expect(computeCompositeScore(0.5, 0.7, 0.7)).toBeCloseTo(0.63);
    });

    it('returns 0.0 for all dimensions at zero', () => {
      expect(computeCompositeScore(0.0, 0.0, 0.0)).toBe(0.0);
    });

    it('weights D2 most heavily (0.40)', () => {
      // Only D2 = 1.0, others zero
      expect(computeCompositeScore(0.0, 1.0, 0.0)).toBeCloseTo(0.40);
    });

    it('weights D1 at 0.35', () => {
      // Only D1 = 1.0, others zero
      expect(computeCompositeScore(1.0, 0.0, 0.0)).toBeCloseTo(0.35);
    });

    it('weights D3 at 0.25', () => {
      // Only D3 = 1.0, others zero
      expect(computeCompositeScore(0.0, 0.0, 1.0)).toBeCloseTo(0.25);
    });
  });

  // ─── AC-SCORE-005: Score to Level ─────────────────────────────────

  describe('scoreToLevel', () => {
    it('maps 0.0 to level 1', () => {
      expect(scoreToLevel(0.0)).toBe(1);
    });

    it('maps 0.19 to level 1', () => {
      expect(scoreToLevel(0.19)).toBe(1);
    });

    it('maps 0.20 to level 2', () => {
      expect(scoreToLevel(0.20)).toBe(2);
    });

    it('maps 0.39 to level 2', () => {
      expect(scoreToLevel(0.39)).toBe(2);
    });

    it('maps 0.40 to level 3', () => {
      expect(scoreToLevel(0.40)).toBe(3);
    });

    it('maps 0.59 to level 3', () => {
      expect(scoreToLevel(0.59)).toBe(3);
    });

    it('maps 0.60 to level 4', () => {
      expect(scoreToLevel(0.60)).toBe(4);
    });

    it('maps 0.79 to level 4', () => {
      expect(scoreToLevel(0.79)).toBe(4);
    });

    it('maps 0.80 to level 5', () => {
      expect(scoreToLevel(0.80)).toBe(5);
    });

    it('maps 1.0 to level 5', () => {
      expect(scoreToLevel(1.0)).toBe(5);
    });
  });
});
