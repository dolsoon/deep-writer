'use client';

import { GoalDisplay } from '@/components/goal/GoalDisplay';
import { ExportButton } from '@/components/shared/ExportButton';
import { useInspectStore } from '@/stores/useInspectStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

// --- Types ---

interface AppHeaderProps {
  goal?: string;
  theme?: 'light' | 'dark';
  onGoalEdit?: () => void;
  onNewSession?: () => void;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
}

// --- Component ---

export function AppHeader({ goal, theme, onGoalEdit, onNewSession, onToggleTheme, onOpenSettings }: AppHeaderProps) {
  const isInspectMode = useInspectStore((s) => s.isInspectMode);
  const toggleInspectMode = useInspectStore((s) => s.toggleInspectMode);
  const isHighlightMode = useInspectStore((s) => s.isHighlightMode);
  const toggleHighlightMode = useInspectStore((s) => s.toggleHighlightMode);
  const hasApiKey = useSettingsStore((s) => s.openaiApiKey.length > 0);

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex w-full items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          CoWriThink
        </h1>

        {goal && (
          <div className="ml-4 flex-1">
            <GoalDisplay goal={goal} onEdit={onGoalEdit} />
          </div>
        )}

        <div className="ml-4 flex shrink-0 items-center gap-2">
          <button
            onClick={toggleHighlightMode}
            className="group flex items-center gap-1.5 rounded-lg border border-gray-300 px-2 py-1 text-xs transition-colors hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            aria-label={isHighlightMode ? 'Hide reliance highlights' : 'Show reliance highlights'}
            aria-pressed={isHighlightMode}
          >
            <span className={isHighlightMode ? 'text-purple-700 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'}>
              Highlight
            </span>
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                isHighlightMode
                  ? 'bg-purple-500 dark:bg-purple-600'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  isHighlightMode ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
          <button
            onClick={toggleInspectMode}
            className={
              isInspectMode
                ? 'rounded-lg border border-blue-300 bg-blue-50 p-1.5 text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50'
                : 'rounded-lg border border-gray-300 p-1.5 text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
            }
            title="Inspect Mode"
            aria-label={isInspectMode ? 'Exit inspect mode' : 'Toggle inspect mode'}
            aria-pressed={isInspectMode}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="relative rounded-lg border border-gray-300 p-1.5 text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Settings"
              aria-label="Open settings"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              {hasApiKey && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500" />
              )}
            </button>
          )}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className="rounded-lg border border-gray-300 p-1.5 text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              title="Night Mode"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
          )}
          {onNewSession && (
            <button
              onClick={onNewSession}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              New Session
            </button>
          )}
          <ExportButton />
        </div>
      </div>
    </header>
  );
}
