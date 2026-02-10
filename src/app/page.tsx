'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { useSessionStore } from '@/stores/useSessionStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useLoadingStore } from '@/stores/useLoadingStore';
import { useInspectStore } from '@/stores/useInspectStore';
import { GoalModal } from '@/components/goal/GoalModal';
import { StartModeSelector } from '@/components/goal/StartModeSelector';
import { AppHeader } from '@/components/layout/AppHeader';
import { SplitLayout } from '@/components/layout/SplitLayout';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { InspectPanel } from '@/components/inspect/InspectPanel';
import { useChat } from '@/hooks/useChat';
import {
  CoWriThinkEditor,
  type CoWriThinkEditorHandle,
} from '@/components/editor/CoWriThinkEditor';
import { SkeletonPlaceholder } from '@/components/editor/SkeletonPlaceholder';
import { StorageWarning } from '@/components/shared/StorageWarning';
import { DiffToolbar } from '@/components/editor/DiffToolbar';
import { DiffSplitView } from '@/components/editor/DiffSplitView';
import { useGeneration } from '@/hooks/useGeneration';
import { useRoundAnalysis } from '@/hooks/useRoundAnalysis';
import { useTheme } from '@/hooks/useTheme';
import { applyAllDiffs, cleanStaleTextStateMarks } from '@/lib/diffCompute';
import { updateDiffs } from '@/extensions/DiffDecorationPlugin';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { computeD3Base } from '@/lib/scoring';

// --- Types ---

type AppState = 'loading' | 'goal-prompt' | 'mode-select' | 'editor';

// --- Component ---

