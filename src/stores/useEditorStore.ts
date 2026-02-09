import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { TextState, DiffEntry } from '@/types';
import { TEXT_STATE_TRANSITIONS } from '@/types';

// --- Types ---

interface EditorState {
  textStates: Record<string, TextState>;
  activeDiffs: DiffEntry[];
  isReadOnly: boolean;
}

interface EditorActions {
  setTextState: (segmentId: string, state: TextState) => boolean;
  getTextState: (segmentId: string) => TextState | undefined;
  addDiff: (originalText: string, replacementText: string, position: number, roundId?: string | null) => string;
  resolveDiff: (diffId: string, action: 'accept' | 'reject' | 'restore') => DiffEntry | undefined;
  getActiveDiffs: () => DiffEntry[];
  resolveAllDiffs: (action: 'accept' | 'reject') => DiffEntry[];
  setReadOnly: (value: boolean) => void;
  clearTextStates: () => void;
  removeTextState: (segmentId: string) => void;
}

type EditorStore = EditorState & EditorActions;

// --- Store ---

export const useEditorStore = create<EditorStore>()((set, get) => ({
  textStates: {},
  activeDiffs: [],
  isReadOnly: false,

  setTextState: (segmentId: string, state: TextState): boolean => {
    const currentState = get().textStates[segmentId];

    // If the segment already has a state, validate the transition
    if (currentState !== undefined) {
      const allowedTransitions = TEXT_STATE_TRANSITIONS[currentState];
      if (!allowedTransitions.includes(state)) {
        return false;
      }
    }

    set((prev) => ({
      textStates: { ...prev.textStates, [segmentId]: state },
    }));

    return true;
  },

  getTextState: (segmentId: string): TextState | undefined => {
    return get().textStates[segmentId];
  },

  addDiff: (originalText: string, replacementText: string, position: number, roundId?: string | null): string => {
    const id = nanoid();
    const diff: DiffEntry = {
      id,
      originalText,
      replacementText,
      position,
      state: 'pending',
      roundId: roundId ?? null,
    };

    set((prev) => ({
      activeDiffs: [...prev.activeDiffs, diff],
    }));

    return id;
  },

  resolveDiff: (diffId: string, action: 'accept' | 'reject' | 'restore'): DiffEntry | undefined => {
    const { activeDiffs } = get();
    const index = activeDiffs.findIndex((d) => d.id === diffId);

    if (index === -1) return undefined;

    const stateMap: Record<'accept' | 'reject' | 'restore', DiffEntry['state']> = {
      accept: 'accepted',
      reject: 'rejected',
      restore: 'restored',
    };

    const updatedDiff: DiffEntry = {
      ...activeDiffs[index],
      state: stateMap[action],
    };

    set((prev) => ({
      activeDiffs: prev.activeDiffs.map((d) =>
        d.id === diffId ? updatedDiff : d,
      ),
    }));

    return updatedDiff;
  },

  getActiveDiffs: (): DiffEntry[] => {
    return get().activeDiffs.filter((d) => d.state === 'pending');
  },

  resolveAllDiffs: (action: 'accept' | 'reject'): DiffEntry[] => {
    const stateMap: Record<'accept' | 'reject', DiffEntry['state']> = {
      accept: 'accepted',
      reject: 'rejected',
    };
    const resolved: DiffEntry[] = [];

    set((prev) => ({
      activeDiffs: prev.activeDiffs.map((d) => {
        if (d.state !== 'pending') return d;
        const updated = { ...d, state: stateMap[action] };
        resolved.push(updated);
        return updated;
      }),
    }));

    return resolved;
  },

  setReadOnly: (value: boolean) => {
    set({ isReadOnly: value });
  },

  clearTextStates: () => {
    set({ textStates: {} });
  },

  removeTextState: (segmentId: string) => {
    set((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [segmentId]: _removed, ...rest } = prev.textStates;
      return { textStates: rest };
    });
  },
}));
