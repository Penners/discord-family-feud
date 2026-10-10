import { beforeEach, describe, expect, it } from "vitest";
import type { Question } from "../shared/types";
import { reduce } from "./reducer";
import type { GameEvent } from "./reducer";
import { DEFAULT_TIMINGS, initialState, toPublicState } from "./state";
import type { GameState, QuestionSpec } from "./state";

const BOARD = [40, 25, 15, 10, 6, 4];
const TIED_BOARD = [30, 20, 20, 10, 5];

let state: GameState;
let now: number;
let boards: number[][];
let picked: QuestionSpec[];

const pickQuestion = (spec: QuestionSpec): Question => {
  const points = boards[Math.min(picked.length, boards.length - 1)];
  picked.push(spec);
  return {
    id: `q${picked.length}`,
    text: `Question ${picked.length}`,
    answers: points.map((p, i) => ({ text: `Answer ${i}`, points: p })),
  };
};

/** Applies an event and fails the test if the engine rejects it. */
const send = (event: GameEvent) => {
  const result = reduce(state, event, { now, pickQuestion });
  expect(result.error).toBeUndefined();
  state = result.state;
  return result;
};

const rejected = (event: GameEvent) => reduce(state, event, { now, pickQuestion }).error;

const round = () => state.round!;

/** Lets the current stage's clock run out. */
const expire = () => {
  expect(round().deadline).not.toBeNull();
  now = round().deadline!;
  send({ type: "tick" });
};

/** Submits an answer and delivers the grader's verdict for it. */
const answer = (playerId: string, matchIndex: number | null) => {
  const { effects } = send({ type: "answer", playerId, text: matchIndex === null ? "wrong" : `answer ${matchIndex}` });
  expect(effects).toHaveLength(1);
  send({ type: "graded", requestId: effects[0].requestId, matchIndex });
};

const setup = (teamA = ["a1", "a2"], teamB = ["b1", "b2"]) => {
  for (const id of [...teamA, ...teamB]) send({ type: "join", playerId: id, name: id });
  for (const id of teamA) send({ type: "setTeam", playerId: id, team: "a" });
  for (const id of teamB) send({ type: "setTeam", playerId: id, team: "b" });
};

/** Starts the game and opens the buzzers for round one. */
const startToBuzz = () => {
  send({ type: "start", playerId: "a1" });
  expire();
  expect(round().stage).toBe("faceoffBuzz");
};

/** a1 wins the face-off with the top answer and their team plays. */
const teamAPlays = () => {
  send({ type: "buzz", playerId: "a1" });
  answer("a1", 0);
  send({ type: "choose", playerId: "a1", play: true });
};

/** Team A wins the current round outright by clearing the board. */
const teamAClearsBoard = () => {
  expire(); // intro
  const lead = round().faceoff.pair.a;
  send({ type: "buzz", playerId: lead });
  answer(lead, 0);
  send({ type: "choose", playerId: lead, play: true });
  for (let i = 1; i < round().revealed.length; i++) answer(round().activePlayerId!, i);
  expect(round().result).toMatchObject({ winner: "a", via: "cleared" });
};

const fm = () => state.fastMoney!;

/** Lets the current Fast Money stage's clock run out. */
const fmExpire = () => {
  expect(fm().deadline).not.toBeNull();
  now = fm().deadline!;
  send({ type: "tick" });
};

let guesses = 0;

/** Submits a Fast Money answer, worded differently every time, and delivers the grader's verdict for it. */
const fmAnswer = (playerId: string, matchIndex: number | null, text = `guess ${++guesses}`) => {
  const { effects } = send({ type: "answer", playerId, text });
  expect(effects).toHaveLength(1);
  send({ type: "graded", requestId: effects[0].requestId, matchIndex });
};

