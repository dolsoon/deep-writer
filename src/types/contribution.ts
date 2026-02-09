import type { ProvenanceEvent } from './provenance';

export type RoundType = 'generation' | 'alternative' | 'inline-edit';
export type Dimension = 'd1' | 'd2' | 'd3';
export type ContributionLevel = 1 | 2 | 3 | 4 | 5;

export interface EditTrace {
  original: string;
  replacement: string;
}

export interface RoundMetadata {
  roundId: string;
  roundNumber: number;
  type: RoundType;
  timestamp: number;
  parentRounds: string[];
  prompt: string | null;
  promptLength: number;
  constraintCount: number;
  constraintTypes: string[];
  generationMode: string;
  diffActions: { accepted: number; rejected: number; edited: number };
  events: ProvenanceEvent[];
  editTrace: EditTrace[];
}

export interface Edge {
  to: string;
  dimension: Dimension;
  strength: number; // 0.0 to 1.0
  reason: string;
}

export interface RoundNodeScores {
  d1: number;
  d2: number;
  d3: number;
}

export interface RoundNodeMetadata {
  prompt: string | null;
  constraints: string[];
  action: string;
  type: RoundType;
  previousText?: string;
  resultText?: string;
}

export interface RoundNodeNarrative {
  conceptsPreserved: string[];
  conceptsAdded: string[];
  conceptsLost: string[];
  summary: string;
}

export interface RoundNode {
  roundId: string;
  scores: RoundNodeScores;
  edges: Edge[];
  metadata: RoundNodeMetadata;
  narrative: RoundNodeNarrative | null;
}

export interface RoundAnalysis {
  roundId: string;
  scores: RoundNodeScores;
  edges: Edge[];
  conceptsPreserved: string[];
  conceptsAdded: string[];
  conceptsLost: string[];
  narrativeSummary: string;
}

// --- SPEC-CONTRIB-003 Types ---

export interface SelectedSegment {
  text: string;
  position: { from: number; to: number };
  roundId: string | null;
  scores: {
    composite: number;
    concept: number;
    wording: number;
    evaluation: number;
  };
  level: ContributionLevel;
}

export interface SegmentScore {
  spanStart: number;
  spanEnd: number;
  text: string;
  score: number;
  level: ContributionLevel;
  wording: number;
  concept: number;
  evaluation: number;
  authorship: 'user' | 'ai' | 'collaborative';
  roundId: string | null;
  ancestryChain: string[];
  roundAnalysis: RoundAnalysis | null;
}

export interface LevelDistribution {
  level1: number;
  level2: number;
  level3: number;
  level4: number;
  level5: number;
}

export interface DocumentContribution {
  overall: number;
  concept: number;
  wording: number;
  evaluation: number;
  levelDistribution: LevelDistribution;
}

export interface RoundAnalysisRequest {
  roundId: string;
  actionType: RoundType | 'user-typed';
  previousText: string;
  resultText: string;
  userPostAction: 'accepted' | 'edited' | 'rejected';
  recentChatHistory: Array<{ role: string; content: string }>;
  userConstraints: Array<{ type: string; text: string }>;
  parentRoundIds: string[];
}
