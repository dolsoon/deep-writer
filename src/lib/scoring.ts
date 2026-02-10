import type { TextState } from '@/types/editor';
import type { RoundType, ContributionLevel } from '@/types/contribution';

/**
 * Compute D1 (Wording) base score from mark state.
 *
 * | Mark State    | Round Type                         | D1 Score |
 * |---------------|------------------------------------|----------|
 * | user-written  | N/A                                | 1.0      |
 * | user-edited   | N/A                                | 0.5      |
 * | ai-generated  | generation                         | 0.0      |
 * | ai-generated  | alternative (with subsequent edit) | 0.5      |
 * | ai-generated  | alternative (no edit)              | 0.1      |
 */
export function computeD1Base(
  markState: TextState,
  roundType?: RoundType,
  hasSubsequentEdit?: boolean,
): number {
  if (markState === 'user-written') return 1.0;
  if (markState === 'user-edited') return 0.5;
  if (markState === 'ai-generated') {
    if (roundType === 'alternative') {
      return hasSubsequentEdit ? 0.5 : 0.1;
    }
    return 0.0;
  }
  return 0.0;
}

/**
 * Compute D2 (Direction-Setting) base score from prompt and constraints.
 *
 * - Alternative rounds start with base 0.3
 * - Prompt contribution: 0 for length=0, +0.1 for <15, +0.3 for 15-50, +0.5 for >50
 * - Constraint contribution: +0.2 per constraint (max 0.6)
 * - Capped at 1.0
 */
export function computeD2Base(params: {
  promptLength: number;
  constraintCount: number;
  type?: RoundType;
}): number {
  const { promptLength, constraintCount, type } = params;

  let score = type === 'alternative' ? 0.3 : 0.0;

  // Prompt contribution
  if (promptLength > 50) {
    score += 0.5;
  } else if (promptLength >= 15) {
    score += 0.3;
  } else if (promptLength > 0) {
    score += 0.1;
  }

  // Constraint contribution: +0.2 per constraint, max 0.6
  const effectiveConstraints = Math.min(constraintCount, 3);
  score += effectiveConstraints * 0.2;

  return Math.min(1.0, score);
}

/**
 * Compute D3 (Curation) base score from diff action.
 *
 * | Action              | D3 Score |
 * |---------------------|----------|
 * | accepted            | 0.2      |
 * | edited              | 0.7      |
 * | rejected            | 1.0      |
 * | alt-selected        | 0.6      |
 * | alt-selected-edited | 0.8      |
 */
export function computeD3Base(action: string): number {
  switch (action) {
    case 'accepted':
      return 0.2;
    case 'edited':
      return 0.7;
    case 'rejected':
      return 1.0;
    case 'alt-selected':
      return 0.6;
    case 'alt-selected-edited':
      return 0.8;
    default:
      return 0.0;
  }
}

/**
 * Compute weighted composite score from the three dimensions.
 * Formula: 0.35 * d1 + 0.40 * d2 + 0.25 * d3
 */
export function computeCompositeScore(
  d1: number,
  d2: number,
  d3: number,
): number {
  return 0.35 * d1 + 0.40 * d2 + 0.25 * d3;
}

/**
 * Map a composite score (0.0-1.0) to a ContributionLevel (1-5).
 *
 * | Range         | Level |
 * |---------------|-------|
 * | 0.00 - 0.19   | 1     |
 * | 0.20 - 0.39   | 2     |
 * | 0.40 - 0.59   | 3     |
 * | 0.60 - 0.79   | 4     |
 * | 0.80 - 1.00   | 5     |
 */
export function scoreToLevel(score: number): ContributionLevel {
  if (score < 0.2) return 1;
  if (score < 0.4) return 2;
  if (score < 0.6) return 3;
  if (score < 0.8) return 4;
  return 5;
}