/** Team A wins the game in three rounds, which takes them into Fast Money. */
const teamAWinsGame = (teamA = ["a1", "a2"], teamB = ["b1", "b2"]) => {
  setup(teamA, teamB);
  send({ type: "start", playerId: "a1" });
  for (let r = 0; r < 3; r++) {
    teamAClearsBoard();
    expire();
  }
  expect(state.phase).toBe("fastMoney");
  // With two or more on the team, the first two step up and confirm.
  if (fm().stage === "pick") {
    send({ type: "volunteer", playerId: teamA[0], play: true });
    send({ type: "volunteer", playerId: teamA[1], play: true });
    send({ type: "confirmPlayers", playerId: teamA[0] });
  }
};

/** Runs Fast Money to the end with nobody answering. */
const sitOutFastMoney = () => {
  for (let stage = 0; stage < 6; stage++) fmExpire();
};

beforeEach(() => {
  state = initialState();
  now = 1_000_000;
  boards = [BOARD];
  picked = [];
});

describe("lobby", () => {
  it("needs a player on each team to start, and any player can start", () => {
    send({ type: "join", playerId: "a1", name: "Ann" });
    send({ type: "join", playerId: "b1", name: "Bob" });
    send({ type: "setTeam", playerId: "a1", team: "a" });
    expect(rejected({ type: "start", playerId: "a1" })).toMatch(/each team/i);
    send({ type: "setTeam", playerId: "b1", team: "b" });
    expect(rejected({ type: "start", playerId: "stranger" })).toMatch(/join/i);
    send({ type: "start", playerId: "b1" });
    expect(state.phase).toBe("playing");
    expect(round()).toMatchObject({ stage: "intro", multiplier: 1, kind: "normal" });
  });

  it("drops disconnected players when the game starts", () => {
    setup();
    send({ type: "disconnect", playerId: "b2" });
    send({ type: "start", playerId: "a1" });
    expect(state.players.map((p) => p.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("locks teams once the game is running but lets a latecomer pick one", () => {
    setup();
    startToBuzz();
    expect(rejected({ type: "setTeam", playerId: "a1", team: "b" })).toMatch(/locked/i);
    send({ type: "join", playerId: "late", name: "Late" });
    send({ type: "setTeam", playerId: "late", team: "b" });
    expect(state.players.find((p) => p.id === "late")?.team).toBe("b");
  });
});

describe("face-off", () => {
  beforeEach(() => {
    setup();
    startToBuzz();
  });

  it("only lets the two players at the podium buzz", () => {
    expect(round().faceoff.pair).toEqual({ a: "a1", b: "b1" });
    expect(rejected({ type: "buzz", playerId: "a2" })).toMatch(/not in this face-off/i);
    send({ type: "buzz", playerId: "b1" });
    expect(round()).toMatchObject({ stage: "faceoffAnswer", activePlayerId: "b1" });
    expect(rejected({ type: "buzz", playerId: "a1" })).toMatch(/not open/i);
    expect(rejected({ type: "answer", playerId: "a1", text: "hello" })).toMatch(/not your turn/i);
  });

  it("is won outright by the number one answer", () => {
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 0);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "a", activePlayerId: "a1", bank: 40 });
  });

  it("gives the opponent a chance to beat a lower answer", () => {
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 2);
    expect(round()).toMatchObject({ stage: "faceoffAnswer", activePlayerId: "b1" });
    answer("b1", 1);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "b", activePlayerId: "b1", bank: 40 });
  });

  it("goes to the first answer when the opponent answers lower or misses", () => {
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 1);
    answer("b1", 3);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "a", bank: 35 });
  });

  it("goes to the opponent when the buzzer misses and they get on the board", () => {
    send({ type: "buzz", playerId: "a1" });
    answer("a1", null);
    answer("b1", 5);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "b" });
  });

  it("treats the opponent repeating the first answer as a miss", () => {
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 3);
    answer("b1", 3);
    expect(round().lastAttempt).toMatchObject({ outcome: "duplicate", answerIndex: null });
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "a", bank: 10 });
  });

  it("moves to the next player from each team when both miss", () => {
    send({ type: "buzz", playerId: "b1" });
    answer("b1", null);
    answer("a1", null);
    // Same team leads again, with the next players in line.
    expect(round()).toMatchObject({ stage: "faceoffAnswer", activePlayerId: "b2" });
    expect(round().faceoff.pair).toEqual({ a: "a2", b: "b2" });
    answer("b2", 4);
    answer("a2", null);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "b", activePlayerId: "b2" });
  });

  it("throws the question out after three pairs miss", () => {
    send({ type: "buzz", playerId: "a1" });
    for (let pair = 0; pair < 3; pair++) {
      answer(round().activePlayerId!, null);
      answer(round().activePlayerId!, null);
    }
    expect(round()).toMatchObject({ stage: "roundEnd", result: { winner: null, awarded: 0, via: "void" } });
  });

  it("counts running out of time as a miss", () => {
    send({ type: "buzz", playerId: "a1" });
    expire();
    expect(round().lastAttempt).toMatchObject({ playerId: "a1", outcome: "timeout" });
    expect(round().activePlayerId).toBe("b1");
  });

  it("rotates the podium when nobody buzzes, then throws the question out", () => {
    expire();
    expect(round().stage).toBe("faceoffBuzz");
    expect(round().faceoff.pair).toEqual({ a: "a2", b: "b2" });
    expire();
    expect(round().result).toMatchObject({ winner: null, via: "void" });
  });
});

