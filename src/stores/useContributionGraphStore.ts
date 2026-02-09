import { create } from 'zustand';
import type {
  Dimension,
  Edge,
  RoundAnalysis,
  RoundNode,
  RoundNodeMetadata,
  RoundNodeScores,
} from '@/types/contribution';
import { computeCompositeScore } from '@/lib/scoring';

// --- Types ---

interface ContributionGraphState {
  nodes: Map<string, RoundNode>;
}

// Non-reactive memo cache for accumulatedScore. Kept outside Zustand state
// to avoid triggering re-renders when cache is populated during render.
let _memoCache = new Map<string, number>();

interface ContributionGraphActions {
  addNode: (
    roundId: string,
    baseScores: RoundNodeScores,
    metadata: RoundNodeMetadata,
  ) => void;
  updateNodeWithAnalysis: (roundId: string, analysis: RoundAnalysis) => void;
  getNode: (roundId: string) => RoundNode | undefined;
  accumulatedScore: (roundId: string, dimension: Dimension) => number;
  getCompositeScore: (roundId: string) => number;
  clearGraph: () => void;
}

type ContributionGraphStore = ContributionGraphState & ContributionGraphActions;

// --- Valid round types for validation ---

const VALID_ROUND_TYPES = new Set(['generation', 'alternative', 'inline-edit']);

// --- Store ---

export const useContributionGraphStore = create<ContributionGraphStore>()(
  (set, get) => ({
    nodes: new Map(),

    addNode: (
      roundId: string,
      baseScores: RoundNodeScores,
      metadata: RoundNodeMetadata,
    ) => {
      if (!VALID_ROUND_TYPES.has(metadata.type)) {
        throw new Error(
          `Invalid RoundType: "${metadata.type}". Must be "generation" or "alternative".`,
        );
      }

      console.log(`[NODE-CREATE] 🔢 Round ${roundId} created with BASE scores:`, {
        d1: baseScores.d1.toFixed(3),
        d2: baseScores.d2.toFixed(3),
        d3: baseScores.d3.toFixed(3),
        type: metadata.type,
        action: metadata.action
      });

      const node: RoundNode = {
        roundId,
        scores: baseScores,
        edges: [],
        metadata,
        narrative: null,
      };

      const nodes = new Map(get().nodes);
      nodes.set(roundId, node);
      _memoCache = new Map();
      set({ nodes });
    },

    updateNodeWithAnalysis: (roundId: string, analysis: RoundAnalysis) => {
      const existing = get().nodes.get(roundId);
      if (!existing) {
        throw new Error(
          `Node "${roundId}" not found. Cannot update with analysis.`,
        );
      }

      console.log(`[LLM-ANALYSIS] ✅ Round ${roundId} updated:`, {
        before: { d1: existing.scores.d1.toFixed(3), d2: existing.scores.d2.toFixed(3), d3: existing.scores.d3.toFixed(3) },
        after: { d1: analysis.scores.d1.toFixed(3), d2: analysis.scores.d2.toFixed(3), d3: analysis.scores.d3.toFixed(3) },
        type: existing.metadata.type
      });

      const updated: RoundNode = {
        ...existing,
        scores: analysis.scores,
        edges: analysis.edges,
        narrative: {
          conceptsPreserved: analysis.conceptsPreserved,
          conceptsAdded: analysis.conceptsAdded,
          conceptsLost: analysis.conceptsLost,
          summary: analysis.narrativeSummary,
        },
      };

      const nodes = new Map(get().nodes);
      nodes.set(roundId, updated);
      _memoCache = new Map();
      set({ nodes });
    },

    getNode: (roundId: string): RoundNode | undefined => {
      return get().nodes.get(roundId);
    },

    accumulatedScore: (roundId: string, dimension: Dimension): number => {
      const cacheKey = `${roundId}:${dimension}`;
      const cached = _memoCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const nodes = get().nodes;
      const visiting = new Set<string>();

      function compute(rid: string, dim: Dimension): number {
        const key = `${rid}:${dim}`;
        if (_memoCache.has(key)) return _memoCache.get(key)!;

        const node = nodes.get(rid);
        if (!node) return 0;

        // Log score source (base heuristic vs LLM-enhanced)
        const scoreSource = node.narrative === null ? '🔢 BASE' : '🤖 LLM';
        console.log(`[SCORE] ${scoreSource} | Round ${rid} | ${dim}: ${node.scores[dim].toFixed(3)} | Type: ${node.metadata.type}`);

        // Cycle detection: if already visiting this node, use its own score
        if (visiting.has(key)) return node.scores[dim];
        visiting.add(key);

        const dimEdges: Edge[] = node.edges.filter(
          (e) => e.dimension === dim,
        );

        if (dimEdges.length === 0) {
          _memoCache.set(key, node.scores[dim]);
          return node.scores[dim];
        }

        let weightedSum = 0;
        let totalStrength = 0;
        for (const edge of dimEdges) {
          const parentScore = compute(edge.to, dim);
          weightedSum += parentScore * edge.strength;
          totalStrength += edge.strength;
        }

        const inherited = totalStrength > 0 ? weightedSum / totalStrength : 0;
        const selfWeight = 1 / (1 + totalStrength);
        const inheritWeight = totalStrength / (1 + totalStrength);
        const result =
          node.scores[dim] * selfWeight + inherited * inheritWeight;

        _memoCache.set(key, result);
        return result;
      }

      const result = compute(roundId, dimension);
      return result;
    },

    getCompositeScore: (roundId: string): number => {
      const { accumulatedScore } = get();
      const d1 = accumulatedScore(roundId, 'd1');
      const d2 = accumulatedScore(roundId, 'd2');
      const d3 = accumulatedScore(roundId, 'd3');
      return computeCompositeScore(d1, d2, d3);
    },

    clearGraph: () => {
      _memoCache = new Map();
      set({ nodes: new Map() });
    },
  }),
);
