'use client';

import { useRef, useCallback } from 'react';

// --- Types ---

export type WordAnnotation = 'positive' | 'negative';

export interface AnnotatableWord {
  text: string;
  diffType?: 'equal' | 'added' | 'removed';
}

interface AnnotatableTextProps {
  words: AnnotatableWord[];
  annotations: Map<number, WordAnnotation>;
  onAnnotationChange: (annotations: Map<number, WordAnnotation>) => void;
  highlights?: Set<number>;
}

// --- Helpers ---

function nextAnnotation(current: WordAnnotation | undefined): WordAnnotation | undefined {
  if (!current) return 'negative';
  if (current === 'negative') return 'positive';
  return undefined; // positive -> neutral
}

function classForWord(word: AnnotatableWord, annotation: WordAnnotation | undefined, highlighted?: boolean): string {
  const parts = ['annotatable-word'];
  if (word.diffType && word.diffType !== 'equal') {
    parts.push(`alt-diff-${word.diffType}`);
  }
  if (annotation === 'positive') parts.push('word-annotation-positive');
  if (annotation === 'negative') parts.push('word-annotation-negative');
  if (highlighted) parts.push('word-highlight-removed');
  return parts.join(' ');
}

// --- Component ---

export function AnnotatableText({ words, annotations, onAnnotationChange, highlights }: AnnotatableTextProps) {
  const isPainting = useRef(false);
  const paintMode = useRef<WordAnnotation | undefined>(undefined);
  const pendingAnnotations = useRef<Map<number, WordAnnotation>>(new Map());

  const applyToWord = useCallback(
    (index: number) => {
      const next = new Map(pendingAnnotations.current);
      if (paintMode.current === undefined) {
        next.delete(index);
      } else {
        next.set(index, paintMode.current);
      }
      pendingAnnotations.current = next;
      onAnnotationChange(next);
    },
    [onAnnotationChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault(); // prevent text selection
      e.stopPropagation();
      isPainting.current = true;
      pendingAnnotations.current = new Map(annotations);
      paintMode.current = nextAnnotation(annotations.get(index));
      applyToWord(index);

      const handleMouseUp = () => {
        isPainting.current = false;
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mouseup', handleMouseUp);
    },
    [annotations, applyToWord],
  );

  const handleMouseEnter = useCallback(
    (index: number) => {
      if (!isPainting.current) return;
      applyToWord(index);
    },
    [applyToWord],
  );

  return (
    <span className="annotatable-text">
      {words.map((word, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span
            className={classForWord(word, annotations.get(i), highlights?.has(i))}
            onMouseDown={(e) => handleMouseDown(e, i)}
            onMouseEnter={() => handleMouseEnter(i)}
            role="button"
            tabIndex={-1}
          >
            {word.text}
          </span>
        </span>
      ))}
    </span>
  );
}
