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
  buildPromptBarRequest,
  callGenerateAPI,
  GenerationError,
} from '@/services/generation';

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
      const response = await callGenerateAPI(request);

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
      console.log('[DEBUG] 라운드 생성 전...');
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
      console.log('[DEBUG] 라운드 생성 완료:', {
        roundId: round.roundId,
        hasRoundId: !!round.roundId,
        type: typeof round.roundId
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
   * Execute a prompt bar request: selection replacement or cursor continuation.
   * Used by the PromptBar component.
   */
  const promptRequest = useCallback(async (
    editor: Editor,
    goal: string,
    promptText: string,
  ) => {
    const { selection } = editor.state;
    const mode = selection.empty ? 'continuation' : 'selection';

    setState({ status: 'loading', error: null, retryable: false });
    useLoadingStore.getState().startGeneration();
    useEditorStore.getState().setReadOnly(true);

    try {
      const request = buildPromptBarRequest(editor, goal, promptText, mode);

      // Log provenance
      logProvenance('ai-generation-requested', {
        mode,
        userRequest: promptText,
        selectionFrom: selection.from,
        selectionTo: selection.to,
      });

      const response = await callGenerateAPI(request);

      // Collect parentRounds from selection range
      const parentRoundIds = selection.empty ? [] : collectRoundIds(editor, selection.from, selection.to);

      // Get constraint info
      const constraintState = useConstraintStore.getState();
      const constraintTypes = [...new Set(constraintState.constraints.map(c => c.type))];

      // Create round
      const round = useRoundStore.getState().createRound({
        type: 'generation',
        parentRounds: parentRoundIds,
        prompt: promptText,
        promptLength: promptText.length,
        constraintCount: constraintState.constraints.length,
        constraintTypes,
        generationMode: mode,
        diffActions: { accepted: 0, rejected: 0, edited: 0 },
        events: [],
      });

      // Create graph node with base scores
      const d1 = computeD1Base('ai-generated', 'generation');
      const d2 = computeD2Base({
        promptLength: promptText.length,
        constraintCount: constraintState.constraints.length,
        type: 'generation',
      });
      const d3 = computeD3Base('accepted');
      const previousText = mode === 'selection' && request.gaps[0]
        ? request.gaps[0].originalText
        : '';
      const resultText = response.gaps[0]?.text ?? '';
      useContributionGraphStore.getState().addNode(round.roundId, { d1, d2, d3 }, {
        prompt: promptText,
        constraints: constraintTypes,
        action: 'accepted',
        type: 'generation',
        previousText,
        resultText,
      });

      if (mode === 'selection' && response.gaps.length > 0) {
        // Apply as diff for selection mode
        const gap = request.gaps[0];
        const gapFill = response.gaps[0];
        useEditorStore.getState().addDiff(
          gap.originalText,
          gapFill.text,
          gap.position.from,
          round.roundId,
        );
        const activeDiffs = useEditorStore.getState().getActiveDiffs();
        updateDiffs(editor, activeDiffs);
      } else if (mode === 'continuation' && response.gaps.length > 0) {
        // Insert text at cursor position for continuation mode
        const gapFill = response.gaps[0];
        const cursorPos = selection.from;

        // Split on double newlines to create proper paragraph structure
        const paragraphs = gapFill.text.split(/\n\n+/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);

        if (paragraphs.length <= 1) {
          // Single paragraph - use simple insertText with mark
          const text = (paragraphs[0] ?? gapFill.text).trim();
          const { tr } = editor.state;
          tr.insertText(text, cursorPos);

          const markType = editor.schema.marks.textState;
          if (markType) {
            tr.addMark(
              cursorPos,
              cursorPos + text.length,
              markType.create({ state: 'ai-generated', roundId: round.roundId }),
            );
            console.log('[DEBUG] 마크 생성 속성:', {
              state: 'ai-generated',
              roundId: round.roundId,
              roundIdType: typeof round.roundId,
              roundIdNull: round.roundId === null,
              roundIdUndefined: round.roundId === undefined
            });
            console.log('[DEBUG] 마크 적용 완료:', {
              roundId: round.roundId,
              from: cursorPos,
              to: cursorPos + text.length,
              textLength: text.length
            });
          } else {
            console.error('[DEBUG] ❌ textState markType을 찾을 수 없습니다!');
          }
          tr.setMeta('programmaticTextState', true);
          editor.view.dispatch(tr);
        } else {
          // Multiple paragraphs - insert as structured content with proper <p> nodes
          const content = paragraphs.map(text => ({
            type: 'paragraph' as const,
            content: [{
              type: 'text' as const,
              text,
              marks: [{ type: 'textState', attrs: { state: 'ai-generated', roundId: round.roundId } }],
            }],
          }));
          console.log('[DEBUG] 다중 문단 삽입:', {
            roundId: round.roundId,
            paragraphCount: paragraphs.length,
            totalChars: paragraphs.join('').length
          });
          editor.chain().insertContentAt(cursorPos, content).run();
        }

        // Verify marks were applied
        setTimeout(() => {
          let foundMarks = 0;
          let foundRoundId = false;
          editor.state.doc.descendants((node) => {
            if (node.isText) {
              const textStateMark = node.marks.find(m => m.type.name === 'textState');
              if (textStateMark) {
                foundMarks++;
                if (textStateMark.attrs.roundId === round.roundId) {
                  foundRoundId = true;
                }
              }
            }
          });
          console.log('[DEBUG] 마크 검증:', {
            roundId: round.roundId,
            foundMarks,
            foundRoundId: foundRoundId ? '✅' : '❌'
          });
        }, 100);
      }

      // Log response provenance
      logProvenance('ai-generation-received', {
        mode,
        gapCount: response.gaps.length,
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
    promptRequest,
    clearError,
  };
}
