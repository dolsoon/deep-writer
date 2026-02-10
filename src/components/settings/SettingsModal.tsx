'use client';

import { useState } from 'react';
import { useSettingsStore } from '@/stores/useSettingsStore';

// --- Types ---

interface SettingsModalProps {
  onClose: () => void;
}

// --- Component ---

export function SettingsModal({ onClose }: SettingsModalProps) {
  const currentKey = useSettingsStore((s) => s.openaiApiKey);
  const setOpenaiApiKey = useSettingsStore((s) => s.setOpenaiApiKey);
  const [keyValue, setKeyValue] = useState(currentKey);
  const [showKey, setShowKey] = useState(false);

  const hasSavedKey = currentKey.length > 0;

  const handleSave = () => {
    setOpenaiApiKey(keyValue.trim());
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">
          Settings
        </h2>

        <label
          htmlFor="openai-api-key"
          className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          OpenAI API Key
          {hasSavedKey && (
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40"
              title="API key saved"
            >
              <svg className="h-2.5 w-2.5 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
        </label>
        <div className="relative mb-4">
          <input
            id="openai-api-key"
            type={showKey ? 'text' : 'password'}
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border border-gray-300 bg-gray-50 p-3 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            aria-label="OpenAI API Key"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Your API key is stored locally in your browser and never sent to our servers.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