describe("face-off ties", () => {
  it("gives equal-value answers to whoever answered first", () => {
    boards = [TIED_BOARD];
    setup();
    startToBuzz();
    send({ type: "buzz", playerId: "b1" });
    answer("b1", 2);
    answer("a1", 1);
    expect(round()).toMatchObject({ stage: "playOrPass", controllingTeam: "b" });
  });
});

describe("play or pass", () => {
  beforeEach(() => {
    setup();
    startToBuzz();
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 0);
  });

  it("only lets the face-off winner decide", () => {
    expect(rejected({ type: "choose", playerId: "a2", play: true })).toMatch(/not your decision/i);
    expect(rejected({ type: "choose", playerId: "b1", play: true })).toMatch(/not your decision/i);
  });

  it("starts play with the next player in line", () => {
    send({ type: "choose", playerId: "a1", play: true });
    expect(round()).toMatchObject({ stage: "play", controllingTeam: "a", activePlayerId: "a2", strikes: 0 });
  });

  it("hands the board to the other team on a pass", () => {
    send({ type: "choose", playerId: "a1", play: false });
    expect(round()).toMatchObject({ stage: "play", controllingTeam: "b", activePlayerId: "b2" });
  });

  it("defaults to playing if the clock runs out", () => {
    expire();
    expect(round()).toMatchObject({ stage: "play", controllingTeam: "a" });
  });
});

