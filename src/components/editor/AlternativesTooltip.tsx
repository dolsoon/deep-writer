'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAlternatives, type Alternative, type AnnotationCues } from '@/hooks/useAlternatives';
import { AnnotatableText, type WordAnnotation, type AnnotatableWord } from './AnnotatableText';
import { tokenize } from '@/lib/wordDiff';
import { computeWordDiff } from '@/lib/wordDiff';
import type { ExpandLevel } from '@/extensions/MarkingExtension';
import { getApiHeaders } from '@/lib/apiHeaders';

// --- Types ---

interface LevelCache {
  alternatives: Alternative[];
  originalAnnotations: Map<number, WordAnnotation>;
  altAnnotations: Map<number, Map<number, WordAnnotation>>;
}

interface AlternativesTooltipProps {
  selectionRect: DOMRect;
  selectedText: string;
  context: string;
  goal: string;
  onReplace: (alternative: string) => void;
  onDismiss: () => void;
  onExpandSelection: (level: ExpandLevel) => void;
  activeLevel?: ExpandLevel | 'word';
  prefetchedAlternatives?: Alternative[] | null;
  levelTexts?: Record<string, { text: string; context: string }> | null;
}

const EXPAND_LEVELS: { level: ExpandLevel; label: string }[] = [
  { level: 'word', label: 'Original' },
  { level: 'sentence', label: 'Sentence' },
  { level: 'paragraph', label: 'Paragraph' },
];

// --- Constants ---

const VIEWPORT_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 400;
const TOOLTIP_GAP = 6;

// --- Helpers ---

function computePosition(
  selectionRect: DOMRect,
): { top: number; left: number; placement: 'below' | 'above' } {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const spaceBelow = viewportHeight - selectionRect.bottom;
  const placement = spaceBelow < 160 ? 'above' : 'below';

  let top: number;
  if (placement === 'below') {
    top = selectionRect.bottom + TOOLTIP_GAP;
  } else {
    top = selectionRect.top - TOOLTIP_GAP;
  }

  let left = selectionRect.left + selectionRect.width / 2 - TOOLTIP_MAX_WIDTH / 2;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - TOOLTIP_MAX_WIDTH - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, top);

  return { top, left, placement };
}

function wordsFromText(text: string): AnnotatableWord[] {
  return tokenize(text).map((w) => ({ text: w }));
}

function wordsFromDiff(original: string, alternative: string): AnnotatableWord[] {
  const segments = computeWordDiff(original, alternative);
  const words: AnnotatableWord[] = [];
  for (const seg of segments) {
    if (seg.type === 'removed') continue; // skip -- only show alternative's own words
    for (const w of seg.text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, diffType: seg.type });
    }
  }
  return words;
}

function getRemovedOriginalIndices(original: string, alternative: string): Set<number> {
  const segments = computeWordDiff(original, alternative);
  const removed = new Set<number>();
  let origIdx = 0;

  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (seg.type === 'removed') {
      for (let i = 0; i < words.length; i++) {
        removed.add(origIdx++);
      }
    } else if (seg.type === 'equal') {
      origIdx += words.length;
    }
    // 'added' segments don't consume original indices
  }

  return removed;
}

function tagText(
  words: string[],
  annotations: Map<number, WordAnnotation>,
  tagMap: Record<WordAnnotation, string>,
): string | undefined {
  if (annotations.size === 0) return undefined;
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const ann = annotations.get(i);
    if (ann) {
      const tag = tagMap[ann];
      parts.push(`<${tag}>${words[i]}</${tag}>`);
    } else {
      parts.push(words[i]);
    }
  }
  return parts.join(' ');
}

const ORIGINAL_TAG_MAP: Record<WordAnnotation, string> = {
  keep: 'PRESERVE',
  positive: 'PRESERVE',
  negative: 'AVOID',
  delete: 'DELETE',
};

const ALT_TAG_MAP: Record<WordAnnotation, string> = {
  keep: 'LIKE',
  positive: 'LIKE',
  negative: 'DISLIKE',
  delete: 'DELETE',
};

