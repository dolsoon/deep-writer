export interface GapInfo {
  id: string;
  position: { from: number; to: number };
  originalText: string;
}

export interface ConstraintInfo {
  text: string;
  position: { from: number; to: number };
}

export type GenerateMode = 'regenerate' | 'selection' | 'continuation' | 'smart-edit';

export interface GenerateRequest {
  goal: string;
  document: string;
  gaps: GapInfo[];
  constraints: ConstraintInfo[];
  userRequest?: string;
  mode: GenerateMode;
}

export interface GapBasedResponse {
  gaps: Array<{ id: string; text: string }>;
}

export interface SmartEditResponse {
  editedDocument: string;
}

export type GenerateResponse = GapBasedResponse | SmartEditResponse;

export interface GenerateError {
  error: string;
  retryable: boolean;
}
