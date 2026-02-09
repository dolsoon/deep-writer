import type { JSONContent } from '@tiptap/react';
import type { ProvenanceEvent } from './provenance';
import type { SegmentScore } from './editor';
import type { RoundMetadata, RoundNode } from './contribution';

export interface Session {
  id: string;
  goal: string;
  goalHistory: GoalChange[];
  documentState: JSONContent;
  provenanceLog: ProvenanceEvent[];
  relianceScores: SegmentScore[];
  createdAt: number;
  lastModifiedAt: number;
  // SPEC-CONTRIB-003: Enhanced export fields
  provenanceChain?: RoundMetadata[];
  contributionGraph?: Record<string, RoundNode>;
}

export interface GoalChange {
  previousGoal: string;
  newGoal: string;
  source: GoalChangeSource;
  timestamp: number;
}

export type GoalChangeSource = 'manual' | 'process2' | 'inferred';
