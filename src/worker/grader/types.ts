export interface GradeRequest {
  question: string;
  /** Every answer on the board, in board order. */
  answers: { text: string; accepts?: string; revealed: boolean }[];
  guess: string;
}

export interface GradeResult {
  /** Board slot the guess matches, or null if it matches none. */
  matchIndex: number | null;
  /** No single answer matches because the guess is too broad: ask the player to be more specific. */
  vague?: boolean;
  /** Which grader produced the verdict, for logging and evals. */
  source: string;
  confidence?: number;
}

/**
 * A grader decides which board answer, if any, a player's guess means.
 * Implementations only ever return a slot index: the room looks up the text
 * and points itself, so a grader cannot invent an answer.
 */
export interface Grader {
  readonly name: string;
  grade(request: GradeRequest): Promise<GradeResult>;
}
