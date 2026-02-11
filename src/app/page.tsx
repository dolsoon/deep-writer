'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { useSessionStore } from '@/stores/useSessionStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useLoadingStore } from '@/stores/useLoadingStore';
import { useInspectStore } from '@/stores/useInspectStore';
import { useChatStore } from '@/stores/useChatStore';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { AppHeader } from '@/components/layout/AppHeader';
import { useSettingsStore } from '@/stores/useSettingsStore';
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

type AppState = 'loading' | 'editor';

// --- Component ---

export default function Home() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [showSettings, setShowSettings] = useState(false);
  const [showNewSessionConfirm, setShowNewSessionConfirm] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
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

  // On mount, load existing session or create a new empty one
  useEffect(() => {
    const hasExisting = loadFromStorage();
    if (!hasExisting) {
      initSession('');
    }
    setAppState('editor');
  }, [loadFromStorage, initSession]);

  // Auto-open settings modal only if no client key AND no server key
  useEffect(() => {
    const apiKey = useSettingsStore.getState().openaiApiKey;
    if (apiKey) return;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: { hasServerKey?: boolean }) => {
        if (!data.hasServerKey) {
          setShowSettings(true);
        }
      })
      .catch(() => {
        setShowSettings(true);
      });
  }, []);

  // New session handler -- shows confirmation dialog
  const handleNewSession = useCallback(() => {
    setShowNewSessionConfirm(true);
  }, []);

  // Confirm new session -- clears everything and re-initializes
  const handleConfirmNewSession = useCallback(() => {
    const sessionId = localStorage.getItem('cowrithink-active-session');
    if (sessionId) {
      localStorage.removeItem(`cowrithink-session-${sessionId}`);
    }
    localStorage.removeItem('cowrithink-active-session');
    useChatStore.getState().clearMessages();
    useEditorStore.setState({ activeDiffs: [], textStates: {} });
    initSession('');
    setSessionKey((k) => k + 1);
    setShowNewSessionConfirm(false);
  }, [initSession]);

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

    // Safety: don't replace editor content with empty modified panel content.
    // This prevents losing user text when diff computation fails.
    if (modifiedEditor) {
      const modifiedTextLen = modifiedEditor.state.doc.textContent.length;
      const originalTextLen = editor.state.doc.textContent.length;
      if (modifiedTextLen === 0 && originalTextLen > 0) {
        useEditorStore.getState().resolveAllDiffs('reject');
        updateDiffs(editor, []);
        modifiedEditorRef.current = null;
        return;
      }
    }

    // Detect user edits in modified panel before transferring content.
    if (modifiedEditor) {
      const editedRoundIds = new Set<string>();
      const markType = modifiedEditor.schema.marks.textState;

      if (markType) {
        const aiCharsByRound = new Map<string, number>();
        modifiedEditor.state.doc.descendants((node) => {
          if (!node.isText) return;
          const tsm = node.marks.find((m) => m.type === markType);
          const roundId = tsm?.attrs?.roundId as string | null;
          if (roundId && tsm?.attrs?.state === 'ai-generated') {
            aiCharsByRound.set(roundId, (aiCharsByRound.get(roundId) ?? 0) + (node.text?.length ?? 0));
          }
        });

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
  const { sendMessage } = useChat(editorHandleRef, session?.goal ?? '');

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

  // Get editor instance for components that need it
  const editorInstance = editorHandleRef.current?.getEditor() ?? null;

  // Editor state
  return (
    <div className="flex h-screen flex-col">
      <AppHeader theme={theme} onNewSession={handleNewSession} onToggleTheme={toggleTheme} onOpenSettings={() => setShowSettings(true)} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNewSessionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              New Session
            </h2>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              Are you sure? All current work will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowNewSessionConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmNewSession}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Clear & Start New
              </button>
            </div>
          </div>
        </div>
      )}
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
            <div className={`flex-1 overflow-y-auto bg-slate-50 p-4 md:p-8 dark:bg-gray-950 ${hasPendingDiffs ? 'hidden' : ''}`}>
              <div className="mx-auto max-w-4xl min-h-full bg-white shadow-md border border-gray-200 dark:bg-gray-900 dark:border-gray-800 rounded-lg p-8 md:p-12">
                {isGenerating && <SkeletonPlaceholder />}
                <CoWriThinkEditor
                  key={sessionKey}
                  ref={editorHandleRef}
                  initialContent={session?.documentState ?? ''}
                  onEditorReady={handleEditorReady}
                />
              </div>
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
