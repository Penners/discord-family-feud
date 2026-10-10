export type TeamId = "a" | "b";
export const TEAM_IDS: readonly TeamId[] = ["a", "b"];
export const otherTeam = (team: TeamId): TeamId => (team === "a" ? "b" : "a");

export interface Player {
  id: string;
  name: string;
  avatarUrl: string | null;
  team: TeamId | null;
  connected: boolean;
}

export interface Answer {
  /** The show's wording, as displayed on the board. */
  text: string;
  points: number;
  /** Plain-English note on what the answer covers. Only the grader sees this. */
  accepts?: string;
}

export interface Question {
  id: string;
  text: string;
  /** Sorted by points, highest first. */
  answers: Answer[];
}

export interface Team {
  name: string;
  score: number;
}

export type RoundKind = "normal" | "suddenDeath";

export type RoundStage =
  | "intro"
  | "faceoffBuzz"
  | "faceoffAnswer"
  | "playOrPass"
  | "play"
  | "steal"
  | "roundEnd";

/** "vague" is the host asking "can you be more specific?": no penalty, same player answers again. */
export type AttemptOutcome = "hit" | "miss" | "duplicate" | "timeout" | "vague";

export interface Attempt {
  seq: number;
  playerId: string;
  team: TeamId;
  text: string;
  outcome: AttemptOutcome;
  answerIndex: number | null;
  context: "faceoff" | "play" | "steal";
}

export type RoundResultVia = "cleared" | "steal" | "stealFailed" | "void";

export interface RoundResult {
  winner: TeamId | null;
  awarded: number;
  via: RoundResultVia;
}

/** A board slot as clients see it: null until the answer is shown. */
export type PublicAnswer = { text: string; points: number; found: boolean } | null;

export interface PublicRound {
  kind: RoundKind;
  multiplier: number;
  question: string;
  answers: PublicAnswer[];
  bank: number;
  strikes: number;
  stage: RoundStage;
  deadline: number | null;
  /** The two players currently at the face-off podium. */
  faceoffPlayers: Record<TeamId, string>;
  controllingTeam: TeamId | null;
  /** Who may answer or decide right now. */
  activePlayerId: string | null;
  /** An answer that has been submitted and is being graded. */
  pending: { playerId: string; text: string } | null;
  lastAttempt: Attempt | null;
  result: RoundResult | null;
}

export interface PublicState {
  phase: "lobby" | "playing" | "finished";
  players: Player[];
  teams: Record<TeamId, Team>;
  targetScore: number;
  roundIndex: number;
  round: PublicRound | null;
  winner: TeamId | null;
  /** The last game was cancelled because answers could not be judged. */
  judgeDown: boolean;
}