export default function Home() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [goal, setGoal] = useState('');
  const editorHandleRef = useRef<CoWriThinkEditorHandle>(null);
  const [readyEditor, setReadyEditor] = useState<Editor | null>(null);

  const handleEditorReady = useCallback((ed: Editor) => {
    setReadyEditor(ed);
  }, []);

  // LLM round analysis — enriches base heuristic scores with rubric-based evaluation
  useRoundAnalysis();

  const session = useSessionStore((s) => s.session);
  const initSession = useSessionStore((s) => s.initSession);
  const loadFromStorage = useSessionStore((s) => s.loadFromStorage);
  const isGenerating = useLoadingStore((s) => s.isGenerating);
  const isInspectMode = useInspectStore((s) => s.isInspectMode);

  const generation = useGeneration();
  const { theme, toggleTheme } = useTheme();
  const activeDiffs = useEditorStore((s) => s.activeDiffs);
  const pendingDiffs = useMemo(() => activeDiffs.filter((d) => d.state === 'pending'), [activeDiffs]);
  const hasPendingDiffs = pendingDiffs.length > 0;

  // On mount, try to load session from localStorage
  useEffect(() => {
    const hasExisting = loadFromStorage();
    if (hasExisting) {
      setGoal(useSessionStore.getState().session?.goal ?? '');
      setAppState('editor');
    } else {
      setAppState('goal-prompt');
    }
  }, [loadFromStorage]);

  // Goal submission handler
  const handleGoalSubmit = useCallback((submittedGoal: string) => {
    setGoal(submittedGoal);
    setAppState('mode-select');
  }, []);

  // Start from scratch handler
  const handleStartFromScratch = useCallback(() => {
    initSession(goal);
    setAppState('editor');
  }, [goal, initSession]);

  // Generate first draft handler
  const handleGenerateFirstDraft = useCallback(() => {
    initSession(goal);
    setAppState('editor');
    // Trigger AI first-draft generation after editor mounts
    setTimeout(() => {
      const editor = editorHandleRef.current?.getEditor();
      if (editor) {
        const currentGoal = useSessionStore.getState().session?.goal ?? goal;
        generation.promptRequest(editor, currentGoal, 'Write a first draft based on the writing goal.');
      }
    }, 100);
  }, [goal, initSession, generation]);

  // Goal edit handler (from header)
  const handleGoalEdit = useCallback(() => {
    // Side panel goal section has its own edit button for direct editing
  }, []);

  // New session handler -- clears localStorage and resets to goal prompt
  const handleNewSession = useCallback(() => {
    const sessionId = localStorage.getItem('cowrithink-active-session');
    if (sessionId) {
      localStorage.removeItem(`cowrithink-session-${sessionId}`);
    }
    localStorage.removeItem('cowrithink-active-session');
    setGoal('');
    setAppState('goal-prompt');
  }, []);

  // Track the modified panel's editor so Accept All uses user-edited content
  const modifiedEditorRef = useRef<import('@tiptap/core').Editor | null>(null);
  const handleModifiedEditorReady = useCallback((ed: import('@tiptap/core').Editor) => {
    modifiedEditorRef.current = ed;
  }, []);

  // Accept all diffs handler -- takes content from the modified panel (includes user edits)
  const handleAcceptAll = useCallback(() => {
    const editor = editorHandleRef.current?.getEditor();
    const modifiedEditor = modifiedEditorRef.current;
    if (!editor) return;

    // Detect user edits in modified panel before transferring content.
    // For each diff with a roundId, count how many characters still carry
    // that roundId's ai-generated mark. If fewer than the original replacement
    // text length, the user edited that round's text.
    if (modifiedEditor) {
      const editedRoundIds = new Set<string>();
      const markType = modifiedEditor.schema.marks.textState;

      if (markType) {
        // Count remaining ai-generated chars per roundId
        const aiCharsByRound = new Map<string, number>();
        modifiedEditor.state.doc.descendants((node) => {
          if (!node.isText) return;
          const tsm = node.marks.find((m) => m.type === markType);
          const roundId = tsm?.attrs?.roundId as string | null;
          if (roundId && tsm?.attrs?.state === 'ai-generated') {
            aiCharsByRound.set(roundId, (aiCharsByRound.get(roundId) ?? 0) + (node.text?.length ?? 0));
          }
        });

        // Compare against original replacement text lengths
        for (const diff of pendingDiffs) {
          if (!diff.roundId) continue;
          const remaining = aiCharsByRound.get(diff.roundId) ?? 0;
          if (remaining < diff.replacementText.length) {
            editedRoundIds.add(diff.roundId);
          }
        }
      }

      const modifiedJSON = modifiedEditor.getJSON();

      // Mark as programmatic to prevent TextStateExtension from overwriting marks
      editor.chain().setMeta('programmaticTextState', true).setContent(modifiedJSON).run();

      // Update D3 scores for rounds where user edited the AI text
      const graphStore = useContributionGraphStore.getState();
      for (const roundId of editedRoundIds) {
        const node = graphStore.getNode(roundId);
        if (node && node.metadata.action === 'accepted') {
          graphStore.addNode(roundId, {
            ...node.scores,
            d3: computeD3Base('edited'),
          }, { ...node.metadata, action: 'edited' });
        }
      }
    } else {
      applyAllDiffs(editor, pendingDiffs);
    }

    // Clean up only stale marks (marked-delete, original-removed), preserving contribution tracking
    cleanStaleTextStateMarks(editor);

    useEditorStore.getState().resolveAllDiffs('accept');
    updateDiffs(editor, []);
    modifiedEditorRef.current = null;
  }, [pendingDiffs]);

  // Reject all diffs handler
  const handleRejectAll = useCallback(() => {
    const editor = editorHandleRef.current?.getEditor();
    if (!editor) return;
    useEditorStore.getState().resolveAllDiffs('reject');
    updateDiffs(editor, []);
  }, []);

  // Chat hook
  const { sendMessage } = useChat(editorHandleRef, session?.goal ?? goal);

  // Loading state
  if (appState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" role="status">
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  // Goal prompt state
  if (appState === 'goal-prompt') {
    return <GoalModal onSubmit={handleGoalSubmit} />;
  }

  // Mode select state
  if (appState === 'mode-select') {
    return (
      <StartModeSelector
        goal={goal}
        onStartFromScratch={handleStartFromScratch}
        onGenerateFirstDraft={handleGenerateFirstDraft}
      />
    );
  }

  // Get editor instance for components that need it
  const editorInstance = editorHandleRef.current?.getEditor() ?? null;

  // Editor state
  return (
    <div className="flex h-screen flex-col">
      <AppHeader goal={session?.goal} theme={theme} onGoalEdit={handleGoalEdit} onNewSession={handleNewSession} onToggleTheme={toggleTheme} />
      {generation.error && (
        <div className="flex items-center justify-between bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <span>{generation.error}</span>
          <button
            onClick={generation.clearError}
            className="ml-2 text-red-500 underline hover:text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}
      <SplitLayout
        editor={
          <div className="flex h-full flex-col">
            <div className="px-4 pt-2">
              <StorageWarning />
            </div>
            {hasPendingDiffs && editorInstance ? (
              <>
                <DiffToolbar
                  diffCount={pendingDiffs.length}
                  onAcceptAll={handleAcceptAll}
                  onRejectAll={handleRejectAll}
                />
                <DiffSplitView
                  editor={editorInstance}
                  pendingDiffs={pendingDiffs}
                  onModifiedEditorReady={handleModifiedEditorReady}
                />
              </>
            ) : null}
            <div className={`flex-1 overflow-y-auto bg-white px-8 py-6 dark:bg-gray-900 ${hasPendingDiffs ? 'hidden' : ''}`}>
              {isGenerating && <SkeletonPlaceholder />}
              <CoWriThinkEditor
                ref={editorHandleRef}
                initialContent={session?.documentState ?? ''}
                onEditorReady={handleEditorReady}
              />
            </div>
          </div>
        }
        sidePanel={
          isInspectMode && readyEditor ? (
            <InspectPanel editor={readyEditor} />
          ) : (
            <ChatPanel
              onSendMessage={sendMessage}
              disabled={hasPendingDiffs}
            />
          )
        }
      />
    </div>
  );
}
