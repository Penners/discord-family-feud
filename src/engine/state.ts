import type {
  Attempt,
  Player,
  PublicState,
  Question,
  RoundKind,
  RoundResult,
  RoundStage,
  Team,
  TeamId,
} from "../shared/types";

export interface Timings {
  introMs: number;
  buzzMs: number;
  faceoffAnswerMs: number;
  decideMs: number;
  playMs: number;
  stealMs: number;
  roundEndMs: number;
  /** Breathing room after an answer is judged, so clients can show the result. */
  pauseMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  introMs: 4_000,
  buzzMs: 20_000,
  faceoffAnswerMs: 10_000,
  decideMs: 15_000,
  playMs: 20_000,
  stealMs: 30_000,
  roundEndMs: 9_000,
  pauseMs: 2_500,
};

export const TARGET_SCORE = 300;
/** Single, single, double, triple. Anything after that is sudden death. */
export const ROUND_MULTIPLIERS = [1, 1, 2, 3] as const;
export const SUDDEN_DEATH_MULTIPLIER = 3;
export const MAX_STRIKES = 3;
/** Face-off pairs that may both miss before the question is thrown out. */
export const MAX_FACEOFF_PAIRS = 3;
/** Unanswered buzzer windows before the question is thrown out. */
export const MAX_DEAD_BUZZES = 2;
/** Thrown-out sudden death questions before the game is called on score. */
export const MAX_VOID_SUDDEN_DEATHS = 3;

export interface QuestionSpec {
  kind: RoundKind;
  multiplier: number;
}

export interface FaceoffState {
  /** The player from each team currently at the podium. */
  pair: Record<TeamId, string>;
  pairsTried: number;
  deadBuzzes: number;
  /** Team that answers first in each pair (whoever won the buzzer). */
  leadTeam: TeamId | null;
  /** The first answer of the current pair, once judged. */
  first: { team: TeamId; answerIndex: number | null } | null;
}

export interface RoundState {
  kind: RoundKind;
  multiplier: number;
  /** Answers are trimmed to what is on the board (one answer in sudden death). */
  question: Question;
  revealed: boolean[];
  bank: number;
  strikes: number;
  stage: RoundStage;
  deadline: number | null;
  faceoff: FaceoffState;
  controllingTeam: TeamId | null;
  activePlayerId: string | null;
  pending: { requestId: string; playerId: string; text: string } | null;
  /** The active player has already been asked to be more specific this turn. */
  clarifying: boolean;
  lastAttempt: Attempt | null;
  result: RoundResult | null;
}

export interface GameState {
  phase: "lobby" | "playing" | "finished";
  players: Player[];
  teams: Record<TeamId, Team>;
  roundIndex: number;
  round: RoundState | null;
  winner: TeamId | null;
  usedQuestionIds: string[];
  /** Advances once per face-off pair so the podium rotates through each team. */
  faceoffCounter: number;
  voidSuddenDeaths: number;
  /** The last game was cancelled because the grader stopped working. */
  judgeDown: boolean;
  seq: number;
}

export const initialState = (): GameState => ({
  phase: "lobby",
  players: [],
  teams: {
    a: { name: "Team 1", score: 0 },
    b: { name: "Team 2", score: 0 },
  },
  roundIndex: 0,
  round: null,
  winner: null,
  usedQuestionIds: [],
  faceoffCounter: 0,
  voidSuddenDeaths: 0,
  judgeDown: false,
  seq: 0,
});

/** What clients are allowed to see: hidden answers stay on the server. */
export const toPublicState = (state: GameState): PublicState => {
  const round = state.round;
  return {
    phase: state.phase,
    players: state.players,
    teams: state.teams,
    targetScore: TARGET_SCORE,
    roundIndex: state.roundIndex,
    winner: state.winner,
    judgeDown: state.judgeDown ?? false,
    round: round && {
      kind: round.kind,
      multiplier: round.multiplier,
      question: round.question.text,
      answers: round.question.answers.map((answer, i) =>
        round.revealed[i] || round.stage === "roundEnd"
          ? { text: answer.text, points: answer.points, found: round.revealed[i] }
          : null
      ),
      bank: round.bank,
      strikes: round.strikes,
      stage: round.stage,
      deadline: round.deadline,
      faceoffPlayers: round.faceoff.pair,
      controllingTeam: round.controllingTeam,
      activePlayerId: round.activePlayerId,
      pending: round.pending && {
        playerId: round.pending.playerId,
        text: round.pending.text,
      },
      lastAttempt: round.lastAttempt,
      result: round.result,
    },
  };
};
