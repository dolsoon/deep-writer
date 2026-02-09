'use client';

// --- Types ---

interface DonutChartProps {
  /** Overall contribution percentage (0-100). */
  percentage: number;
}

// --- Color constants ---

const COLOR_HUMAN = 'rgb(209, 213, 219)';  // Neutral gray - You (matches white/transparent editor)
const COLOR_AI = 'rgb(168, 85, 247)';      // Purple - AI (stands out)

// --- Layout constants ---

const VIEW_BOX_SIZE = 200;
const CENTER = VIEW_BOX_SIZE / 2;
const STROKE_WIDTH = 18;
const RADIUS = (VIEW_BOX_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// --- Component ---

export function DonutChart({ percentage }: DonutChartProps) {
  const safe = Number.isFinite(percentage) ? percentage : 0;
  const clamped = Math.max(0, Math.min(100, safe));
  const rounded = Math.round(clamped);
  const aiPercentage = 100 - rounded;
  const humanLength = (clamped / 100) * CIRCUMFERENCE;
  const humanOffset = CIRCUMFERENCE - humanLength;

  return (
    <div className="flex flex-col items-center w-full gap-3">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
        className="max-w-[180px]"
        role="img"
        aria-label={`Your contribution: ${rounded} percent, AI contribution: ${aiPercentage} percent`}
      >
        {/* AI ring (full background) */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={COLOR_AI}
          strokeWidth={STROKE_WIDTH}
          opacity={0.35}
        />

        {/* Human arc (overlaid) */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={COLOR_HUMAN}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={humanOffset}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />

        {/* Center label */}
        <text
          x={CENTER}
          y={CENTER - 8}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-500 dark:fill-gray-400 text-[12px] font-medium"
        >
          Your Input
        </text>
        <text
          x={CENTER}
          y={CENTER + 16}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-800 dark:fill-gray-100 text-[26px] font-bold"
        >
          {rounded}%
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: COLOR_HUMAN }}
          />
          You {rounded}%
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: COLOR_AI, opacity: 0.6 }}
          />
          AI {aiPercentage}%
        </span>
      </div>
    </div>
  );
}
