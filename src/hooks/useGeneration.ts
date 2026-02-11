import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorStore } from '@/stores/useEditorStore';
import { useLoadingStore } from '@/stores/useLoadingStore';
import { useProvenanceStore } from '@/stores/useProvenanceStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useRoundStore } from '@/stores/useRoundStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { useConstraintStore } from '@/stores/useConstraintStore';
import { updateDiffs } from '@/extensions/DiffDecorationPlugin';
import { computeD1Base, computeD2Base, computeD3Base } from '@/lib/scoring';
import type { EventType } from '@/types';
import {
  scanDocument,
  buildRequest,
  buildSmartEditRequest,
  callGenerateAPI,
  GenerationError,
} from '@/services/generation';
import type { GapBasedResponse, SmartEditResponse } from '@/types/generation';
import { computeSmartEditDiffs } from '@/lib/diffCompute';

// --- Types ---

export type GenerationStatus = 'idle' | 'loading' | 'error' | 'complete';

export interface GenerationState {
  status: GenerationStatus;
  error: string | null;
  retryable: boolean;
}

// --- Helpers ---

function logProvenance(type: EventType, data: Record<string, unknown>) {
  const event = useProvenanceStore.getState().logEvent(type, data);
  useSessionStore.getState().addProvenanceEvent(event);
}

/**
 * Collect unique, non-null roundId values from textState marks in a document range.
 */
function collectRoundIds(editor: Editor, from: number, to: number): string[] {
  const roundIds = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const textStateMark = node.marks.find((m) => m.type.name === 'textState');
    if (textStateMark?.attrs?.roundId) {
      roundIds.add(textStateMark.attrs.roundId as string);
    }
  });
  return Array.from(roundIds);
}

// --- Hook ---

