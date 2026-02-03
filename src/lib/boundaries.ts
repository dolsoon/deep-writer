import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface TextRange {
  from: number;
  to: number;
}

// Conjunctions that serve as phrase delimiters
const PHRASE_CONJUNCTIONS = /\b(and|but|or|which|that)\b/;

// Punctuation that delimits phrases within a sentence
const PHRASE_PUNCTUATION = /[,;:]/;

// Sentence-terminating punctuation
const SENTENCE_TERMINATORS = /[.?!]/;

/**
 * Convert a ProseMirror document position to a character index in the flat text.
 * Accounts for the fact that ProseMirror positions include node boundaries.
 */
export function posToCharIndex(doc: ProseMirrorNode, pos: number): number {
  // textBetween with pos gives us the text up to that position
  const textBefore = doc.textBetween(0, Math.min(pos, doc.content.size), '', '\n');
  return textBefore.length;
}

/**
 * Convert a character index in flat text back to a ProseMirror document position.
 * Walks the document tree to find the corresponding position.
 */
export function charIndexToPos(doc: ProseMirrorNode, charIndex: number): number {
  let currentCharIndex = 0;
  let resultPos = 0;
  let found = false;

  doc.descendants((node, pos) => {
    if (found) return false;

    if (node.isText && node.text) {
      const textLength = node.text.length;
      if (currentCharIndex + textLength >= charIndex) {
        resultPos = pos + (charIndex - currentCharIndex);
        found = true;
        return false;
      }
      currentCharIndex += textLength;
    } else if (node.isBlock && pos > 0) {
      // Block nodes add a newline separator in textBetween
      if (currentCharIndex >= charIndex) {
        resultPos = pos;
        found = true;
        return false;
      }
      currentCharIndex += 1; // for the '\n' separator
    }
    return true;
  });

  if (!found) {
    resultPos = doc.content.size;
  }

  return resultPos;
}

/**
 * Find word boundaries at a ProseMirror position.
 * Words are delimited by whitespace. Attached punctuation is included.
 */
export function getWordBoundary(doc: ProseMirrorNode, pos: number): TextRange {
  const text = doc.textBetween(0, doc.content.size, '', '\n');
  const charIndex = posToCharIndex(doc, pos);

  if (text.length === 0) {
    return { from: pos, to: pos };
  }

  // Clamp to valid range
  const idx = Math.min(Math.max(charIndex, 0), text.length - 1);

  let start = idx;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start--;
  }

  let end = idx;
  while (end < text.length && !/\s/.test(text[end])) {
    end++;
  }

  // If we landed on whitespace, try the word before
  if (start === end && idx > 0 && /\s/.test(text[idx])) {
    end = idx;
    start = idx - 1;
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start--;
    }
  }

  return {
    from: charIndexToPos(doc, start),
    to: charIndexToPos(doc, end),
  };
}

/**
 * Find sentence boundaries at a ProseMirror position.
 * Sentences are delimited by . ? ! followed by whitespace or end-of-document.
 */
export function getSentenceBoundary(doc: ProseMirrorNode, pos: number): TextRange {
  const text = doc.textBetween(0, doc.content.size, '', '\n');
  const charIndex = posToCharIndex(doc, pos);

  if (text.length === 0) {
    return { from: pos, to: pos };
  }

  const idx = Math.min(Math.max(charIndex, 0), text.length - 1);

  // Search backward for sentence start
  let start = idx;
  while (start > 0) {
    if (
      SENTENCE_TERMINATORS.test(text[start - 1]) &&
      (start < text.length && /\s/.test(text[start]))
    ) {
      break;
    }
    start--;
  }

  // Skip leading whitespace
  while (start < text.length && /\s/.test(text[start])) {
    start++;
  }

  // Search forward for sentence end
  let end = idx;
  while (end < text.length) {
    if (SENTENCE_TERMINATORS.test(text[end])) {
      end++; // include the punctuation
      break;
    }
    end++;
  }

  // If we didn't find a terminator, extend to end of text
  if (end >= text.length) {
    end = text.length;
  }

  return {
    from: charIndexToPos(doc, start),
    to: charIndexToPos(doc, end),
  };
}

/**
 * Find phrase boundaries at a ProseMirror position.
 * Phrases are delimited by punctuation (, ; :) and conjunctions (and, but, or, which, that)
 * within a sentence.
 */
export function getPhraseBoundary(doc: ProseMirrorNode, pos: number): TextRange {
  const sentenceRange = getSentenceBoundary(doc, pos);
  const sentenceText = doc.textBetween(sentenceRange.from, sentenceRange.to, '', '');
  const charIndex = posToCharIndex(doc, pos);
  const sentenceStartChar = posToCharIndex(doc, sentenceRange.from);
  const offsetInSentence = charIndex - sentenceStartChar;

  if (sentenceText.length === 0) {
    return sentenceRange;
  }

  // Collect phrase segments as (start, end) pairs
  const segments: Array<{ start: number; end: number }> = [];
  let segStart = 0;

  for (let i = 0; i < sentenceText.length; i++) {
    // Check for punctuation delimiters (, ; :)
    if (PHRASE_PUNCTUATION.test(sentenceText[i])) {
      segments.push({ start: segStart, end: i }); // exclude the punctuation
      segStart = i + 1; // next segment starts after punctuation
      continue;
    }

    // Check for conjunction delimiters (and, but, or, which, that)
    if (i === 0 || /\s/.test(sentenceText[i - 1])) {
      const remaining = sentenceText.slice(i);
      const conjMatch = remaining.match(PHRASE_CONJUNCTIONS);
      if (conjMatch && conjMatch.index === 0) {
        if (i > segStart) {
          segments.push({ start: segStart, end: i }); // end before conjunction
        }
        segStart = i; // conjunction belongs to the next segment
      }
    }
  }

  // Add the final segment
  segments.push({ start: segStart, end: sentenceText.length });

  // Find the segment containing the click position
  for (const seg of segments) {
    if (offsetInSentence >= seg.start && offsetInSentence < seg.end) {
      // Trim whitespace from edges
      let trimmedStart = seg.start;
      while (trimmedStart < seg.end && /\s/.test(sentenceText[trimmedStart])) {
        trimmedStart++;
      }
      let trimmedEnd = seg.end;
      while (trimmedEnd > trimmedStart && /\s/.test(sentenceText[trimmedEnd - 1])) {
        trimmedEnd--;
      }

      if (trimmedStart >= trimmedEnd) {
        return sentenceRange; // fallback if empty after trimming
      }

      return {
        from: charIndexToPos(doc, sentenceStartChar + trimmedStart),
        to: charIndexToPos(doc, sentenceStartChar + trimmedEnd),
      };
    }
  }

  return sentenceRange; // fallback
}
