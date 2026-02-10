import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiHeaders } from '@/lib/apiHeaders';

// --- Types ---

export interface AnnotationCues {
  originalFeedback?: string;       // original text with <PRESERVE>/<AVOID> tags
  suggestionFeedbacks?: string[];  // suggestion texts with <LIKE>/<DISLIKE> tags
}

export interface Alternative {
  text: string;
  label: string;
}

interface UseAlternativesReturn {
  alternatives: Alternative[] | null;
  isLoading: boolean;
  error: string | null;
  fetchAlternatives: (selectedText: string, context: string, goal: string, count?: number, level?: string, annotations?: AnnotationCues, userInstruction?: string) => void;
  reset: () => void;
}

// --- Hook ---

export function useAlternatives(): UseAlternativesReturn {
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const fetchAlternatives = useCallback(
    (selectedText: string, context: string, goal: string, count?: number, level?: string, annotations?: AnnotationCues, userInstruction?: string) => {
      // Abort previous in-flight request
      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setAlternatives(null);
      setError(null);
      setIsLoading(true);

      fetch('/api/alternatives', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          selectedText, context, goal,
          ...(count != null && { count }),
          ...(level && { level }),
          ...(annotations && { annotations }),
          ...(userInstruction && { userInstruction }),
        }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Failed to fetch alternatives.');
          }

          if (
            !data.alternatives ||
            !Array.isArray(data.alternatives) ||
            data.alternatives.length === 0
          ) {
            throw new Error('No alternatives returned.');
          }

          setAlternatives(data.alternatives);
        })
        .catch((err: unknown) => {
          // Silently ignore aborted requests
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          const message =
            err instanceof Error ? err.message : 'An unexpected error occurred.';
          setError(message);
        })
        .finally(() => {
          // Only update loading if this controller was not replaced
          if (abortControllerRef.current === controller) {
            setIsLoading(false);
          }
        });
    },
    [],
  );

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setAlternatives(null);
    setIsLoading(false);
    setError(null);
  }, []);

  return { alternatives, isLoading, error, fetchAlternatives, reset };
}
