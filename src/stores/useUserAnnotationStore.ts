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
  annotationRanges: Array<{ from: number; to: number; level: number }>;
}

interface UserAnnotationActions {
  toggleAnnotationMode: () => void;
  setActiveTool: (tool: 'highlight' | 'eraser') => void;
  setSelectedLevel: (level: AnnotationLevel) => void;
  setHasAnnotations: (has: boolean) => void;
  setAnnotationRanges: (ranges: Array<{ from: number; to: number; level: number }>) => void;
}

type UserAnnotationStore = UserAnnotationState & UserAnnotationActions;

// --- Store ---

export const useUserAnnotationStore = create<UserAnnotationStore>()((set) => ({
  isAnnotationMode: false,
  activeTool: 'highlight',
  selectedLevel: 2,
  hasAnnotations: false,
  annotationRanges: [],

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

  setAnnotationRanges: (ranges) => {
    set({ annotationRanges: ranges, hasAnnotations: ranges.length > 0 });
  },
}));
