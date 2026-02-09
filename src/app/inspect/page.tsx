'use client';

import { InspectPanel } from '@/components/inspect/InspectPanel';
import { CoWriThinkEditor } from '@/components/editor/CoWriThinkEditor';
import { useRoundAnalysis } from '@/hooks/useRoundAnalysis';
import { useInspectStore } from '@/stores/useInspectStore';
import { useEffect, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Inspect page provides a dedicated view for contribution analysis.
 *
 * This page:
 * - Uses CoWriThinkEditor with all contribution tracking extensions
 * - Sets up round analysis hook for LLM enrichment
 * - Displays the InspectPanel for document-level and segment-level analysis
 * - Enables inspect mode by default
 */
export default function InspectPage() {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleEditorReady = useCallback((ed: Editor) => {
    setEditor(ed);
  }, []);

  // Enable inspect mode by default on this page
  useEffect(() => {
    const toggleInspect = useInspectStore.getState().toggleInspectMode;
    const isInspectMode = useInspectStore.getState().isInspectMode;

    if (!isInspectMode) {
      toggleInspect();
    }

    return () => {
      // Disable inspect mode when leaving the page
      if (useInspectStore.getState().isInspectMode) {
        toggleInspect();
      }
    };
  }, []);

  // Set up round analysis hook
  useRoundAnalysis();

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Loading editor...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Editor section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-8">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
              <CoWriThinkEditor onEditorReady={handleEditorReady} />
            </div>
          </div>
        </div>
      </div>

      {/* Inspect panel */}
      <div className="w-80 flex-shrink-0">
        <InspectPanel editor={editor} />
      </div>
    </div>
  );
}
