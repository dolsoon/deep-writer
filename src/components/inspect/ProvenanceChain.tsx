'use client';

import { useRoundStore } from '@/stores/useRoundStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import type { RoundAnalysis, RoundNode } from '@/types/contribution';
import { RoundEntry } from './RoundEntry';

// --- Types ---

interface ProvenanceChainProps {
  /** Round IDs ordered newest-first. */
  roundIds: string[];
}

// --- Helpers ---

/**
 * Converts a RoundNode (from the contribution graph store) into a
 * RoundAnalysis object that RoundEntry expects.  Returns null when the
 * node has no narrative data yet.
 */
function nodeToAnalysis(node: RoundNode): RoundAnalysis | null {
  if (!node.narrative) return null;

  return {
    roundId: node.roundId,
    scores: node.scores,
    edges: node.edges,
    conceptsPreserved: node.narrative.conceptsPreserved,
    conceptsAdded: node.narrative.conceptsAdded,
    conceptsLost: node.narrative.conceptsLost,
    narrativeSummary: node.narrative.summary,
  };
}

// --- Component ---

export function ProvenanceChain({ roundIds }: ProvenanceChainProps) {
  const getRound = useRoundStore((s) => s.getRound);
  const getNode = useContributionGraphStore((s) => s.getNode);

  if (roundIds.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">
        No rounds recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto" role="list" aria-label="Provenance chain">
      {roundIds.map((id, index) => {
        const round = getRound(id);
        if (!round) return null;

        const graphNode = getNode(id);
        const analysis = graphNode ? nodeToAnalysis(graphNode) : null;
        const isLast = index === roundIds.length - 1;

        return (
          <div key={id} className="relative flex" role="listitem">
            {/* Timeline column */}
            <div className="flex flex-col items-center mr-3 w-3 shrink-0">
              {/* Dot */}
              <div className="w-2.5 h-2.5 rounded-full bg-gray-400 dark:bg-gray-500 mt-3 shrink-0" />
              {/* Connector line */}
              {!isLast && (
                <div className="w-[2px] grow bg-gray-200 dark:bg-gray-700" />
              )}
            </div>

            {/* Entry content */}
            <div className="min-w-0 flex-1 pb-2">
              <RoundEntry round={round} analysis={analysis} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
