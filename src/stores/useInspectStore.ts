import { create } from 'zustand';
import type { SelectedSegment } from '@/types/contribution';
import type { Dimension } from '@/types/contribution';

// --- Types ---

export type ComparisonView = 'actual' | 'user';

interface InspectState {
  isInspectMode: boolean;
  isHighlightMode: boolean;
  selectedSegment: SelectedSegment | null;
  hoveredDimension: Dimension | null;
  comparisonView: ComparisonView;
}

interface InspectActions {
  toggleInspectMode: () => void;
  toggleHighlightMode: () => void;
  setSelectedSegment: (segment: SelectedSegment) => void;
  clearSelectedSegment: () => void;
  setHoveredDimension: (dim: Dimension | null) => void;
  clearHoveredDimension: () => void;
  setComparisonView: (view: ComparisonView) => void;
  toggleComparisonView: () => void;
}

type InspectStore = InspectState & InspectActions;

// --- Store ---

export const useInspectStore = create<InspectStore>()((set) => ({
  isInspectMode: false,
  isHighlightMode: false,
  selectedSegment: null,
  hoveredDimension: null,
  comparisonView: 'actual' as ComparisonView,

  toggleInspectMode: () => {
    set((state) => ({
      isInspectMode: !state.isInspectMode,
      selectedSegment: !state.isInspectMode ? state.selectedSegment : null,
      hoveredDimension: !state.isInspectMode ? state.hoveredDimension : null,
    }));
  },

  toggleHighlightMode: () => {
    set((state) => ({
      isHighlightMode: !state.isHighlightMode,
      comparisonView: !state.isHighlightMode ? state.comparisonView : 'actual',
    }));
  },

  setSelectedSegment: (segment) => {
    set({ selectedSegment: segment });
  },

  clearSelectedSegment: () => {
    set({ selectedSegment: null });
  },

  setHoveredDimension: (dim) => {
    set({ hoveredDimension: dim });
  },

  clearHoveredDimension: () => {
    set({ hoveredDimension: null });
  },

  setComparisonView: (view) => {
    set({ comparisonView: view });
  },

  toggleComparisonView: () => {
    set((state) => ({
      comparisonView: state.comparisonView === 'actual' ? 'user' : 'actual',
    }));
  },
}));
