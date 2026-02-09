'use client';

import type { SelectedSegment } from '@/types/contribution';
import { DonutChart } from './DonutChart';
import { DimensionBar } from './DimensionBar';

// --- Constants ---

/**
 * Returns the CSS color for a dimension bar based on the dimension value.
 * Blue (human) → Violet (AI) spectrum for intuitive authorship reading.
 */
function getDimensionColor(value: number): string {
  const percentage = value * 100;
  if (percentage >= 80) return 'rgb(209, 213, 219)';   // Gray - Mostly You
  if (percentage >= 60) return 'rgb(190, 180, 220)';  // Light purple - You-led
  if (percentage >= 40) return 'rgb(162, 148, 236)';  // Mid purple - Collaborative
  if (percentage >= 20) return 'rgb(149, 112, 248)';  // Purple - AI-led
  return 'rgb(168, 85, 247)';                         // Strong purple - Mostly AI
}

// --- Types ---

export interface SegmentPopoverProps {
  /** The selected segment data to display. */
  segment: SelectedSegment;
  /** Callback when the popover should close. */
  onClose: () => void;
  /** Position data for the popover (viewport-relative). */
  position: { x: number; y: number };
}

// --- Component ---

/**
 * SegmentPopover displays detailed contribution analysis for a selected segment.
 *
 * Features:
 * - Overall contribution score as donut chart
 * - Dimension breakdown (concept, wording, evaluation)
 * - Authorship badge based on contribution level
 * - Segment text excerpt
 * - Positioned absolutely based on click coordinates
 */
export function SegmentPopover({ segment, onClose, position }: SegmentPopoverProps) {
  const overallPercentage = Math.round(segment.scores.composite * 100);

  return (
    <div
      className="fixed z-50 w-72 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%) translateY(-12px)',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        aria-label="Close popover"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Segment excerpt */}
      <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
          Selected segment
        </p>
        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed line-clamp-3">
          {segment.text}
        </p>
      </div>

      {/* Overall donut chart */}
      <div className="flex flex-col items-center mb-4">
        <DonutChart percentage={overallPercentage} />
      </div>

      {/* Dimension breakdown */}
      <div className="space-y-2 mb-4">
        <DimensionBar
          label="Concept"
          value={segment.scores.concept}
          color={getDimensionColor(segment.scores.concept)}
        />
        <DimensionBar
          label="Wording"
          value={segment.scores.wording}
          color={getDimensionColor(segment.scores.wording)}
        />
        <DimensionBar
          label="Evaluation"
          value={segment.scores.evaluation}
          color={getDimensionColor(segment.scores.evaluation)}
        />
      </div>

      {/* Authorship badge */}
      <div className="flex items-center justify-center">
        <AuthorshipBadge level={segment.level} />
      </div>
    </div>
  );
}

// --- Sub-component ---

function AuthorshipBadge({ level }: { level: number }) {
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

  const badge = getBadge(level);

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${badge.className}`}
    >
      {badge.text}
    </span>
  );
}
