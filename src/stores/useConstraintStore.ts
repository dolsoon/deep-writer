import { create } from 'zustand';

// --- Types ---

export type ConstraintType = 'positive' | 'keep' | 'negative' | 'delete' | 'context';

export interface Constraint {
  id: string;
  type: ConstraintType;
  text: string;
  from: number;
  to: number;
}

// Cycling: positive ↔ keep, negative ↔ delete
const CYCLE_MAP: Partial<Record<ConstraintType, ConstraintType>> = {
  positive: 'keep',
  keep: 'positive',
  negative: 'delete',
  delete: 'negative',
};

interface ConstraintState {
  constraints: Constraint[];
  addConstraint: (type: ConstraintType, text: string, from: number, to: number) => void;
  cycleConstraint: (id: string) => void;
  removeConstraint: (id: string) => void;
  clearConstraints: () => void;
}

// --- Store ---

let _nextId = 1;

export const useConstraintStore = create<ConstraintState>((set) => ({
  constraints: [],

  addConstraint: (type, text, from, to) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set((state) => {
      // Avoid duplicate: same text
      const exists = state.constraints.some(
        (c) => c.text === trimmed,
      );
      if (exists) return state;

      return {
        constraints: [
          ...state.constraints,
          { id: String(_nextId++), type, text: trimmed, from, to },
        ],
      };
    });
  },

  cycleConstraint: (id) =>
    set((state) => ({
      constraints: state.constraints.map((c) => {
        if (c.id !== id) return c;
        const next = CYCLE_MAP[c.type];
        return next ? { ...c, type: next } : c;
      }),
    })),

  removeConstraint: (id) =>
    set((state) => ({
      constraints: state.constraints.filter((c) => c.id !== id),
    })),

  clearConstraints: () => set({ constraints: [] }),
}));