describe("main play", () => {
  beforeEach(() => {
    setup();
    startToBuzz();
    teamAPlays();
  });

  it("goes down the line and banks correct answers", () => {
    answer("a2", 1);
    expect(round()).toMatchObject({ bank: 65, strikes: 0, activePlayerId: "a1" });
    answer("a1", 2);
    expect(round()).toMatchObject({ bank: 80, activePlayerId: "a2" });
  });

  it("gives a strike for a wrong answer, a repeat, a blank or a timeout", () => {
    answer("a2", null);
    expect(round().strikes).toBe(1);
    answer("a1", 0);
    expect(round().lastAttempt?.outcome).toBe("duplicate");
    expect(round()).toMatchObject({ strikes: 2, bank: 40 });
    expire();
    expect(round().lastAttempt?.outcome).toBe("timeout");
    expect(round()).toMatchObject({ strikes: 3, stage: "steal" });
  });

  it("treats a blank submission as a strike without asking the grader", () => {
    const { effects } = send({ type: "answer", playerId: "a2", text: "   " });
    expect(effects).toHaveLength(0);
    expect(round().strikes).toBe(1);
  });

  it("stops the clock while an answer is being judged and ignores stale verdicts", () => {
    const { effects } = send({ type: "answer", playerId: "a2", text: "something" });
    expect(round().deadline).toBeNull();
    expect(round().pending).toMatchObject({ playerId: "a2", text: "something" });
    expect(rejected({ type: "answer", playerId: "a2", text: "again" })).toMatch(/already being judged/i);
    send({ type: "graded", requestId: "not-the-request", matchIndex: 1 });
    expect(round().pending).not.toBeNull();
    send({ type: "graded", requestId: effects[0].requestId, matchIndex: 1 });
    expect(round()).toMatchObject({ pending: null, bank: 65 });
    send({ type: "graded", requestId: effects[0].requestId, matchIndex: 2 });
    expect(round().bank).toBe(65);
  });

  it("asks a vague answer to be more specific once, with no strike and a fresh clock", () => {
    const first = send({ type: "answer", playerId: "a2", text: "clothes" });
    send({ type: "graded", requestId: first.effects[0].requestId, matchIndex: null, vague: true });
    expect(round()).toMatchObject({ strikes: 0, activePlayerId: "a2", pending: null, stage: "play" });
    expect(round().lastAttempt).toMatchObject({ outcome: "vague", text: "clothes" });
    expect(round().deadline).toBe(now + DEFAULT_TIMINGS.pauseMs + DEFAULT_TIMINGS.playMs);

    // Being vague a second time on the same turn is just a wrong answer.
    const second = send({ type: "answer", playerId: "a2", text: "stuff" });
    send({ type: "graded", requestId: second.effects[0].requestId, matchIndex: null, vague: true });
    expect(round()).toMatchObject({ strikes: 1, activePlayerId: "a1" });

    // The next player gets their own chance to be asked.
    const third = send({ type: "answer", playerId: "a1", text: "things" });
    send({ type: "graded", requestId: third.effects[0].requestId, matchIndex: null, vague: true });
    expect(round()).toMatchObject({ strikes: 1, activePlayerId: "a1" });
    expect(round().lastAttempt?.outcome).toBe("vague");
  });

  it("awards the bank for clearing the board", () => {
    for (let i = 1; i < BOARD.length; i++) answer(round().activePlayerId!, i);
    expect(round()).toMatchObject({ stage: "roundEnd", result: { winner: "a", awarded: 100, via: "cleared" } });
    expect(state.teams.a.score).toBe(100);
  });

  it("skips a disconnected teammate", () => {
    send({ type: "disconnect", playerId: "a1" });
    answer("a2", 1);
    expect(round().activePlayerId).toBe("a2");
  });
});

describe("steal", () => {
  beforeEach(() => {
    setup();
    startToBuzz();
    teamAPlays();
    answer("a2", 1); // bank 65
    for (let i = 0; i < 3; i++) answer(round().activePlayerId!, null);
  });

  it("goes to the other team's captain after three strikes", () => {
    expect(round()).toMatchObject({ stage: "steal", activePlayerId: "b1", controllingTeam: "a" });
    expect(rejected({ type: "answer", playerId: "b2", text: "me" })).toMatch(/not your turn/i);
  });

  it("gives the bank to the stealing team without adding the stolen answer", () => {
    answer("b1", 2);
    expect(round().result).toEqual({ winner: "b", awarded: 65, via: "steal" });
    expect(round().revealed[2]).toBe(true);
    expect(state.teams).toMatchObject({ a: { score: 0 }, b: { score: 65 } });
  });

  it("leaves the bank with the original team when the steal fails", () => {
    answer("b1", null);
    expect(round().result).toEqual({ winner: "a", awarded: 65, via: "stealFailed" });
    expect(state.teams).toMatchObject({ a: { score: 65 }, b: { score: 0 } });
  });

  it("fails the steal on a timeout or an answer already on the board", () => {
    answer("b1", 0);
    expect(round().result).toMatchObject({ winner: "a", via: "stealFailed" });
  });
});

