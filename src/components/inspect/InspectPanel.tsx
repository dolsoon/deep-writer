'use client';

import { useMemo, useState, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { SelectedSegment, Dimension } from '@/types/contribution';
import { useInspectStore } from '@/stores/useInspectStore';
import { useDocumentScores } from '@/hooks/useDocumentScores';
import { DonutChart } from './DonutChart';
import { ProvenanceChain } from './ProvenanceChain';
import { useRoundStore } from '@/stores/useRoundStore';
import { getAnnotationRanges } from '@/extensions/UserAnnotationPlugin';
import type { AnnotationRange } from '@/extensions/UserAnnotationPlugin';

// --- Types ---

interface DocumentScores {
  overall: number;
  concept: number;
  wording: number;
  evaluation: number;
  levelDistribution: {
    level1: number;
    level2: number;
    level3: number;
    level4: number;
    level5: number;
  };
}

// --- Color constants ---

const LEVEL_COLORS = {
  level1: { color: 'rgb(168, 85, 247)', label: 'Mostly AI' },
  level2: { color: 'rgb(149, 112, 248)', label: 'AI-led' },
  level3: { color: 'rgb(162, 148, 236)', label: 'Collaborative' },
  level4: { color: 'rgb(190, 180, 220)', label: 'You-led' },
  level5: { color: 'rgb(209, 213, 219)', label: 'Mostly You' },
} as const;

function getDimensionColor(value: number): string {
  const percentage = value * 100;
  if (percentage >= 80) return LEVEL_COLORS.level5.color;
  if (percentage >= 60) return LEVEL_COLORS.level4.color;
  if (percentage >= 40) return LEVEL_COLORS.level3.color;
  if (percentage >= 20) return LEVEL_COLORS.level2.color;
  return LEVEL_COLORS.level1.color;
}

// --- Comparison Logic ---

interface ComparisonResult {
  accuracy: number;
  overestimated: number;
  underestimated: number;
  totalAnnotated: number;
  totalAI: number;
  totalChars: number;
}

function computeComparison(editor: Editor, annotationRanges: AnnotationRange[]): ComparisonResult {
  const doc = editor.state.doc;
  const docSize = doc.content.size;

  // Build a per-character map of user annotations
  const userAnnotated = new Uint8Array(docSize);
  for (const range of annotationRanges) {
    for (let i = range.from; i < range.to && i < docSize; i++) {
      userAnnotated[i] = 1;
    }
  }

  // Build a per-character map of actual AI contribution
  const actualAI = new Uint8Array(docSize);
  let totalTextChars = 0;

  doc.descendants((node, pos) => {
    if (!node.isText) return;

    const textStateMark = node.marks.find((m) => m.type.name === 'textState');
    const roundId: string | null | undefined = textStateMark?.attrs?.roundId;
    const state = textStateMark?.attrs?.state;

    const isAI = state === 'ai-generated' && !!roundId;

    for (let i = 0; i < node.nodeSize; i++) {
      const charPos = pos + i;
      if (charPos < docSize) {
        if (isAI) {
          actualAI[charPos] = 1;
        }
        totalTextChars++;
      }
    }
  });

  if (totalTextChars === 0) {
    return { accuracy: 1, overestimated: 0, underestimated: 0, totalAnnotated: 0, totalAI: 0, totalChars: 0 };
  }

  let correctlyIdentified = 0;
  let overestimated = 0;
  let underestimated = 0;
  let totalAnnotated = 0;
  let totalAI = 0;

  // Only count text positions (not structural positions)
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (let i = 0; i < node.nodeSize; i++) {
      const charPos = pos + i;
      if (charPos >= docSize) continue;

      const annotated = userAnnotated[charPos] === 1;
      const isAI = actualAI[charPos] === 1;

      if (annotated) totalAnnotated++;
      if (isAI) totalAI++;

      if (annotated && isAI) correctlyIdentified++;
      if (annotated && !isAI) overestimated++;
      if (!annotated && isAI) underestimated++;
    }
  });

  const relevantChars = totalAI + totalAnnotated - correctlyIdentified;
  const accuracy = relevantChars > 0 ? correctlyIdentified / relevantChars : 1;

  return {
    accuracy,
    overestimated,
    underestimated,
    totalAnnotated,
    totalAI,
    totalChars: totalTextChars,
  };
}

