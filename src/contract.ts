// THROWAWAY native-extension prototype: does the manual rewrite workflow feel right?
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export interface ReviewerSelection { provider: string; modelId: string; effort: string }
export interface ReviewSettings extends ReviewerSelection { enabled: boolean }
export interface Correction {
  id: string;
  category: "grammar" | "spelling" | "house_style";
  start: number; end: number; original: string; replacement: string; explanation: string;
}
export interface Suggestion {
  id: string;
  category: "conciseness" | "naturalness" | "british_usage" | "possible_issue";
  start: number; end: number; original: string; explanation: string;
  alternatives: string[]; uncertainty: string | null;
}
export interface ReviewResult { corrections: Correction[]; suggestions: Suggestion[]; tone: string }
export type WorkspaceAction = "review" | "stop" | "send" | "bypass" | "cancel" | "model" | "toggle";
export interface WorkspaceView {
  id: string; draft: string; revision: number;
  reviewedDraft: string | null; review: ReviewResult | null;
  mandatoryDraft: string | null;
  busy: boolean; delivering: boolean; uncertain: boolean;
  error: string | null; notice: string | null;
  attachmentCount: number; settings: ReviewSettings;
}
export interface WorkspaceController {
  view(): WorkspaceView;
  subscribe(listener: () => void): () => void;
  setDraft(text: string): void;
  act(action: WorkspaceAction): Promise<void>;
}
export type ReviewFunction = (draft: string, selection: ReviewerSelection, ctx: ExtensionContext, signal: AbortSignal) => Promise<ReviewResult>;