function serializeAnnotations(
  originalText: string,
  originalAnns: Map<number, WordAnnotation>,
  alternatives: Alternative[],
  altAnns: Map<number, Map<number, WordAnnotation>>,
): AnnotationCues {
  const origWords = tokenize(originalText);
  const originalFeedback = tagText(origWords, originalAnns, ORIGINAL_TAG_MAP);

  const suggestionFeedbacks: string[] = [];
  for (const [altIdx, wordAnns] of altAnns) {
    const alt = alternatives[altIdx];
    if (!alt || wordAnns.size === 0) continue;
    const altWords = tokenize(alt.text);
    const tagged = tagText(altWords, wordAnns, ALT_TAG_MAP);
    if (tagged) suggestionFeedbacks.push(tagged);
  }

  return {
    originalFeedback,
    suggestionFeedbacks: suggestionFeedbacks.length > 0 ? suggestionFeedbacks : undefined,
  };
}

function hasAnnotationCues(cues: AnnotationCues): boolean {
  return !!cues.originalFeedback || (cues.suggestionFeedbacks?.length ?? 0) > 0;
}

// --- Component ---

export function AlternativesTooltip({
  selectionRect,
  selectedText,
  context,
  goal,
  onReplace,
  onDismiss,
  onExpandSelection,
  activeLevel = 'word',
  prefetchedAlternatives,
  levelTexts,
}: AlternativesTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [promptValue, setPromptValue] = useState('');
  const { alternatives, isLoading, error, fetchAlternatives, reset } = useAlternatives();

  // Per-level cache: level -> { alternatives, annotations }
  // Initialize with prefetched data to avoid flash of empty/loading state
  const hasPrefetch = activeLevel === 'word' && prefetchedAlternatives && prefetchedAlternatives.length > 0;
  const cacheRef = useRef<Record<string, LevelCache>>(
    hasPrefetch
      ? { word: { alternatives: prefetchedAlternatives, originalAnnotations: new Map(), altAnnotations: new Map() } }
      : {},
  );
  const [displayAlts, setDisplayAlts] = useState<Alternative[] | null>(
    hasPrefetch ? prefetchedAlternatives : null,
  );
  const fetchingLevelRef = useRef<string | null>(null);

  // Annotation state
  const [originalAnnotations, setOriginalAnnotations] = useState<Map<number, WordAnnotation>>(new Map());
  const [altAnnotations, setAltAnnotations] = useState<Map<number, Map<number, WordAnnotation>>>(new Map());
  const [hoveredAltIndex, setHoveredAltIndex] = useState<number | null>(null);

  // Memoize original words
  const originalWords = useMemo(() => wordsFromText(selectedText), [selectedText]);

  // Auto-focus the prompt input on mount
  useEffect(() => {
    promptInputRef.current?.focus();
  }, []);

  // When the hook returns new alternatives, cache them for the fetched level
  useEffect(() => {
    if (alternatives && alternatives.length > 0 && fetchingLevelRef.current) {
      const level = fetchingLevelRef.current;
      cacheRef.current[level] = {
        alternatives,
        originalAnnotations: new Map(),
        altAnnotations: new Map(),
      };
      setDisplayAlts(alternatives);
      setOriginalAnnotations(new Map());
      setAltAnnotations(new Map());
      fetchingLevelRef.current = null;
    }
  }, [alternatives]);

  // On mount + when activeLevel changes: show cache, use prefetch, or fetch
  useEffect(() => {
    const cached = cacheRef.current[activeLevel];
    if (cached) {
      setDisplayAlts(cached.alternatives);
      setOriginalAnnotations(cached.originalAnnotations);
      setAltAnnotations(cached.altAnnotations);
    } else if (activeLevel === 'word' && prefetchedAlternatives && prefetchedAlternatives.length > 0) {
      // Use pre-fetched results for the initial word level
      cacheRef.current[activeLevel] = {
        alternatives: prefetchedAlternatives,
        originalAnnotations: new Map(),
        altAnnotations: new Map(),
      };
      setDisplayAlts(prefetchedAlternatives);
      setOriginalAnnotations(new Map());
      setAltAnnotations(new Map());
    } else {
      setDisplayAlts(null);
      setOriginalAnnotations(new Map());
      setAltAnnotations(new Map());
      fetchingLevelRef.current = activeLevel;
      const count = activeLevel === 'paragraph' ? 2 : undefined;
      fetchAlternatives(selectedText, context, goal, count, activeLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevel]);

  // Background-fetch sentence and paragraph alternatives as soon as word-level results are displayed
  const bgFetchedRef = useRef(false);
  useEffect(() => {
    if (bgFetchedRef.current || !displayAlts || activeLevel !== 'word' || !levelTexts) return;
    bgFetchedRef.current = true;

    const abortController = new AbortController();
    const levels = ['sentence', 'paragraph'] as const;

    for (const level of levels) {
      const info = levelTexts[level];
      if (!info || cacheRef.current[level]) continue;

      const count = level === 'paragraph' ? 2 : undefined;
      fetch('/api/alternatives', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          selectedText: info.text,
          context: info.context,
          goal,
          ...(count != null && { count }),
          level,
        }),
        signal: abortController.signal,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || !data.alternatives?.length) return;
          cacheRef.current[level] = {
            alternatives: data.alternatives,
            originalAnnotations: new Map(),
            altAnnotations: new Map(),
          };
        })
        .catch(() => { /* ignore aborted / failed background fetches */ });
    }

    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAlts, levelTexts]);

  // Persist annotation changes to cache
  const handleOriginalAnnotationChange = useCallback(
    (anns: Map<number, WordAnnotation>) => {
      setOriginalAnnotations(anns);
      if (cacheRef.current[activeLevel]) {
        cacheRef.current[activeLevel].originalAnnotations = anns;
      }
    },
    [activeLevel],
  );

  const handleAltAnnotationChange = useCallback(
    (altIndex: number, anns: Map<number, WordAnnotation>) => {
      setAltAnnotations((prev) => {
        const next = new Map(prev);
        next.set(altIndex, anns);
        if (cacheRef.current[activeLevel]) {
          cacheRef.current[activeLevel].altAnnotations = next;
        }
        return next;
      });
    },
    [activeLevel],
  );

  // Dismiss on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  // Dismiss on click outside (but not on AddContextTooltip)
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(target) &&
        !target.closest('.add-context-tooltip')
      ) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onDismiss]);

  // Adjust position for above-placement after render
  useEffect(() => {
    if (!tooltipRef.current) return;
    const { placement } = computePosition(selectionRect);
    if (placement === 'above') {
      const tooltipHeight = tooltipRef.current.offsetHeight;
      tooltipRef.current.style.top = `${Math.max(
        VIEWPORT_MARGIN,
        selectionRect.top - TOOLTIP_GAP - tooltipHeight,
      )}px`;
    }
  });

  const handleRetry = useCallback(() => {
    const cues = serializeAnnotations(
      selectedText,
      originalAnnotations,
      displayAlts ?? [],
      altAnnotations,
    );
    delete cacheRef.current[activeLevel];
    setDisplayAlts(null);
    setOriginalAnnotations(new Map());
    setAltAnnotations(new Map());
    reset();
    fetchingLevelRef.current = activeLevel;
    const count = activeLevel === 'paragraph' ? 2 : undefined;
    fetchAlternatives(
      selectedText, context, goal, count, activeLevel,
      hasAnnotationCues(cues) ? cues : undefined,
    );
  }, [reset, fetchAlternatives, selectedText, context, goal, activeLevel, originalAnnotations, altAnnotations, displayAlts]);

  const handlePromptRefresh = useCallback(() => {
    const trimmed = promptValue.trim();
    if (!trimmed) return;

    const cues = serializeAnnotations(
      selectedText,
      originalAnnotations,
      displayAlts ?? [],
      altAnnotations,
    );
    delete cacheRef.current[activeLevel];
    setDisplayAlts(null);
    setOriginalAnnotations(new Map());
    setAltAnnotations(new Map());
    reset();
    fetchingLevelRef.current = activeLevel;
    const count = activeLevel === 'paragraph' ? 2 : undefined;
    fetchAlternatives(
      selectedText, context, goal, count, activeLevel,
      hasAnnotationCues(cues) ? cues : undefined,
      trimmed,
    );
    setPromptValue('');
  }, [promptValue, reset, fetchAlternatives, selectedText, context, goal, activeLevel, originalAnnotations, altAnnotations, displayAlts]);

  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handlePromptRefresh();
      }
    },
    [handlePromptRefresh],
  );

  const handlePromptSend = useCallback(() => {
    handlePromptRefresh();
  }, [handlePromptRefresh]);

  const { top, left, placement } = computePosition(selectionRect);
  const maxHeight = placement === 'below'
    ? window.innerHeight - top - VIEWPORT_MARGIN
    : selectionRect.top - TOOLTIP_GAP - VIEWPORT_MARGIN;

  return (
    <div
      ref={tooltipRef}
      className="alternatives-tooltip"
      style={{
        position: 'fixed',
        top,
        left,
        maxWidth: TOOLTIP_MAX_WIDTH,
        maxHeight,
        overflowY: 'auto',
        zIndex: 9999,
      }}
      role="listbox"
      aria-label="Alternative phrasings"
    >
      {/* Prompt input for direct AI instructions */}
      <div
        className="alternatives-tooltip-prompt"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={promptInputRef}
          type="text"
          className="alternatives-tooltip-prompt-input"
          placeholder="Tell AI what to do..."
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
        <button
          type="button"
          className="alternatives-tooltip-prompt-send"
          onClick={handlePromptSend}
          aria-label="Send prompt"
          disabled={!promptValue.trim()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Selection level expansion buttons */}
      <div className="alternatives-tooltip-levels" onMouseDown={(e) => e.stopPropagation()}>
        <span className="alternatives-tooltip-levels-label">Select:</span>
        {EXPAND_LEVELS.map(({ level, label }) => (
          <button
            key={level}
            type="button"
            className={`alternatives-tooltip-level-btn${activeLevel === level ? ' alternatives-tooltip-level-btn-active' : ''}`}
            onClick={() => onExpandSelection(level)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Original text with word-level annotations */}
      <div className="alternatives-tooltip-original" onMouseDown={(e) => e.stopPropagation()}>
        <span className="alternatives-tooltip-original-label">Original:</span>
        <AnnotatableText
          words={originalWords}
          annotations={originalAnnotations}
          onAnnotationChange={handleOriginalAnnotationChange}
          highlights={
            hoveredAltIndex != null && displayAlts?.[hoveredAltIndex]
              ? getRemovedOriginalIndices(selectedText, displayAlts[hoveredAltIndex].text)
              : undefined
          }
        />
      </div>

      {isLoading && !displayAlts && (
        <div className="alternatives-tooltip-loading">
          <div className="alternatives-tooltip-skeleton" />
          <div className="alternatives-tooltip-skeleton" />
          <div className="alternatives-tooltip-skeleton" />
        </div>
      )}

      {error && !displayAlts && (
        <div className="alternatives-tooltip-error">
          <span>{error}</span>
          <button
            className="alternatives-tooltip-retry"
            onClick={handleRetry}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {displayAlts && displayAlts.length > 0 && (
        <div>
          {displayAlts.map((alt, index) => (
            <div
              key={index}
              className="alternatives-tooltip-item"
              onMouseMove={() => { if (hoveredAltIndex !== index) setHoveredAltIndex(index); }}
              onMouseLeave={() => setHoveredAltIndex(null)}
              role="option"
              aria-selected={false}
            >
              {activeLevel === 'paragraph' ? (
                /* Paragraph: truncated preview + Compare button */
                <button
                  type="button"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
                  onClick={() => {
                    onReplace(alt.text);
                    onDismiss();
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {alt.label && (
                      <span className="alternatives-tooltip-item-label">{alt.label}</span>
                    )}
                    <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'inherit', opacity: 0.85 }}>
                      {alt.text.length > 120 ? alt.text.slice(0, 120) + '...' : alt.text}
                    </div>
                    {alt.rationale && (
                      <div className="alternatives-tooltip-rationale">
                        {alt.rationale}
                      </div>
                    )}
                  </div>
                  <span
                    className="alternatives-tooltip-apply-btn"
                    style={{ marginTop: '2px' }}
                  >
                    Compare
                  </span>
                </button>
              ) : (
                /* Word/Sentence: full annotatable text + Apply button */
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    {alt.label && (
                      <span className="alternatives-tooltip-item-label">{alt.label}</span>
                    )}
                    <div onMouseDown={(e) => e.stopPropagation()}>
                      <AnnotatableText
                        words={wordsFromDiff(selectedText, alt.text)}
                        annotations={altAnnotations.get(index) ?? new Map()}
                        onAnnotationChange={(anns) => handleAltAnnotationChange(index, anns)}
                      />
                    </div>
                    {alt.rationale && (
                      <div className="alternatives-tooltip-rationale">
                        {alt.rationale}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="alternatives-tooltip-apply-btn"
                    onClick={() => {
                      onReplace(alt.text);
                      onDismiss();
                    }}
                    aria-label="Apply this alternative"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            className="alternatives-tooltip-regenerate"
            onClick={handleRetry}
            type="button"
            aria-label="Regenerate alternatives"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