// --- Component ---

export interface InspectPanelProps {
  editor: Editor;
}

export function InspectPanel({ editor }: InspectPanelProps) {
  const { selectedSegment, clearSelectedSegment } = useInspectStore();
  const comparisonView = useInspectStore((s) => s.comparisonView);
  const documentScores = useDocumentScores(editor);
  const getAncestryChain = useRoundStore((s) => s.getAncestryChain);

  const ancestryChain = selectedSegment?.roundId
    ? getAncestryChain(selectedSegment.roundId).map((r) => r.roundId)
    : [];

  const hasSelection = selectedSegment !== null;

  const [annotationVersion, setAnnotationVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setAnnotationVersion((v) => v + 1);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  const annotationRanges = useMemo(
    () => getAnnotationRanges(editor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, annotationVersion],
  );
  const hasAnnotations = annotationRanges.length > 0;

  const comparison = useMemo(() => {
    if (!hasAnnotations) return null;
    return computeComparison(editor, annotationRanges);
  }, [editor, annotationRanges, hasAnnotations]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {hasSelection ? 'Segment Analysis' : 'Document Contribution'}
        </h2>
        {hasSelection && (
          <button
            onClick={clearSelectedSegment}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Back to document
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!hasSelection ? (
          <>
            {comparisonView === 'user' && comparison && (
              <PerceptionComparison comparison={comparison} />
            )}
            <DocumentLevelView scores={documentScores} />
            {comparisonView !== 'user' && comparison && (
              <PerceptionComparison comparison={comparison} />
            )}
          </>
        ) : (
          <SegmentView
            segment={selectedSegment}
            ancestryChain={ancestryChain}
          />
        )}
      </div>
    </div>
  );
}

// --- Document-level View ---

function DocumentLevelView({ scores }: { scores: DocumentScores }) {
  const overallPercentage = Math.round(scores.overall * 100);

  return (
    <div className="flex flex-col gap-6">
      {/* Overall donut chart */}
      <div className="flex flex-col items-center">
        <DonutChart percentage={overallPercentage} />
      </div>

      {/* Dimension chips */}
      <DimensionChips
        concept={scores.concept}
        wording={scores.wording}
        evaluation={scores.evaluation}
      />

      {/* Authorship breakdown - stacked bar */}
      <AuthorshipBar distribution={scores.levelDistribution} />

      {/* Document provenance chain */}
      <ProvenanceChainSection />
    </div>
  );
}

// --- Segment-selected View ---

function SegmentView({
  segment,
  ancestryChain,
}: {
  segment: SelectedSegment;
  ancestryChain: string[];
}) {
  const overallPercentage = Math.round(segment.scores.composite * 100);

  return (
    <div className="flex flex-col gap-5">
      {/* Segment excerpt */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Selected segment
        </p>
        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          {segment.text}
        </p>
      </div>

      {/* Segment-level donut chart */}
      <div className="flex flex-col items-center">
        <DonutChart percentage={overallPercentage} />
      </div>

      {/* Segment dimension breakdown */}
      <DimensionChips
        concept={segment.scores.concept}
        wording={segment.scores.wording}
        evaluation={segment.scores.evaluation}
      />

      {/* Provenance chain for this segment */}
      {ancestryChain.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Provenance Chain
          </h3>
          <ProvenanceChain roundIds={ancestryChain} />
        </div>
      )}

      {/* Authorship badge */}
      <div className="flex items-center justify-center">
        <AuthorshipBadge authorship={segment.level} />
      </div>
    </div>
  );
}

// --- Sub-components ---

// --- Dimension metadata ---

const DIMENSION_META: Record<
  Dimension,
  { label: string; color: string; description: string; factors: string }
> = {
  d1: {
    label: 'Wording',
    color: 'rgb(59, 130, 246)',
    description: 'How much you directly wrote or edited the text.',
    factors: 'Direct typing, manual edits, word-level revisions, and text corrections.',
  },
  d2: {
    label: 'Concept',
    color: 'rgb(34, 197, 94)',
    description: 'How much the ideas and structure originated from you.',
    factors: 'Prompts, constraints, topic guidance, structural decisions, and conceptual direction.',
  },
  d3: {
    label: 'Evaluation',
    color: 'rgb(249, 115, 22)',
    description: 'How much you reviewed and curated the output.',
    factors: 'Accepting/rejecting suggestions, selecting alternatives, and reviewing generated content.',
  },
};

const LABEL_TO_DIMENSION: Record<string, Dimension> = {
  Wording: 'd1',
  Concept: 'd2',
  Evaluation: 'd3',
};

function DimensionChips({
  concept,
  wording,
  evaluation,
}: {
  concept: number;
  wording: number;
  evaluation: number;
}) {
  const setHoveredDimension = useInspectStore((s) => s.setHoveredDimension);
  const clearHoveredDimension = useInspectStore((s) => s.clearHoveredDimension);
  const hoveredDimension = useInspectStore((s) => s.hoveredDimension);

  const dims = [
    { label: 'Wording', value: wording },
    { label: 'Concept', value: concept },
    { label: 'Evaluation', value: evaluation },
  ];

  const hoveredMeta = hoveredDimension ? DIMENSION_META[hoveredDimension] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {dims.map((dim) => {
          const pct = Math.round((Number.isFinite(dim.value) ? dim.value : 0) * 100);
          const dimKey = LABEL_TO_DIMENSION[dim.label];
          const meta = DIMENSION_META[dimKey];
          const isHovered = hoveredDimension === dimKey;
          const color = isHovered ? meta.color : getDimensionColor(dim.value);
          return (
            <div
              key={dim.label}
              className={`flex flex-col items-center p-2.5 rounded-lg bg-white dark:bg-gray-900 border-2 cursor-pointer transition-all duration-200 ${
                isHovered ? 'scale-105 shadow-md' : 'hover:scale-[1.02]'
              }`}
              style={{
                borderColor: color,
                boxShadow: isHovered ? `0 0 12px ${meta.color}40` : undefined,
              }}
              onMouseEnter={() => setHoveredDimension(dimKey)}
              onMouseLeave={() => clearHoveredDimension()}
            >
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {dim.label}
              </span>
              <span
                className="text-lg font-bold transition-colors duration-200"
                style={{ color }}
              >
                {pct}%
              </span>
              <span className="text-[9px] text-gray-400 dark:text-gray-500">
                You
              </span>
            </div>
          );
        })}
      </div>

      {/* Dimension detail breakdown on hover */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          hoveredMeta ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        {hoveredMeta && (
          <div
            className="p-3 rounded-lg border text-xs leading-relaxed"
            style={{
              borderColor: `${hoveredMeta.color}40`,
              backgroundColor: `${hoveredMeta.color}08`,
            }}
          >
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">
              {hoveredMeta.label}
            </p>
            <p className="text-gray-600 dark:text-gray-400 mb-1.5">
              {hoveredMeta.description}
            </p>
            <p className="text-gray-500 dark:text-gray-500 text-[10px]">
              <span className="font-medium">Factors:</span> {hoveredMeta.factors}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AuthorshipBar({
  distribution,
}: {
  distribution: { level1: number; level2: number; level3: number; level4: number; level5: number };
}) {
  const segments = [
    { key: 'level1' as const, ...LEVEL_COLORS.level1, value: distribution.level1 },
    { key: 'level2' as const, ...LEVEL_COLORS.level2, value: distribution.level2 },
    { key: 'level3' as const, ...LEVEL_COLORS.level3, value: distribution.level3 },
    { key: 'level4' as const, ...LEVEL_COLORS.level4, value: distribution.level4 },
    { key: 'level5' as const, ...LEVEL_COLORS.level5, value: distribution.level5 },
  ];

  const visible = segments.filter((s) => s.value > 0.005);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
          AI
        </span>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Authorship Breakdown
        </span>
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
          You
        </span>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {visible.map((seg) => {
          const pct = Math.round(seg.value * 100);
          return (
            <div
              key={seg.key}
              className="h-full transition-[width] duration-500 ease-out first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${pct}%`,
                backgroundColor: seg.color,
                minWidth: pct > 0 ? '4px' : '0',
              }}
            />
          );
        })}
      </div>

      {/* Labels for visible segments */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {visible.map((seg) => {
          const pct = Math.round(seg.value * 100);
          return (
            <span key={seg.key} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              {seg.label} {pct}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProvenanceChainSection() {
  const rounds = useRoundStore((s) => s.rounds);
  const roundIds = useMemo(() => Array.from(rounds.values()).map((r) => r.roundId), [rounds]);

  if (roundIds.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Document Rounds
      </h3>
      <ProvenanceChain roundIds={roundIds.reverse()} />
    </div>
  );
}

function PerceptionComparison({ comparison }: { comparison: ComparisonResult }) {
  const accuracyPct = Math.round(comparison.accuracy * 100);

  const getAccuracyColor = (pct: number) => {
    if (pct >= 70) return 'text-green-600 dark:text-green-400';
    if (pct >= 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getAccuracyBg = (pct: number) => {
    if (pct >= 70) return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
    if (pct >= 40) return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800';
    return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
  };

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
        Perception vs Reality
      </h3>

      {/* Accuracy score */}
      <div className={`p-3 rounded-lg border ${getAccuracyBg(accuracyPct)} mb-3`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Accuracy
          </span>
          <span className={`text-lg font-bold ${getAccuracyColor(accuracyPct)}`}>
            {accuracyPct}%
          </span>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
          You correctly identified {accuracyPct}% of AI-dependent text
        </p>
      </div>

      {/* Breakdown stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 dark:bg-orange-900/20 dark:border-orange-800">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 block">
            Your annotations
          </span>
          <span className="text-sm font-bold text-orange-700 dark:text-orange-400">
            {comparison.totalAnnotated}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-0.5">chars</span>
        </div>
        <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 dark:bg-purple-900/20 dark:border-purple-800">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 block">
            Actual AI text
          </span>
          <span className="text-sm font-bold text-purple-700 dark:text-purple-400">
            {comparison.totalAI}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-0.5">chars</span>
        </div>
      </div>

      {/* Over/underestimation */}
      {(comparison.overestimated > 0 || comparison.underestimated > 0) && (
        <div className="mt-2 flex flex-col gap-1.5">
          {comparison.overestimated > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
              <span className="text-gray-600 dark:text-gray-400">
                Overestimated: {comparison.overestimated} chars marked but actually user-written
              </span>
            </div>
          )}
          {comparison.underestimated > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-block w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
              <span className="text-gray-600 dark:text-gray-400">
                Underestimated: {comparison.underestimated} chars not marked but actually AI-generated
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuthorshipBadge({ authorship }: { authorship: number }) {
  const getBadge = (level: number) => {
    if (level >= 4) {
      return {
        text: 'Mostly AI',
        className: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
      };
    }
    if (level >= 2) {
      return {
        text: 'Collaborative',
        className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      };
    }
    return {
      text: 'Mostly You',
      className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    };
  };

  const badge = getBadge(authorship);

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${badge.className}`}
    >
      {badge.text}
    </span>
  );
}
