import type { Editor } from '@tiptap/core';

// --- Types ---

export interface TextChange {
  from: number;           // 텍스트 문자 인덱스
  to: number;             // 텍스트 문자 인덱스
  originalText: string;
  replacementText: string;
}

interface Paragraph {
  text: string;
  startIndex: number;
}

// --- Main Entry Point ---

/**
 * Compute document-level diff between original and edited text.
 * Returns a list of TextChange objects representing modifications.
 */
export function computeDocumentDiff(
  originalText: string,
  editedText: string,
): TextChange[] {
  // Trivial cases
  if (originalText === editedText) {
    return [];
  }

  if (originalText.length === 0) {
    // Empty original → entire edited text is an insertion
    return [{ from: 0, to: 0, originalText: '', replacementText: editedText }];
  }

  if (editedText.length === 0) {
    // Empty edited → entire original text is a deletion
    return [{ from: 0, to: originalText.length, originalText, replacementText: '' }];
  }

  // Split into paragraphs
  const originalParagraphs = splitIntoParagraphs(originalText);
  const editedParagraphs = splitIntoParagraphs(editedText);

  // Compute paragraph-level LCS
  const dp = computeParagraphLCS(originalParagraphs, editedParagraphs);

  // Extract changes
  const changes = extractParagraphChanges(originalParagraphs, editedParagraphs, dp);

  return changes;
}

// --- Paragraph Splitting ---

/**
 * Split text into paragraphs (double newline delimited).
 * Track the start index of each paragraph in the original text.
 */
function splitIntoParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const parts = text.split(/\n\n+/);
  let currentIndex = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      paragraphs.push({ text: trimmed, startIndex: currentIndex });
    }
    currentIndex += part.length + 2; // +2 for the "\n\n" delimiter
  }

  return paragraphs;
}

// --- LCS Algorithm ---

/**
 * Compute Longest Common Subsequence (LCS) DP table for paragraphs.
 * Paragraphs are considered equal if their trimmed text matches.
 */
function computeParagraphLCS(
  original: Paragraph[],
  edited: Paragraph[],
): number[][] {
  const m = original.length;
  const n = edited.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (original[i - 1].text === edited[j - 1].text) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

// --- Change Extraction ---

/**
 * Backtrack through the LCS DP table to extract paragraph-level changes.
 * For modified paragraphs, use word-level diff.
 */
function extractParagraphChanges(
  original: Paragraph[],
  edited: Paragraph[],
  dp: number[][],
): TextChange[] {
  const changes: TextChange[] = [];
  let i = original.length;
  let j = edited.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && original[i - 1].text === edited[j - 1].text) {
      // Unchanged paragraph
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Paragraph added in edited version
      const editedPara = edited[j - 1];
      const insertionPoint = i > 0 ? original[i - 1].startIndex + original[i - 1].text.length + 2 : 0;
      changes.push({
        from: insertionPoint,
        to: insertionPoint,
        originalText: '',
        replacementText: editedPara.text,
      });
      j--;
    } else if (i > 0) {
      // Check if this is a modification (next edited paragraph exists)
      if (j > 0 && original[i - 1].text !== edited[j - 1].text) {
        // Modified paragraph → use word-level diff
        const originalPara = original[i - 1];
        const editedPara = edited[j - 1];
        const wordChanges = extractWordLevelChanges(originalPara, editedPara);
        changes.push(...wordChanges);
        i--;
        j--;
      } else {
        // Paragraph deleted
        const originalPara = original[i - 1];
        changes.push({
          from: originalPara.startIndex,
          to: originalPara.startIndex + originalPara.text.length,
          originalText: originalPara.text,
          replacementText: '',
        });
        i--;
      }
    }
  }

  // Reverse to get changes in document order
  changes.reverse();

  return changes;
}

// --- Word-Level Diff ---

/**
 * Extract word-level changes within a modified paragraph.
 * For simplicity and reliability, we treat the entire paragraph as a single change.
 * This is more robust than trying to map word-level changes back to character positions.
 */
function extractWordLevelChanges(
  originalPara: Paragraph,
  editedPara: Paragraph,
): TextChange[] {
  // Treat the entire paragraph as a single replacement
  return [{
    from: originalPara.startIndex,
    to: originalPara.startIndex + originalPara.text.length,
    originalText: originalPara.text,
    replacementText: editedPara.text,
  }];
}

// --- ProseMirror Position Mapping ---

/**
 * Convert a text character index to a ProseMirror document position.
 * This must match the behavior of textBetween(0, size, '\n\n').
 */
export function textIndexToDocPos(editor: Editor, textIndex: number): number {
  const { doc } = editor.state;
  let charCount = 0;
  let resultPos = 0;
  let found = false;

  // Walk through blocks
  doc.forEach((node, offset) => {
    if (found) return;

    if (node.isBlock) {
      const blockStart = offset + 1; // Position after opening tag
      const blockText = node.textContent;

      if (charCount + blockText.length >= textIndex) {
        // Target is within this block
        const localOffset = textIndex - charCount;
        resultPos = blockStart + localOffset;
        found = true;
        return;
      }

      charCount += blockText.length;

      // Add separator length (double newline between blocks)
      // But not after the last block
      const isLastBlock = offset + node.nodeSize >= doc.content.size;
      if (!isLastBlock) {
        charCount += 2; // '\n\n' separator
      }
    }
  });

  // Clamp to valid range
  return Math.max(0, Math.min(resultPos, doc.content.size - 1));
}
