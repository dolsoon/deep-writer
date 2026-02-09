import { create } from 'zustand';
import type { RoundMetadata, RoundType, EditTrace } from '@/types/contribution';
import type { ProvenanceEvent } from '@/types/provenance';

// --- Types ---

interface CreateRoundParams {
  type: RoundType;
  parentRounds: string[];
  prompt: string | null;
  promptLength: number;
  constraintCount: number;
  constraintTypes: string[];
  generationMode: string;
  diffActions: { accepted: number; rejected: number; edited: number };
  events: ProvenanceEvent[];
}

interface RoundState {
  rounds: Map<string, RoundMetadata>;
  roundCounter: number;
}

interface RoundActions {
  createRound: (params: CreateRoundParams) => RoundMetadata;
  getRound: (roundId: string) => RoundMetadata | undefined;
  getAncestryChain: (roundId: string) => RoundMetadata[];
  appendEditTrace: (roundId: string, trace: EditTrace) => void;
  extendLastEditTrace: (roundId: string, text: string) => void;
  prependLastEditTraceOriginal: (roundId: string, text: string) => void;
  appendLastEditTraceOriginal: (roundId: string, text: string) => void;
  nextRoundId: () => string;
  getAllRounds: () => RoundMetadata[];
  clearRounds: () => void;
}

type RoundStore = RoundState & RoundActions;

// --- Store ---

export const useRoundStore = create<RoundStore>()((set, get) => ({
  rounds: new Map(),
  roundCounter: 0,

  createRound: (params: CreateRoundParams): RoundMetadata => {
    const counter = get().roundCounter + 1;
    const roundId = `r-${counter}`;
    const round: RoundMetadata = {
      roundId,
      roundNumber: counter,
      type: params.type,
      timestamp: Date.now(),
      parentRounds: params.parentRounds,
      prompt: params.prompt,
      promptLength: params.promptLength,
      constraintCount: params.constraintCount,
      constraintTypes: params.constraintTypes,
      generationMode: params.generationMode,
      diffActions: params.diffActions,
      events: params.events,
      editTrace: [],
    };
    set((state) => {
      const rounds = new Map(state.rounds);
      rounds.set(roundId, round);
      return { rounds, roundCounter: counter };
    });
    return round;
  },

  getRound: (roundId: string): RoundMetadata | undefined => {
    return get().rounds.get(roundId);
  },

  getAncestryChain: (roundId: string): RoundMetadata[] => {
    const { rounds } = get();
    const visited = new Set<string>();
    const result: RoundMetadata[] = [];

    function walk(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const round = rounds.get(id);
      if (!round) return;
      for (const parentId of round.parentRounds) {
        walk(parentId);
      }
      result.push(round);
    }

    walk(roundId);
    result.sort((a, b) => a.roundNumber - b.roundNumber);
    return result;
  },

  appendEditTrace: (roundId: string, trace: EditTrace): void => {
    const round = get().rounds.get(roundId);
    if (!round) return;
    round.editTrace.push(trace);
  },

  extendLastEditTrace: (roundId: string, text: string): void => {
    const round = get().rounds.get(roundId);
    if (!round || round.editTrace.length === 0) return;
    const last = round.editTrace[round.editTrace.length - 1];
    last.replacement += text;
  },

  prependLastEditTraceOriginal: (roundId: string, text: string): void => {
    const round = get().rounds.get(roundId);
    if (!round || round.editTrace.length === 0) return;
    const last = round.editTrace[round.editTrace.length - 1];
    last.original = text + last.original;
  },

  appendLastEditTraceOriginal: (roundId: string, text: string): void => {
    const round = get().rounds.get(roundId);
    if (!round || round.editTrace.length === 0) return;
    const last = round.editTrace[round.editTrace.length - 1];
    last.original += text;
  },

  nextRoundId: (): string => {
    return `r-${get().roundCounter + 1}`;
  },

  getAllRounds: (): RoundMetadata[] => {
    return Array.from(get().rounds.values());
  },

  clearRounds: () => {
    set({ rounds: new Map(), roundCounter: 0 });
  },
}));
