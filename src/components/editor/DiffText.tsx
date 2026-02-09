import { useMemo } from 'react';
import { computeWordDiff } from '@/lib/wordDiff';

interface DiffTextProps {
  original: string;
  alternative: string;
}

export function DiffText({ original, alternative }: DiffTextProps) {
  const segments = useMemo(
    () => computeWordDiff(original, alternative),
    [original, alternative],
  );

  return (
    <>
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className={`alt-diff-${seg.type}`}>{seg.text}</span>
        </span>
      ))}
    </>
  );
}
