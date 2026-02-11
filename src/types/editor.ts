export type TextState =
  | 'user-written'
  | 'ai-generated'
  | 'ai-pending'
  | 'user-edited'
  | 'marked-preserve'
  | 'marked-delete'
  | 'original-removed';

export interface SegmentScore {
  spanStart: number;
  spanEnd: number;
  text: string;
  score: number; // 0-100
  authorship: 'user' | 'ai' | 'negotiated';
  justification: string;
}

export interface DiffEntry {
  id: string;
  originalText: string;
  replacementText: string;
  position: number; // ProseMirror document position (start)
  endPosition?: number; // Explicit ProseMirror end position (used when text length != PM span)
  state: 'pending' | 'accepted' | 'rejected' | 'restored';
  roundId: string | null; // Links diff to its generation round for contribution tracking
}

// Valid state transitions map
export const TEXT_STATE_TRANSITIONS: Record<TextState, TextState[]> = {
  'user-written': ['marked-delete', 'user-edited'],
  'ai-generated': ['user-edited', 'marked-preserve', 'marked-delete'],
  'ai-pending': ['ai-generated'], // or discarded
  'user-edited': ['marked-delete'],
  'marked-preserve': ['marked-delete'],
  'marked-delete': ['user-written', 'marked-preserve', 'ai-generated'], // toggle back
  'original-removed': ['user-written'], // click to restore
};
