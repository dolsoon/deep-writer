export interface DiffSegment {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Compute word-level diff between original and alternative text.
 * Uses LCS (Longest Common Subsequence) to find unchanged words,
 * then marks additions and removals. Comparison is case-insensitive
 * but the alternative's casing is preserved in output.
 */
export function computeWordDiff(
  original: string,
  alternative: string,
): DiffSegment[] {
  const origWords = tokenize(original);
  const altWords = tokenize(alternative);

  const m = origWords.length;
  const n = altWords.length;

  if (m === 0 && n === 0) return [];

  // Build LCS table (case-insensitive comparison)
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origWords[i - 1].toLowerCase() === altWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce word-level segments
  const raw: DiffSegment[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      origWords[i - 1].toLowerCase() === altWords[j - 1].toLowerCase()
    ) {
      raw.push({ type: 'equal', text: altWords[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'added', text: altWords[j - 1] });
      j--;
    } else {
      raw.push({ type: 'removed', text: origWords[i - 1] });
      i--;
    }
  }

  raw.reverse();

  // Merge adjacent segments of the same type with space separation
  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.text += ' ' + seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}
