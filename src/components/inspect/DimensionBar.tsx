'use client';

// --- Types ---

interface DimensionBarProps {
  /** Display label for the dimension (e.g. "Concept"). */
  label: string;
  /** Dimension value between 0 and 1. */
  value: number;
  /** CSS color string for the bar fill. */
  color: string;
}

// --- Component ---

export function DimensionBar({ label, value, color }: DimensionBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const displayPercent = Math.round(clamped * 100);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          {displayPercent}%
        </span>
      </div>
      <div
        className="w-full h-[6px] rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
        role="progressbar"
        aria-label={`${label}: ${displayPercent} percent`}
        aria-valuenow={displayPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${displayPercent}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
