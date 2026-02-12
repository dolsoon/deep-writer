import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { JSONContent } from '@tiptap/react';
import type { Session, GoalChangeSource, ProvenanceEvent } from '@/types';
import {
  createDebouncedSave,
  getActiveSessionId,
  setActiveSessionId,
  loadSession,
  checkStorageUsage as storageCheckUsage,
} from '@/lib/storage';
import { useRoundStore } from '@/stores/useRoundStore';
import { useContributionGraphStore } from '@/stores/useContributionGraphStore';
import { useUserAnnotationStore } from '@/stores/useUserAnnotationStore';

// --- Types ---

interface SessionState {
  session: Session | null;
  isInitialized: boolean;
}

interface SessionActions {
  initSession: (goal: string) => void;
  updateGoal: (newGoal: string, source: GoalChangeSource) => void;
  updateDocumentState: (doc: JSONContent) => void;
  addProvenanceEvent: (event: ProvenanceEvent) => void;
  getExportData: () => Session | null;
  loadFromStorage: () => boolean;
  checkStorageUsage: () => { used: number; limit: number; percentage: number };
}

type SessionStore = SessionState & SessionActions;

// --- Debounced Save (created once, reused) ---

const debouncedSave = createDebouncedSave(300);

// --- Store ---

export const useSessionStore = create<SessionStore>()((set, get) => ({
  session: null,
  isInitialized: false,

  initSession: (goal: string) => {
    const now = Date.now();
    const session: Session = {
      id: nanoid(),
      goal,
      goalHistory: [],
      provenanceLog: [],
      relianceScores: [],
      createdAt: now,
      lastModifiedAt: now,
      documentState: { type: 'doc', content: [{ type: 'paragraph' }] },
    };

    setActiveSessionId(session.id);
    set({ session, isInitialized: true });
    debouncedSave(session);
  },

  updateGoal: (newGoal: string, source: GoalChangeSource) => {
    const { session } = get();
    if (!session) return;

    const now = Date.now();
    const goalChange = {
      previousGoal: session.goal,
      newGoal,
      source,
      timestamp: now,
    };

    const updated: Session = {
      ...session,
      goal: newGoal,
      goalHistory: [...session.goalHistory, goalChange],
      lastModifiedAt: now,
    };

    set({ session: updated });
    debouncedSave(updated);
  },

  updateDocumentState: (doc: JSONContent) => {
    const { session } = get();
    if (!session) return;

    const now = Date.now();
    const updated: Session = {
      ...session,
      documentState: doc,
      lastModifiedAt: now,
    };

    set({ session: updated });
    debouncedSave(updated);
  },

  addProvenanceEvent: (event: ProvenanceEvent) => {
    const { session } = get();
    if (!session) return;

    const now = Date.now();
    const updated: Session = {
      ...session,
      provenanceLog: [...session.provenanceLog, event],
      lastModifiedAt: now,
    };

    set({ session: updated });
    debouncedSave(updated);
  },

  getExportData: (): Session | null => {
    const { session } = get();
    if (!session) return null;

    // SPEC-CONTRIB-003: Include provenance chain and contribution graph
    const provenanceChain = useRoundStore.getState().getAllRounds();
    const contributionGraph = Object.fromEntries(
      useContributionGraphStore.getState().nodes.entries(),
    );
    const userAnnotations = useUserAnnotationStore.getState().annotationRanges;

    return {
      ...session,
      provenanceChain,
      contributionGraph,
      userAnnotations,
    };
  },

  loadFromStorage: (): boolean => {
    const activeId = getActiveSessionId();
    if (!activeId) return false;

    const session = loadSession(activeId);
    if (!session) return false;

    set({ session, isInitialized: true });
    return true;
  },

  checkStorageUsage: () => {
    return storageCheckUsage();
  },
}));
