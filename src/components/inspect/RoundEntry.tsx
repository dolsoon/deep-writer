'use client';

import type { RoundMetadata, RoundAnalysis } from '@/types/contribution';

// --- Types ---

interface RoundEntryProps {
  /** The round metadata to display. */
  round: RoundMetadata;
  /** LLM analysis for this round, if available. */
  analysis: RoundAnalysis | null;
}

// --- Helpers ---

/**
 * Derives a human-readable action label from the round metadata.
 *
 * Mapping:
 *   type='generation', generationMode='continuation'  -> "AI generated"
 *   type='generation', generationMode='regenerate'     -> "AI regenerated"
 *   type='alternative'                                 -> "Alternative selected"
 *   If diffActions.edited > 0, appends ", then edited"
 */
function getActionLabel(round: RoundMetadata): string {
  let label: string;

  if (round.type === 'inline-edit') {
    return 'User edited AI text';
  } else if (round.type === 'generation') {
    label =
      round.generationMode === 'regenerate' ? 'AI regenerated' : 'AI generated';
  } else {
    label = 'Alternative selected';
  }

  if (round.diffActions.edited > 0) {
    label += ', then edited';
  }

  return label;
}

/**
 * Returns true when the action is primarily an AI action,
 * false for user-driven actions.
 */
function isAIAction(round: RoundMetadata): boolean {
  return round.type === 'generation' && round.generationMode !== 'inline-edit';
}

/**
 * Truncates text to maxLen characters, appending "..." when necessary.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Builds a fallback narrative when no LLM analysis is available.
 */
function buildFallbackNarrative(round: RoundMetadata): string {
  const parts: string[] = [];

  if (round.type === 'inline-edit') {
    parts.push('User modified AI-authored text');
    if (round.parentRounds.length > 0) {
      parts.push(`based on ${round.parentRounds[0]}`);
    }
    return parts.join(' ');
  } else if (round.type === 'generation') {
    if (round.prompt) {
      parts.push('Generated with prompt');
    } else {
      parts.push('Generated');
    }
  } else {
    parts.push('Alternative selected');
  }

  if (round.constraintCount > 0) {
    parts.push(
      `${round.constraintCount} constraint${round.constraintCount === 1 ? '' : 's'} set`,
    );
  }

  if (round.diffActions.edited > 0) {
    parts.push('then edited');
  }

  return parts.join(', ');
}

// --- Component ---

export function RoundEntry({ round, analysis }: RoundEntryProps) {
  const actionLabel = getActionLabel(round);
  const aiAction = isAIAction(round);

  const narrativeText =
    analysis?.narrativeSummary || buildFallbackNarrative(round);

  return (
    <div className="flex flex-col gap-1 py-2">
      {/* Round number and action badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Round {round.roundNumber}
        </span>
        <span
          className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full ${
            aiAction
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          }`}
        >
          {actionLabel}
        </span>
      </div>

      {/* Prompt excerpt */}
      {round.prompt && (
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {truncate(round.prompt, 80)}
        </p>
      )}

      {/* Constraint summary */}
      {round.constraintCount > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {round.constraintCount} constraint
          {round.constraintCount === 1 ? '' : 's'}:{' '}
          {round.constraintTypes.join(', ')}
        </p>
      )}

      {/* Edit trace — word-level change history */}
      {round.editTrace.length > 0 && (
        <div className="mt-1 space-y-1">
          {round.editTrace
            .filter((t) => t.original !== '' || t.replacement !== '')
            .map((trace, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                {trace.original ? (
                  <span className="line-through text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1 py-0.5 rounded">
                    {truncate(trace.original, 40)}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500 italic px-1 py-0.5">
                    (inserted)
                  </span>
                )}
                <span className="text-gray-400 dark:text-gray-500">
                  &rarr;
                </span>
                {trace.replacement ? (
                  <span className="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-1 py-0.5 rounded">
                    {truncate(trace.replacement, 40)}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500 italic px-1 py-0.5">
                    (deleted)
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Narrative description */}
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mt-0.5">
        {narrativeText}
      </p>
    </div>
  );
}
