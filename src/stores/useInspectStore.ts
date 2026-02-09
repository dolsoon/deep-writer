import { create } from 'zustand';
import type { SelectedSegment } from '@/types/contribution';

// --- Types ---

interface InspectState {
  isInspectMode: boolean;
  selectedSegment: SelectedSegment | null;
}

interface InspectActions {
  toggleInspectMode: () => void;
  setSelectedSegment: (segment: SelectedSegment) => void;
  clearSelectedSegment: () => void;
}

type InspectStore = InspectState & InspectActions;

// --- Store ---

export const useInspectStore = create<InspectStore>()((set) => ({
  isInspectMode: false,
  selectedSegment: null,

  toggleInspectMode: () => {
    set((state) => ({
      isInspectMode: !state.isInspectMode,
      selectedSegment: !state.isInspectMode ? state.selectedSegment : null,
    }));
  },

  setSelectedSegment: (segment) => {
    set({ selectedSegment: segment });
  },

  clearSelectedSegment: () => {
    set({ selectedSegment: null });
  },
}));
