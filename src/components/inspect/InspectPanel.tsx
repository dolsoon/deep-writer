'use client';

import { useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import type { SelectedSegment } from '@/types/contribution';
import { useInspectStore } from '@/stores/useInspectStore';
import { useDocumentScores } from '@/hooks/useDocumentScores';
import { DonutChart } from './DonutChart';
import { ProvenanceChain } from './ProvenanceChain';
import { useRoundStore } from '@/stores/useRoundStore';

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

// --- Component ---

export interface InspectPanelProps {
  editor: Editor;
}

export function InspectPanel({ editor }: InspectPanelProps) {
  const { selectedSegment, clearSelectedSegment } = useInspectStore();
  const documentScores = useDocumentScores(editor);
  const getAncestryChain = useRoundStore((s) => s.getAncestryChain);

  const ancestryChain = selectedSegment?.roundId
    ? getAncestryChain(selectedSegment.roundId).map((r) => r.roundId)
    : [];

  const hasSelection = selectedSegment !== null;

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
          <DocumentLevelView scores={documentScores} />
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

function DimensionChips({
  concept,
  wording,
  evaluation,
}: {
  concept: number;
  wording: number;
  evaluation: number;
}) {
  const dims = [
    { label: 'Concept', value: concept },
    { label: 'Wording', value: wording },
    { label: 'Evaluation', value: evaluation },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {dims.map((dim) => {
        const pct = Math.round((Number.isFinite(dim.value) ? dim.value : 0) * 100);
        const color = getDimensionColor(dim.value);
        return (
          <div
            key={dim.label}
            className="flex flex-col items-center p-2.5 rounded-lg bg-white dark:bg-gray-900 border-2"
            style={{ borderColor: color }}
          >
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {dim.label}
            </span>
            <span
              className="text-lg font-bold"
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
