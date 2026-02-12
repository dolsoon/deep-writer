import { create } from 'zustand';

// --- Types ---

export type AnnotationLevel = 1 | 2 | 3;

export const ANNOTATION_LEVEL_LABELS: Record<AnnotationLevel, string> = {
  1: 'Slightly AI',
  2: 'Moderately AI',
  3: 'Mostly AI',
};

interface UserAnnotationState {
  isAnnotationMode: boolean;
  activeTool: 'highlight' | 'eraser';
  selectedLevel: AnnotationLevel;
  hasAnnotations: boolean;
}

interface UserAnnotationActions {
  toggleAnnotationMode: () => void;
  setActiveTool: (tool: 'highlight' | 'eraser') => void;
  setSelectedLevel: (level: AnnotationLevel) => void;
  setHasAnnotations: (has: boolean) => void;
}

type UserAnnotationStore = UserAnnotationState & UserAnnotationActions;

// --- Store ---

export const useUserAnnotationStore = create<UserAnnotationStore>()((set) => ({
  isAnnotationMode: false,
  activeTool: 'highlight',
  selectedLevel: 2,
  hasAnnotations: false,

  toggleAnnotationMode: () => {
    set((state) => ({
      isAnnotationMode: !state.isAnnotationMode,
      activeTool: !state.isAnnotationMode ? 'highlight' : state.activeTool,
    }));
  },

  setActiveTool: (tool) => {
    set({ activeTool: tool });
  },

  setSelectedLevel: (level) => {
    set({ selectedLevel: level, activeTool: 'highlight' });
  },

  setHasAnnotations: (has) => {
    set({ hasAnnotations: has });
  },
}));