describe("game structure", () => {
  it("plays single, single, double, triple and ends when a team reaches 300", () => {
    setup();
    send({ type: "start", playerId: "a1" });
    teamAClearsBoard();
    expire();
    teamAClearsBoard();
    expect(state.teams.a.score).toBe(200);
    expire();
    expect(round().multiplier).toBe(2);
    teamAClearsBoard();
    expect(state.teams.a.score).toBe(400);
    expire();
    expect(state).toMatchObject({ phase: "fastMoney", winner: "a" });
    expect(picked.slice(0, 3).map((spec) => spec.multiplier)).toEqual([1, 1, 2]);
  });

  it("rotates who goes to the podium each round", () => {
    setup();
    send({ type: "start", playerId: "a1" });
    expect(round().faceoff.pair).toEqual({ a: "a1", b: "b1" });
    teamAClearsBoard();
    expire();
    expect(round().faceoff.pair).toEqual({ a: "a2", b: "b2" });
  });

  it("goes to sudden death on the top answer if nobody has 300 after four rounds", () => {
    setup(["a1"], ["b1"]);
    send({ type: "start", playerId: "a1" });
    for (let r = 0; r < 4; r++) {
      expire(); // intro
      expire(); // nobody buzzes
      expire(); // nobody buzzes again: question thrown out
      expect(round().result?.via).toBe("void");
      expire(); // round summary
    }
    expect(picked.map((spec) => spec.multiplier)).toEqual([1, 1, 2, 3, 3]);
    expect(round()).toMatchObject({ kind: "suddenDeath", multiplier: 3 });
    expect(round().question.answers).toHaveLength(1);

    expire();
    send({ type: "buzz", playerId: "a1" });
    answer("a1", null);
    answer("b1", 0);
    expect(round().result).toEqual({ winner: "b", awarded: 120, via: "cleared" });
    expire();
    expect(state).toMatchObject({ phase: "fastMoney", winner: "b" });
  });

  it("returns to the lobby with scores cleared when any player plays again", () => {
    setup(["a1"], ["b1"]);
    send({ type: "start", playerId: "a1" });
    for (let r = 0; r < 3; r++) {
      teamAClearsBoard();
      expire();
    }
    expect(rejected({ type: "playAgain", playerId: "b1" })).toMatch(/not over/i);
    sitOutFastMoney();
    expect(state.phase).toBe("finished");
    expect(rejected({ type: "endGame", playerId: "b1" })).toMatch(/no game/i);
    send({ type: "playAgain", playerId: "b1" });
    expect(state).toMatchObject({ phase: "lobby", round: null, winner: null });
    expect(state.teams.a.score).toBe(0);
    expect(state.usedQuestionIds).toHaveLength(8);
  });

  it("lets any player end a game in progress, clearing scores and any answer being judged", () => {
    setup();
    expect(rejected({ type: "endGame", playerId: "a1" })).toMatch(/no game/i);
    startToBuzz();
    teamAPlays();
    const { effects } = send({ type: "answer", playerId: round().activePlayerId!, text: "anything" });
    expect(rejected({ type: "endGame", playerId: "stranger" })).toMatch(/join/i);
    send({ type: "endGame", playerId: "b2" });
    expect(state).toMatchObject({ phase: "lobby", round: null, winner: null, judgeDown: false });
    // The verdict for the abandoned answer arrives late and is ignored.
    send({ type: "graded", requestId: effects[0].requestId, matchIndex: 1 });
    expect(state.phase).toBe("lobby");
    expect(state.teams.a.score + state.teams.b.score).toBe(0);
  });
});

