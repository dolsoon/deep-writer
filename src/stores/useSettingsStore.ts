import { create } from 'zustand';

// --- Constants ---

const STORAGE_KEY = 'cowrithink-settings';

// --- Types ---

interface SettingsState {
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
}

// --- Store ---

export const useSettingsStore = create<SettingsState>((set) => {
  // Load from localStorage on initialization
  let savedKey = '';
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        savedKey = parsed.openaiApiKey ?? '';
      }
    } catch {
      // ignore
    }
  }

  return {
    openaiApiKey: savedKey,
    setOpenaiApiKey: (key: string) => {
      set({ openaiApiKey: key });
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ openaiApiKey: key }));
      }
    },
  };
});
