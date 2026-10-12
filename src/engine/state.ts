import type {
  Attempt,
  FastMoneyStage,
  Player,
  PublicFastMoney,
  PublicState,
  Question,
  RoundKind,
  RoundResult,
  RoundStage,
  Team,
  TeamId,
} from "../shared/types";

export interface Timings {
  /** The round title card, before the question appears. */
  introMs: number;
  /** Reading time before the buzzers open: per word of the question, within these limits. */
  readPerWordMs: number;
  readMinMs: number;
  readMaxMs: number;
  buzzMs: number;
  faceoffAnswerMs: number;
  decideMs: number;
  playMs: number;
  stealMs: number;
  roundEndMs: number;
  /** Breathing room after an answer is judged, so clients can show the result. */
  pauseMs: number;
  /** How long the winning team has to choose who plays Fast Money. */
  fastMoneyPickMs: number;
  fastMoneyIntroMs: number;
  /** The clock for the first and second Fast Money player. */
  fastMoneyTurnMs: [number, number];
  /** How long a turn's answers stay up while clients reveal them one by one. */
  fastMoneyRevealMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  introMs: 2_500,
  readPerWordMs: 300,
  readMinMs: 2_500,
  readMaxMs: 9_000,
  buzzMs: 30_000,
  faceoffAnswerMs: 30_000,
  decideMs: 30_000,
  playMs: 30_000,
  stealMs: 30_000,
  roundEndMs: 9_000,
  pauseMs: 2_500,
  fastMoneyPickMs: 30_000,
  fastMoneyIntroMs: 6_000,
  fastMoneyTurnMs: [60_000, 60_000],
  fastMoneyRevealMs: 10_000,
};

/** How long a question is on screen before the buzzers open: longer questions get longer. */
export const readingMs = (question: string, t: Timings = DEFAULT_TIMINGS): number => {
  const words = question.trim().split(/\s+/).length;
  return Math.min(t.readMaxMs, Math.max(t.readMinMs, words * t.readPerWordMs));
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
export const FAST_MONEY_QUESTIONS = 5;
/** Points the two players need between them to win Fast Money. */
export const FAST_MONEY_TARGET = 200;

export interface QuestionSpec {
  kind: RoundKind | "fastMoney";
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

export interface FastMoneySlot {
  text: string;
  /** The board answer it matched, or null for a miss, a pass or no answer in time. */
  answerIndex: number | null;
  points: number;
}

/** The winning team's bonus round: two players answer the same five questions against the clock. */
export interface FastMoneyState {
  team: TeamId;
  /** Provisional until the "pick" stage ends. */
  playerIds: [string, string];
  /** Team members who have put themselves forward, in playing order (at most two). */
  volunteers: string[];
  questions: Question[];
  stage: FastMoneyStage;
  turn: 0 | 1;
  questionIndex: number;
  /** answers[turn][question]; null until that question has been answered or timed out. */
  answers: [(FastMoneySlot | null)[], (FastMoneySlot | null)[]];
  deadline: number | null;
  /** The turn clock stops while an answer is judged; this is what it resumes from. */
  remainingMs: number | null;
  pending: { requestId: string; text: string } | null;
  retry: boolean;
}

export interface GameState {
  phase: "lobby" | "playing" | "fastMoney" | "finished";
  players: Player[];
  teams: Record<TeamId, Team>;
  roundIndex: number;
  round: RoundState | null;
  fastMoney: FastMoneyState | null;
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
  fastMoney: null,
  winner: null,
  usedQuestionIds: [],
  faceoffCounter: 0,
  voidSuddenDeaths: 0,
  judgeDown: false,
  seq: 0,
});

/** When the room's alarm should next fire, if a clock is running. */
export const nextDeadline = (state: GameState): number | null =>
  state.phase === "playing"
    ? (state.round?.deadline ?? null)
    : state.phase === "fastMoney"
      ? (state.fastMoney?.deadline ?? null)
      : null;

/**
 * Fast Money as one viewer may see it. The second player is kept in the dark
 * like on the show: nothing at all during the first turn, and the first
 * player's answers stay covered until their own turn has been revealed.
 */
const toPublicFastMoney = (fm: FastMoneyState, viewerId: string | undefined): PublicFastMoney => {
  const done = fm.stage === "done";
  const isolated =
    fm.stage !== "pick" &&
    viewerId === fm.playerIds[1] &&
    fm.playerIds[0] !== fm.playerIds[1] &&
    !done &&
    !(fm.turn === 1 && fm.stage === "reveal");
  const questionShown = (i: number) =>
    done || fm.stage === "reveal" || (fm.stage === "turn" && i <= fm.questionIndex);
  const pointsShown = (turn: 0 | 1) => done || fm.turn > turn || (fm.turn === turn && fm.stage === "reveal");
  const slot = (turn: 0 | 1, i: number) => {
    const answer = fm.answers[turn][i];
    if (!answer || (isolated && turn === 0)) return null;
    return { text: answer.text, points: pointsShown(turn) ? answer.points : null };
  };
  const rows = fm.questions.map((question, i) => ({
    question: questionShown(i) && !(isolated && fm.turn === 0) ? question.text : null,
    answers: [slot(0, i), slot(1, i)] as PublicFastMoney["rows"][number]["answers"],
  }));
  return {
    team: fm.team,
    playerIds: fm.playerIds,
    volunteers: fm.volunteers,
    stage: fm.stage,
    turn: fm.turn,
    questionIndex: fm.questionIndex,
    deadline: fm.deadline,
    remainingMs: fm.remainingMs,
    judging: fm.pending !== null,
    retry: fm.retry,
    isolated,
    rows,
    total: isolated ? null : rows.reduce((sum, row) => sum + (row.answers[0]?.points ?? 0) + (row.answers[1]?.points ?? 0), 0),
    target: FAST_MONEY_TARGET,
  };
};

/** What one client is allowed to see: hidden answers stay on the server. */
export const toPublicState = (state: GameState, viewerId?: string): PublicState => {
  const round = state.round;
  return {
    phase: state.phase,
    players: state.players,
    teams: state.teams,
    targetScore: TARGET_SCORE,
    roundIndex: state.roundIndex,
    winner: state.winner,
    fastMoney: state.fastMoney ? toPublicFastMoney(state.fastMoney, viewerId) : null,
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