describe("grader failure", () => {
  it("cancels the game and returns everyone to the lobby", () => {
    setup();
    startToBuzz();
    teamAPlays();
    const { effects } = send({ type: "answer", playerId: round().activePlayerId!, text: "anything" });
    send({ type: "gradeFailed", requestId: effects[0].requestId });
    expect(state.phase).toBe("lobby");
    expect(state.round).toBeNull();
    expect(state.judgeDown).toBe(true);
    expect(state.teams.a.score + state.teams.b.score).toBe(0);
    expect(toPublicState(state).judgeDown).toBe(true);
  });

  it("clears the warning when another game starts", () => {
    setup();
    startToBuzz();
    send({ type: "buzz", playerId: "a1" });
    const { effects } = send({ type: "answer", playerId: "a1", text: "anything" });
    send({ type: "gradeFailed", requestId: effects[0].requestId });
    send({ type: "start", playerId: "a1" });
    expect(state.phase).toBe("playing");
    expect(state.judgeDown).toBe(false);
  });

  it("ignores a failure for an answer that is no longer pending", () => {
    setup();
    startToBuzz();
    send({ type: "buzz", playerId: "a1" });
    answer("a1", 0);
    send({ type: "gradeFailed", requestId: "stale" });
    expect(state.phase).toBe("playing");
  });
});