export function useGeneration() {
  const [state, setState] = useState<GenerationState>({
    status: 'idle',
    error: null,
    retryable: false,
  });

  /**
   * Execute the regeneration flow: scan document, call API, apply diffs.
   * Used by the Regenerate button.
   */
  const regenerate = useCallback(async (editor: Editor, goal: string) => {
    setState({ status: 'loading', error: null, retryable: false });
    useLoadingStore.getState().startGeneration();
    useEditorStore.getState().setReadOnly(true);

    try {
      // Scan document for gaps and constraints
      const scan = scanDocument(editor);

      if (scan.gaps.length === 0) {
        setState({ status: 'idle', error: null, retryable: false });
        useLoadingStore.getState().stopGeneration();
        useEditorStore.getState().setReadOnly(false);
        return;
      }

      // Log request provenance
      logProvenance('ai-generation-requested', {
        gapCount: scan.gaps.length,
        constraintCount: scan.constraints.length,
        mode: 'regenerate',
      });

      // Build request and call API
      const request = buildRequest(goal, scan, 'regenerate');
      const response = await callGenerateAPI(request) as GapBasedResponse;

      // Collect parentRounds from gaps being replaced
      const parentRoundIds: string[] = [];
      for (const gap of scan.gaps) {
        const ids = collectRoundIds(editor, gap.position.from, gap.position.from + gap.originalText.length);
        for (const id of ids) {
          if (!parentRoundIds.includes(id)) parentRoundIds.push(id);
        }
      }

      // Get constraint info
      const constraintState = useConstraintStore.getState();
      const constraintTypes = [...new Set(constraintState.constraints.map(c => c.type))];

      // Create round
      const round = useRoundStore.getState().createRound({
        type: 'generation',
        parentRounds: parentRoundIds,
        prompt: goal,
        promptLength: goal.length,
        constraintCount: constraintState.constraints.length,
        constraintTypes,
        generationMode: 'regenerate',
        diffActions: { accepted: 0, rejected: 0, edited: 0 },
        events: [],
      });

      // Create graph node with base scores
      const d1 = computeD1Base('ai-generated', 'generation');
      const d2 = computeD2Base({
        promptLength: goal.length,
        constraintCount: constraintState.constraints.length,
        type: 'generation',
      });
      const d3 = computeD3Base('accepted');
      const previousText = scan.gaps.map((g) => g.originalText).join('\n\n');
      const resultText = response.gaps
        .filter((gf) => scan.gaps.some((g) => g.id === gf.id))
        .map((gf) => gf.text)
        .join('\n\n');
      useContributionGraphStore.getState().addNode(round.roundId, { d1, d2, d3 }, {
        prompt: goal,
        constraints: constraintTypes,
        action: 'accepted',
        type: 'generation',
        previousText,
        resultText,
      });

      // Apply gap fills as diffs
      for (const gapFill of response.gaps) {
        const matchingGap = scan.gaps.find((g) => g.id === gapFill.id);
        if (matchingGap) {
          useEditorStore.getState().addDiff(
            matchingGap.originalText,
            gapFill.text,
            matchingGap.position.from,
            round.roundId,
          );
        }
      }

      // Update diff decorations
      const activeDiffs = useEditorStore.getState().getActiveDiffs();
      updateDiffs(editor, activeDiffs);

      // Log response provenance
      logProvenance('ai-generation-received', {
        gapCount: response.gaps.length,
        mode: 'regenerate',
      });

      setState({ status: 'complete', error: null, retryable: false });
    } catch (err) {
      const message = err instanceof GenerationError
        ? err.message
        : 'An unexpected error occurred. Please try again.';
      const retryable = err instanceof GenerationError ? err.retryable : true;

      setState({ status: 'error', error: message, retryable });
    } finally {
      useLoadingStore.getState().stopGeneration();
      useEditorStore.getState().setReadOnly(false);
    }
  }, []);

  /**
   * Execute a smart-edit request: send full document + editing instruction,
   * receive edited document, compute diff, and apply as diffs.
   * Used by the Chat component for edit intent.
   */
  const smartEditRequest = useCallback(async (
    editor: Editor,
    goal: string,
    promptText: string,
  ) => {
    setState({ status: 'loading', error: null, retryable: false });
    useLoadingStore.getState().startGeneration();
    useEditorStore.getState().setReadOnly(true);

    try {
      // 1. Save original document
      const originalText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n');

      // 2. Build request and call API
      const request = buildSmartEditRequest(editor, goal, promptText);

      // Log provenance
      logProvenance('ai-generation-requested', {
        mode: 'smart-edit',
        userRequest: promptText,
        documentLength: originalText.length,
      });

      const response = await callGenerateAPI(request) as SmartEditResponse;

      // 3. Check if document changed
      if (originalText === response.editedDocument) {
        // No changes - success but nothing to show
        setState({ status: 'complete', error: null, retryable: false });
        useLoadingStore.getState().stopGeneration();
        useEditorStore.getState().setReadOnly(false);
        return;
      }

      // 4. Create round (provenance tracking)
      const constraintState = useConstraintStore.getState();
      const constraintTypes = [...new Set(constraintState.constraints.map(c => c.type))];

      const round = useRoundStore.getState().createRound({
        type: 'generation',
        parentRounds: [],
        prompt: promptText,
        promptLength: promptText.length,
        constraintCount: constraintState.constraints.length,
        constraintTypes,
        generationMode: 'smart-edit',
        diffActions: { accepted: 0, rejected: 0, edited: 0 },
        events: [],
      });

      // 5. Create graph node with base scores
      const d1 = computeD1Base('ai-generated', 'generation');
      const d2 = computeD2Base({
        promptLength: promptText.length,
        constraintCount: constraintState.constraints.length,
        type: 'generation',
      });
      const d3 = computeD3Base('accepted');
      useContributionGraphStore.getState().addNode(round.roundId, { d1, d2, d3 }, {
        prompt: promptText,
        constraints: constraintTypes,
        action: 'accepted',
        type: 'generation',
        previousText: originalText,
        resultText: response.editedDocument,
      });

      // 6. Compute individual diffs for changed parts only
      const smartDiffs = computeSmartEditDiffs(editor, originalText, response.editedDocument);

      if (smartDiffs.length > 0) {
        // Apply each changed part as a separate diff
        for (const diff of smartDiffs) {
          useEditorStore.getState().addDiff(
            diff.originalText,
            diff.replacementText,
            diff.position,
            round.roundId,
          );
        }
      } else {
        // Fallback: entire document as single diff.
        // Use actual ProseMirror positions instead of relying on text length,
        // because plain-text length may not match PM position span.
        const docSize = editor.state.doc.content.size;
        const firstPos = 1; // first content position inside the first block
        const endPos = Math.max(firstPos, docSize - 1); // last content position before doc closing
        console.warn('[FALLBACK] Using entire document as single diff, range:', firstPos, '-', endPos);
        useEditorStore.getState().addDiff(
          originalText,
          response.editedDocument,
          firstPos,
          round.roundId,
          endPos,
        );
      }

      // 8. Update diff UI
      const activeDiffs = useEditorStore.getState().getActiveDiffs();
      updateDiffs(editor, activeDiffs);

      // Log response provenance
      logProvenance('ai-generation-received', {
        mode: 'smart-edit',
        changeCount: smartDiffs.length || 1,
        userRequest: promptText,
      });

      setState({ status: 'complete', error: null, retryable: false });
    } catch (err) {
      const message = err instanceof GenerationError
        ? err.message
        : 'An unexpected error occurred. Please try again.';
      const retryable = err instanceof GenerationError ? err.retryable : true;

      setState({ status: 'error', error: message, retryable });
    } finally {
      useLoadingStore.getState().stopGeneration();
      useEditorStore.getState().setReadOnly(false);
    }
  }, []);

  /**
   * Clear the error state and return to idle.
   */
  const clearError = useCallback(() => {
    setState({ status: 'idle', error: null, retryable: false });
  }, []);

  return {
    ...state,
    regenerate,
    smartEditRequest,
    clearError,
  };
}
