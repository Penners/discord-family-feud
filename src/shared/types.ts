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

/** "pick" is the winning team choosing its two players; it is skipped for a one-player team. */
export type FastMoneyStage = "pick" | "intro" | "turn" | "reveal" | "done";

/** One Fast Money answer as clients see it. `points` is null until that turn's answers are revealed. */
export interface PublicFastMoneySlot {
  text: string;
  points: number | null;
}

export interface PublicFastMoney {
  team: TeamId;
  /** Who plays the first and second turn. The same player twice on a one-player team. */
  playerIds: [string, string];
  /** Who has put themselves forward so far, in the order they will play. */
  volunteers: string[];
  stage: FastMoneyStage;
  turn: 0 | 1;
  questionIndex: number;
  deadline: number | null;
  /** Time left on the turn clock while it is stopped for an answer being judged. */
  remainingMs: number | null;
  judging: boolean;
  /** The second player repeated the first player's answer and must give another. */
  retry: boolean;
  /** This viewer plays second and may not see the first player's turn. */
  isolated: boolean;
  /** One row per question. Questions and answers are null while hidden from this viewer. */
  rows: { question: string | null; answers: [PublicFastMoneySlot | null, PublicFastMoneySlot | null] }[];
  /** Points revealed so far; null for the isolated player. */
  total: number | null;
  target: number;
}

export interface PublicState {
  phase: "lobby" | "playing" | "fastMoney" | "finished";
  players: Player[];
  teams: Record<TeamId, Team>;
  targetScore: number;
  roundIndex: number;
  round: PublicRound | null;
  /** The winning team's bonus round. Stays set once finished so the result can be shown. */
  fastMoney: PublicFastMoney | null;
  winner: TeamId | null;
  /** The last game was cancelled because answers could not be judged. */
  judgeDown: boolean;
}