describe("fast money", () => {
  it("lets the winning team choose its two players, in the order they step up", () => {
    setup(["a1", "a2", "a3"], ["b1"]);
    send({ type: "start", playerId: "a1" });
    for (let r = 0; r < 3; r++) {
      teamAClearsBoard();
      expire();
    }
    expect(fm()).toMatchObject({ stage: "pick", volunteers: [] });
    expect(rejected({ type: "volunteer", playerId: "b1", play: true })).toMatch(/winning team/i);
    expect(rejected({ type: "confirmPlayers", playerId: "a1" })).toMatch(/two players/i);

    send({ type: "volunteer", playerId: "a3", play: true });
    send({ type: "volunteer", playerId: "a1", play: true });
    expect(rejected({ type: "volunteer", playerId: "a2", play: true })).toMatch(/already in/i);
    send({ type: "volunteer", playerId: "a1", play: false });
    send({ type: "volunteer", playerId: "a2", play: true });
    expect(toPublicState(state, "a2").fastMoney).toMatchObject({ volunteers: ["a3", "a2"], isolated: false });
    expect(rejected({ type: "confirmPlayers", playerId: "b1" })).toMatch(/winning team/i);

    send({ type: "confirmPlayers", playerId: "a1" });
    expect(fm()).toMatchObject({ stage: "intro", playerIds: ["a3", "a2"] });
    expect(rejected({ type: "volunteer", playerId: "a1", play: true })).toMatch(/already been chosen/i);
  });

  it("fills empty seats from the team when nobody confirms in time", () => {
    setup(["a1", "a2", "a3"], ["b1"]);
    send({ type: "start", playerId: "a1" });
    for (let r = 0; r < 3; r++) {
      teamAClearsBoard();
      expire();
    }
    send({ type: "volunteer", playerId: "a2", play: true });
    fmExpire();
    expect(fm()).toMatchObject({ stage: "intro", playerIds: ["a2", "a1"] });
  });

  it("puts the chosen players on five fresh questions", () => {
    teamAWinsGame();
    expect(fm()).toMatchObject({ team: "a", playerIds: ["a1", "a2"], stage: "intro", turn: 0 });
    expect(fm().questions).toHaveLength(5);
    expect(picked.slice(-5).every((spec) => spec.kind === "fastMoney")).toBe(true);
    expect(new Set(state.usedQuestionIds).size).toBe(8);
  });

  it("skips Fast Money when the game is drawn", () => {
    setup(["a1"], ["b1"]);
    send({ type: "start", playerId: "a1" });
    // Four void rounds, then three void sudden deaths, with the scores level at zero.
    for (let r = 0; r < 7; r++) {
      expire();
      expire();
      expire();
      expire();
    }
    expect(state).toMatchObject({ phase: "finished", winner: null, fastMoney: null });
  });

  it("plays both turns, scores each answer by its survey points and finishes the game", () => {
    teamAWinsGame();
    fmExpire();
    expect(fm()).toMatchObject({ stage: "turn", turn: 0, questionIndex: 0 });
    expect(rejected({ type: "answer", playerId: "a2", text: "me first" })).toMatch(/not your turn/i);
    for (let q = 0; q < 5; q++) fmAnswer("a1", 0);
    expect(fm().stage).toBe("reveal");
    expect(fm().answers[0].map((slot) => slot?.points)).toEqual([40, 40, 40, 40, 40]);

    fmExpire(); // reveal
    expect(fm()).toMatchObject({ stage: "intro", turn: 1 });
    fmExpire(); // intro
    for (let q = 0; q < 5; q++) fmAnswer("a2", 1);
    fmExpire(); // reveal
    expect(state.phase).toBe("finished");
    expect(fm().stage).toBe("done");
    expect(toPublicState(state).fastMoney).toMatchObject({ total: 325, target: 200 });
  });

  it("makes the second player try again when they repeat the first player's answer", () => {
    teamAWinsGame();
    fmExpire();
    for (let q = 0; q < 5; q++) fmAnswer("a1", 0);
    fmExpire();
    fmExpire();
    fmAnswer("a2", 0);
    expect(fm()).toMatchObject({ questionIndex: 0, retry: true, pending: null });
    expect(fm().answers[1][0]).toBeNull();
    fmAnswer("a2", 2);
    expect(fm()).toMatchObject({ questionIndex: 1, retry: false });
    expect(fm().answers[1][0]).toMatchObject({ answerIndex: 2, points: 15 });
  });

  it("rejects a word-for-word repeat without asking the judge, even if the first answer scored nothing", () => {
    teamAWinsGame();
    fmExpire();
    for (let q = 0; q < 5; q++) fmAnswer("a1", null, "wrong");
    fmExpire();
    fmExpire();
    const deadline = fm().deadline;
    const { effects } = send({ type: "answer", playerId: "a2", text: "  WRONG " });
    expect(effects).toHaveLength(0);
    expect(fm()).toMatchObject({ questionIndex: 0, retry: true, pending: null, deadline });
  });

  it("does not treat two different misses on the same question as a repeat", () => {
    teamAWinsGame();
    fmExpire();
    for (let q = 0; q < 5; q++) fmAnswer("a1", null);
    fmExpire();
    fmExpire();
    const { effects } = send({ type: "answer", playerId: "a2", text: "also wrong" });
    send({ type: "graded", requestId: effects[0].requestId, matchIndex: null });
    expect(fm()).toMatchObject({ questionIndex: 1, retry: false });
  });

  it("stops the clock while an answer is judged and resumes it afterwards", () => {
    teamAWinsGame();
    fmExpire();
    const turnEnds = fm().deadline!;
    now += 5_000;
    const { effects } = send({ type: "answer", playerId: "a1", text: "something" });
    expect(fm()).toMatchObject({ deadline: null, remainingMs: turnEnds - now });
    now += 3_000; // a slow judge
    send({ type: "tick" });
    expect(fm().stage).toBe("turn");
    send({ type: "graded", requestId: effects[0].requestId, matchIndex: 3 });
    expect(fm().deadline).toBe(turnEnds + 3_000);
    expect(fm().questionIndex).toBe(1);
  });

  it("scores nothing for a pass or for questions not reached in time", () => {
    teamAWinsGame();
    fmExpire();
    fmAnswer("a1", 1);
    send({ type: "answer", playerId: "a1", text: "   " });
    expect(fm().questionIndex).toBe(2);
    fmExpire();
    expect(fm().stage).toBe("reveal");
    expect(fm().answers[0].map((slot) => slot?.points)).toEqual([25, 0, 0, 0, 0]);
    expect(fm().answers[0][1]).toEqual({ text: "", answerIndex: null, points: 0 });
  });

  it("keeps the second player in the dark until their own turn has been revealed", () => {
    teamAWinsGame();
    fmExpire();
    send({ type: "answer", playerId: "a1", text: "a secret answer" });
    const others = toPublicState(state, "b1").fastMoney!;
    expect(others.isolated).toBe(false);
    expect(others.rows[0].question).toBe(fm().questions[0].text);
    expect(others.rows[1].question).toBeNull();
    const second = toPublicState(state, "a2");
    expect(second.fastMoney).toMatchObject({ isolated: true, total: null });
    expect(JSON.stringify(second)).not.toContain(fm().questions[0].text);

    send({ type: "graded", requestId: String(state.seq), matchIndex: 0 });
    // Points stay hidden from everyone until the turn is over.
    expect(toPublicState(state, "b1").fastMoney!.rows[0].answers[0]).toEqual({ text: "a secret answer", points: null });
    expect(JSON.stringify(toPublicState(state, "a2"))).not.toContain("a secret answer");
    fmExpire(); // turn one runs out
    expect(toPublicState(state, "b1").fastMoney).toMatchObject({ total: 40 });
    expect(toPublicState(state, "a2").fastMoney!.rows[0].answers[0]).toBeNull();

    fmExpire(); // reveal
    fmExpire(); // intro for turn two
    fmAnswer("a2", 1, "my answer");
    const mine = toPublicState(state, "a2").fastMoney!;
    expect(mine.rows[0].answers).toEqual([null, { text: "my answer", points: null }]);
    fmExpire(); // turn two runs out
    expect(toPublicState(state, "a2").fastMoney).toMatchObject({ isolated: false, total: 65 });
  });

  it("lets a one-player team play both turns", () => {
    teamAWinsGame(["a1"], ["b1"]);
    expect(fm().playerIds).toEqual(["a1", "a1"]);
    expect(toPublicState(state, "a1").fastMoney!.isolated).toBe(false);
    fmExpire();
    for (let q = 0; q < 5; q++) fmAnswer("a1", 0);
    fmExpire();
    fmExpire();
    fmAnswer("a1", 0);
    expect(fm().retry).toBe(true);
    fmAnswer("a1", 1);
    expect(fm().questionIndex).toBe(1);
  });

  it("can be ended early, and is cancelled if the judge stops working", () => {
    teamAWinsGame();
    fmExpire();
    const { effects } = send({ type: "answer", playerId: "a1", text: "anything" });
    send({ type: "gradeFailed", requestId: effects[0].requestId });
    expect(state).toMatchObject({ phase: "lobby", fastMoney: null, judgeDown: true });

    send({ type: "start", playerId: "a1" });
    for (let r = 0; r < 3; r++) {
      teamAClearsBoard();
      expire();
    }
    send({ type: "endGame", playerId: "b1" });
    expect(state).toMatchObject({ phase: "lobby", fastMoney: null, judgeDown: false });
  });
});

