import { useMemo, useState, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { useInspectStore } from '@/stores/useInspectStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { computeCompositeScore, scoreToLevel } from '@/lib/scoring';
import type { DocumentContribution, LevelDistribution } from '@/types/contribution';

// --- Constants ---

const ZERO_DISTRIBUTION: LevelDistribution = {
  level1: 0,
  level2: 0,
  level3: 0,
  level4: 0,
  level5: 0,
};

const ZERO_CONTRIBUTION: DocumentContribution = {
  overall: 0,
  concept: 0,
  wording: 0,
  evaluation: 0,
  levelDistribution: ZERO_DISTRIBUTION,
};

// --- Hook ---

/**
 * Compute document-level contribution scores by walking all text nodes in the
 * ProseMirror document. Scores are weighted averages by character count.
 *
 * - User-written text (no textState mark, state='user-written' without roundId,
 *   or missing roundId) receives full contribution scores (d1=1, d2=1, d3=1).
 * - AI-contributed text uses accumulatedScore from the ContributionGraph for
 *   each dimension (d1=wording, d2=concept, d3=evaluation).
 * - Only computes when inspect mode is active; returns zeroes otherwise.
 * - Memoized via useMemo; recomputes on document changes, graph updates, or
 *   inspect mode toggle.
 */
export function useDocumentScores(editor: Editor | null): DocumentContribution {
  const isInspectMode = useInspectStore((s) => s.isInspectMode);

  // Subscribe to graph nodes for reactivity when contribution data changes.
  // The store creates a new Map reference on every mutation, so reference
  // equality comparison correctly triggers re-renders.
  const graphNodes = useContributionGraphStore((s) => s.nodes);

  // Track editor document version for reactivity to content changes.
  // Incremented on each TipTap 'update' event (which fires after every
  // transaction that changes the document).
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    if (!editor) return;

    const handler = () => setDocVersion((v) => v + 1);
    editor.on('update', handler);

    return () => {
      editor.off('update', handler);
    };
  }, [editor]);

  return useMemo(() => {
    if (!editor || !isInspectMode) return ZERO_CONTRIBUTION;

    const doc = editor.state.doc;

    let totalChars = 0;
    let weightedD1 = 0;
    let weightedD2 = 0;
    let weightedD3 = 0;

    const levelChars: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    // Access accumulatedScore via getState() so the closure captures the
    // latest graph data at computation time. Reactivity is driven by the
    // graphNodes dependency below.
    const { accumulatedScore } = useContributionGraphStore.getState();

    doc.descendants((node) => {
      if (!node.isText) return;

      const charCount = node.text?.length ?? 0;
      if (charCount === 0) return;

      const textStateMark = node.marks.find(
        (m) => m.type.name === 'textState',
      );
      const roundId: string | null =
        (textStateMark?.attrs?.roundId as string) ?? null;
      const state: string =
        (textStateMark?.attrs?.state as string) ?? 'user-written';

      let d1: number;
      let d2: number;
      let d3: number;

      // User-written text or text without a trackable roundId gets full
      // contribution scores, matching the ContributionDecorationPlugin logic.
      if (
        !textStateMark ||
        (state === 'user-written' && !roundId) ||
        !roundId
      ) {
        d1 = 1;
        d2 = 1;
        d3 = 1;
      } else {
        d1 = accumulatedScore(roundId, 'd1');
        d2 = accumulatedScore(roundId, 'd2');
        d3 = accumulatedScore(roundId, 'd3');
      }

      totalChars += charCount;
      weightedD1 += d1 * charCount;
      weightedD2 += d2 * charCount;
      weightedD3 += d3 * charCount;

      const composite = computeCompositeScore(d1, d2, d3);
      const level = scoreToLevel(composite);
      levelChars[level] += charCount;
    });

    // Empty document: return zeroes
    if (totalChars === 0) return ZERO_CONTRIBUTION;

    const avgD1 = weightedD1 / totalChars;
    const avgD2 = weightedD2 / totalChars;
    const avgD3 = weightedD3 / totalChars;

    return {
      overall: computeCompositeScore(avgD1, avgD2, avgD3),
      concept: avgD2,
      wording: avgD1,
      evaluation: avgD3,
      levelDistribution: {
        level1: levelChars[1] / totalChars,
        level2: levelChars[2] / totalChars,
        level3: levelChars[3] / totalChars,
        level4: levelChars[4] / totalChars,
        level5: levelChars[5] / totalChars,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, isInspectMode, graphNodes, docVersion]);
}
