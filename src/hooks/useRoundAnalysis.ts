'use client';

import { useEffect, useRef } from 'react';
import { useRoundStore } from '@/stores/useRoundStore';
import { useChatStore } from '@/stores/useChatStore';
import { useConstraintStore } from '@/stores/useConstraintStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import type { RoundAnalysisRequest, RoundAnalysis } from '@/types/contribution';

// --- Constants ---

const MAX_RECENT_CHAT_MESSAGES = 10;
const ANALYZABLE_TYPES = new Set(['generation', 'inline-edit', 'alternative']);
const MIN_INLINE_EDIT_LENGTH = 3;

// --- Helpers ---

function deriveUserPostAction(
  action: string,
): 'accepted' | 'edited' | 'rejected' {
  if (action === 'edited') return 'edited';
  if (action === 'rejected') return 'rejected';
  return 'accepted';
}

// --- Hook ---

export function useRoundAnalysis(): void {
  // Subscribe to graph nodes to trigger analysis when new rounds are added
  const graphNodes = useContributionGraphStore((s) => s.nodes);
  const analyzingRef = useRef(false);
  const attemptedRef = useRef(new Set<string>());

  useEffect(() => {
    if (analyzingRef.current) return;

    const run = async () => {
      analyzingRef.current = true;

      try {
        const nodes = useContributionGraphStore.getState().nodes;

        // Collect unanalyzed nodes (generation + inline-edit)
        const pending: Array<{ roundId: string }> = [];
        for (const [roundId, node] of nodes) {
          if (node.narrative !== null) continue;
          if (!ANALYZABLE_TYPES.has(node.metadata.type)) continue;
          if (attemptedRef.current.has(roundId)) continue;

          // generation/alternative nodes need stored resultText
          // inline-edit nodes derive text from editTrace
          if ((node.metadata.type === 'generation' || node.metadata.type === 'alternative') && !node.metadata.resultText) continue;
          if (node.metadata.type === 'inline-edit') {
            const round = useRoundStore.getState().getRound(roundId);
            if (!round || round.editTrace.length === 0) continue;
            // Skip trivially small edits (e.g., ",", "I'm", "...")
            const totalLen = round.editTrace.reduce(
              (sum, t) => sum + t.original.length + t.replacement.length, 0,
            );
            if (totalLen < MIN_INLINE_EDIT_LENGTH) continue;
          }

          pending.push({ roundId });
        }

        // Sequential analysis to respect rate limits
        for (const { roundId } of pending) {
          attemptedRef.current.add(roundId);

          const node = useContributionGraphStore.getState().nodes.get(roundId);
          if (!node) continue;

          // Collect recent chat history
          const allMessages = useChatStore.getState().messages;
          const recentChat = allMessages
            .slice(-MAX_RECENT_CHAT_MESSAGES)
            .map((msg) => ({ role: msg.role, content: msg.content }));

          // Collect current constraints
          const constraints = useConstraintStore.getState().constraints.map((c) => ({
            type: c.type,
            text: c.text,
          }));

          // Get round metadata and parent IDs
          const round = useRoundStore.getState().getRound(roundId);
          const parentRoundIds = round?.parentRounds ?? [];

          // Derive previousText/resultText based on node type
          let previousText: string;
          let resultText: string;

          if (node.metadata.type === 'inline-edit' && round?.editTrace.length) {
            // For inline-edit: reconstruct from edit traces
            previousText = round.editTrace.map((t) => t.original).filter(Boolean).join(' ');
            resultText = round.editTrace.map((t) => t.replacement).filter(Boolean).join(' ');
          } else {
            // For generation: use stored metadata
            previousText = node.metadata.previousText ?? '';
            resultText = node.metadata.resultText ?? '';
          }

          const payload: RoundAnalysisRequest = {
            roundId,
            actionType: node.metadata.type,
            previousText,
            resultText,
            userPostAction: deriveUserPostAction(node.metadata.action),
            recentChatHistory: recentChat,
            userConstraints: constraints,
            parentRoundIds,
          };

          try {
            const res = await fetch('/api/analyze-round', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (!res.ok) {
              console.warn(`Round analysis failed for ${roundId}: ${res.statusText}`);
              continue;
            }

            const analysis: RoundAnalysis = await res.json();
            useContributionGraphStore.getState().updateNodeWithAnalysis(roundId, analysis);
          } catch (err) {
            console.warn(`Round analysis error for ${roundId}:`, err);
          }
        }
      } finally {
        analyzingRef.current = false;
      }
    };

    run();
  }, [graphNodes]);
}