describe("clock", () => {
  it("ignores an alarm that fires before the deadline", () => {
    setup();
    send({ type: "start", playerId: "a1" });
    now += DEFAULT_TIMINGS.introMs - 1;
    send({ type: "tick" });
    expect(round().stage).toBe("intro");
  });

  it("pauses when everyone has left and resumes when someone returns", () => {
    setup(["a1"], ["b1"]);
    startToBuzz();
    send({ type: "disconnect", playerId: "a1" });
    send({ type: "disconnect", playerId: "b1" });
    expire();
    expect(round()).toMatchObject({ stage: "faceoffBuzz", deadline: null });
    now += 60_000;
    send({ type: "connect", playerId: "b1" });
    expect(round().deadline).toBe(now + DEFAULT_TIMINGS.buzzMs);
  });
});

describe("public state", () => {
  it("hides answers until they are found or the round is over", () => {
    setup();
    startToBuzz();
    teamAPlays();
    const during = toPublicState(state).round!;
    expect(during.answers[0]).toEqual({ text: "Answer 0", points: 40, found: true });
    expect(during.answers.slice(1)).toEqual([null, null, null, null, null]);
    expect(JSON.stringify(toPublicState(state))).not.toContain("Answer 1");

    for (let i = 0; i < 3; i++) answer(round().activePlayerId!, null);
    answer("b1", null);
    const after = toPublicState(state).round!;
    expect(after.answers.every((a) => a !== null)).toBe(true);
    expect(after.answers[1]).toMatchObject({ found: false });
  });
});
