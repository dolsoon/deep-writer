'use client';

import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { useLoadingStore } from '@/stores/useLoadingStore';

// --- Types ---

interface PromptBarProps {
  editor?: Editor | null;
  goal?: string;
  onSubmit?: (prompt: string, mode: 'selection' | 'continuation') => void;
  disabled?: boolean;
}

// --- Component ---

export function PromptBar({ editor, onSubmit, disabled }: PromptBarProps) {
  const [prompt, setPrompt] = useState('');
  const isGenerating = useLoadingStore((s) => s.isGenerating);

  const isDisabled = disabled || isGenerating;

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || isDisabled) return;

    // Detect mode from editor selection state
    const mode: 'selection' | 'continuation' =
      editor && !editor.state.selection.empty ? 'selection' : 'continuation';

    onSubmit?.(trimmed, mode);
    setPrompt('');
  }, [prompt, isDisabled, editor, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI to help with your writing..."
          disabled={isDisabled}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:disabled:bg-gray-900 dark:disabled:text-gray-500"
          aria-label="AI prompt input"
        />
        <button
          onClick={handleSubmit}
          disabled={isDisabled || !prompt.trim()}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          aria-label="Send prompt"
        >
          {isGenerating ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
