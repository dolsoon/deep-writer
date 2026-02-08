'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useLoadingStore } from '@/stores/useLoadingStore';
import { useInspectStore } from '@/stores/useInspectStore';
import { GoalModal } from '@/components/goal/GoalModal';
import { StartModeSelector } from '@/components/goal/StartModeSelector';
import { AppHeader } from '@/components/layout/AppHeader';
import { SplitLayout } from '@/components/layout/SplitLayout';
import { ChatPanel } from '@/components/chat/ChatPanel';
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
import { useTheme } from '@/hooks/useTheme';
import { applyAllDiffs } from '@/lib/diffCompute';
import { updateDiffs } from '@/extensions/DiffDecorationPlugin';

// --- Types ---

type AppState = 'loading' | 'goal-prompt' | 'mode-select' | 'editor';

// --- Component ---

export default function Home() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [goal, setGoal] = useState('');
  const editorHandleRef = useRef<CoWriThinkEditorHandle>(null);

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

    if (modifiedEditor) {
      editor.commands.setContent(modifiedEditor.getJSON());
    } else {
      applyAllDiffs(editor, pendingDiffs);
    }

    // Clean up stale marks (marked-delete, original-removed) from accepted doc
    editor.commands.unsetMark('textState');

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
              />
            </div>
          </div>
        }
        sidePanel={
          isInspectMode ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              <div>
                <svg className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <p className="font-medium text-gray-700 dark:text-gray-300">Inspect Mode</p>
                <p className="mt-1">Contribution details panel coming soon.</p>
              </div>
            </div>
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
