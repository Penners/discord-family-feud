import { otherTeam, TEAM_IDS } from "../shared/types";
import type {
  AttemptOutcome,
  Question,
  RoundResultVia,
  RoundStage,
  TeamId,
} from "../shared/types";
import {
  DEFAULT_TIMINGS,
  FAST_MONEY_QUESTIONS,
  MAX_DEAD_BUZZES,
  MAX_FACEOFF_PAIRS,
  MAX_STRIKES,
  MAX_VOID_SUDDEN_DEATHS,
  ROUND_MULTIPLIERS,
  SUDDEN_DEATH_MULTIPLIER,
  TARGET_SCORE,
} from "./state";
import type { FastMoneyState, GameState, QuestionSpec, RoundState, Timings } from "./state";

export type GameEvent =
  /** A socket opened. `name` is set when the platform already knows it (Discord). */
  | { type: "connect"; playerId: string; name?: string; avatarUrl?: string | null }
  | { type: "disconnect"; playerId: string }
  | { type: "join"; playerId: string; name: string }
  | { type: "setTeam"; playerId: string; team: TeamId | null }
  | { type: "start"; playerId: string }
  | { type: "buzz"; playerId: string }
  | { type: "answer"; playerId: string; text: string }
  | { type: "choose"; playerId: string; play: boolean }
  | { type: "playAgain"; playerId: string }
  | { type: "endGame"; playerId: string }
  /** A member of the winning team offers to play Fast Money, or steps back down. */
  | { type: "volunteer"; playerId: string; play: boolean }
  | { type: "confirmPlayers"; playerId: string }
  /** Development only: the player's team wins the game immediately. The room refuses it in production. */
  | { type: "devWin"; playerId: string }
  /** The room's alarm fired. */
  | { type: "tick" }
  /** The grader finished. `matchIndex` is the board slot matched, or null. */
  | { type: "graded"; requestId: string; matchIndex: number | null; vague?: boolean }
  /** The grader could not judge the pending answer at all (out of credit, down, ...). */
  | { type: "gradeFailed"; requestId: string };

export type Effect = {
  type: "grade";
  requestId: string;
  question: string;
  answers: { text: string; accepts?: string; revealed: boolean }[];
  guess: string;
};

export interface EngineEnv {
  now: number;
  pickQuestion(spec: QuestionSpec, usedIds: readonly string[]): Question;
  timings?: Timings;
}

export interface ReduceResult {
  state: GameState;
  effects: Effect[];
  /** Set when the event was rejected; the state is returned unchanged. */
  error?: string;
}

/** The grading request for an answer that is still waiting on its verdict, if there is one. */
export function pendingGrade(state: GameState): Effect | null {
  const round = state.round;
  if (state.phase === "playing" && round?.pending) {
    return {
      type: "grade",
      requestId: round.pending.requestId,
      question: round.question.text,
      answers: round.question.answers.map((a, i) => ({ text: a.text, accepts: a.accepts, revealed: round.revealed[i] })),
      guess: round.pending.text,
    };
  }
  const fm = state.fastMoney;
  if (state.phase === "fastMoney" && fm?.pending) {
    const question = fm.questions[fm.questionIndex];
    return {
      type: "grade",
      requestId: fm.pending.requestId,
      question: question.text,
      answers: question.answers.map((a) => ({ text: a.text, accepts: a.accepts, revealed: false })),
      guess: fm.pending.text,
    };
  }
  return null;
}

class Rejected extends Error {}
function reject(message: string): never {
  throw new Rejected(message);
}

export function reduce(prev: GameState, event: GameEvent, env: EngineEnv): ReduceResult {
  const s = structuredClone(prev);
  const effects: Effect[] = [];
  const t = env.timings ?? DEFAULT_TIMINGS;
  const now = env.now;

  // ---- helpers -----------------------------------------------------------

  const player = (id: string) => s.players.find((p) => p.id === id);
  const members = (team: TeamId) => s.players.filter((p) => p.team === team);
  /** Connected members, or everyone on the team if nobody is connected. */
  const available = (team: TeamId) => {
    const all = members(team);
    const connected = all.filter((p) => p.connected);
    return connected.length > 0 ? connected : all;
  };
  const anyoneConnected = () => s.players.some((p) => p.connected);

  const nextMember = (team: TeamId, afterId: string | null): string => {
    const all = members(team);
    const from = all.findIndex((p) => p.id === afterId);
    for (let k = 1; k <= all.length; k++) {
      const candidate = all[(from + k) % all.length];
      if (candidate.connected) return candidate.id;
    }
    return all[(from + 1) % all.length].id;
  };

  const faceoffPair = (): Record<TeamId, string> => {
    const pick = (team: TeamId) => {
      const pool = available(team);
      return pool[s.faceoffCounter % pool.length].id;
    };
    return { a: pick("a"), b: pick("b") };
  };

  const stageDuration = (stage: RoundStage): number =>
    ({
      intro: t.introMs,
      faceoffBuzz: t.buzzMs,
      faceoffAnswer: t.faceoffAnswerMs,
      playOrPass: t.decideMs,
      play: t.playMs,
      steal: t.stealMs,
      roundEnd: t.roundEndMs,
    })[stage];

  const enter = (round: RoundState, stage: RoundStage, activePlayerId: string | null, pause = 0) => {
    round.stage = stage;
    round.activePlayerId = activePlayerId;
    round.clarifying = false;
    round.deadline = now + pause + stageDuration(stage);
  };

  const requireRound = (): RoundState =>
    s.phase === "playing" && s.round ? s.round : reject("No round in progress");

  /** Ends whatever game there was and returns everyone to team selection. */
  const backToLobby = () => {
    s.phase = "lobby";
    s.round = null;
    s.fastMoney = null;
    s.winner = null;
    s.roundIndex = 0;
    s.players = s.players.filter((p) => p.connected);
    for (const team of TEAM_IDS) s.teams[team].score = 0;
  };

  // ---- round lifecycle ---------------------------------------------------

  const startRound = () => {
    const normal = s.roundIndex < ROUND_MULTIPLIERS.length;
    const kind = normal ? "normal" : "suddenDeath";
    const spec: QuestionSpec = { kind, multiplier: normal ? ROUND_MULTIPLIERS[s.roundIndex] : SUDDEN_DEATH_MULTIPLIER };
    const picked = env.pickQuestion(spec, s.usedQuestionIds);
    s.usedQuestionIds.push(picked.id);
    // Sudden death is played on the top answer only.
    const answers = normal ? picked.answers : picked.answers.slice(0, 1);
    const round: RoundState = {
      kind,
      multiplier: spec.multiplier,
      question: { ...picked, answers },
      revealed: answers.map(() => false),
      bank: 0,
      strikes: 0,
      stage: "intro",
      deadline: null,
      faceoff: { pair: faceoffPair(), pairsTried: 0, deadBuzzes: 0, leadTeam: null, first: null },
      controllingTeam: null,
      activePlayerId: null,
      pending: null,
      clarifying: false,
      lastAttempt: null,
      result: null,
    };
    s.faceoffCounter++;
    s.round = round;
    enter(round, "intro", null);
  };

  const endRound = (round: RoundState, winner: TeamId | null, via: RoundResultVia) => {
    const awarded = winner ? round.bank * round.multiplier : 0;
    if (winner) s.teams[winner].score += awarded;
    round.result = { winner, awarded, via };
    enter(round, "roundEnd", null, t.pauseMs);
  };

  const finish = (winner: TeamId | null) => {
    s.winner = winner;
    if (s.round) s.round.deadline = null;
    // The winners play Fast Money; a drawn game just ends.
    if (winner) startFastMoney(winner);
    else s.phase = "finished";
  };

  // ---- fast money --------------------------------------------------------

  const startFastMoney = (team: TeamId) => {
    const pool = available(team);
    const questions: Question[] = [];
    for (let i = 0; i < FAST_MONEY_QUESTIONS; i++) {
      const picked = env.pickQuestion({ kind: "fastMoney", multiplier: 1 }, s.usedQuestionIds);
      s.usedQuestionIds.push(picked.id);
      questions.push(picked);
    }
    const blank = () => questions.map(() => null);
    s.phase = "fastMoney";
    s.fastMoney = {
      team,
      // A one-player team plays both turns, so there is nothing to choose.
      playerIds: [pool[0].id, (pool[1] ?? pool[0]).id],
      volunteers: [],
      questions,
      stage: pool.length > 1 ? "pick" : "intro",
      turn: 0,
      questionIndex: 0,
      answers: [blank(), blank()],
      deadline: now + (pool.length > 1 ? t.fastMoneyPickMs : t.fastMoneyIntroMs),
      remainingMs: null,
      pending: null,
      retry: false,
    };
  };

  const requireFastMoney = (): FastMoneyState =>
    s.phase === "fastMoney" && s.fastMoney ? s.fastMoney : reject("Fast Money is not being played");

  /** Volunteers play in the order they stepped up; empty seats go to the next teammates in line. */
  const lockInFastMoneyPlayers = (fm: FastMoneyState) => {
    const pool = available(fm.team).map((p) => p.id);
    const chosen = [...fm.volunteers, ...pool.filter((id) => !fm.volunteers.includes(id))];
    fm.playerIds = [chosen[0], chosen[1] ?? chosen[0]];
    fm.stage = "intro";
    fm.deadline = now + t.fastMoneyIntroMs;
  };

  const endFastMoneyTurn = (fm: FastMoneyState) => {
    const answers = fm.answers[fm.turn];
    // Anything not reached before the clock ran out scores nothing.
    for (let i = 0; i < answers.length; i++) answers[i] ??= { text: "", answerIndex: null, points: 0 };
    fm.stage = "reveal";
    fm.pending = null;
    fm.retry = false;
    fm.remainingMs = null;
    fm.deadline = now + t.fastMoneyRevealMs;
  };

  /** Records the answer to the current question and moves on, restarting the clock where it stopped. */
  const recordFastMoneyAnswer = (fm: FastMoneyState, text: string, answerIndex: number | null, remainingMs: number) => {
    const question = fm.questions[fm.questionIndex];
    fm.answers[fm.turn][fm.questionIndex] = {
      text,
      answerIndex,
      points: answerIndex === null ? 0 : question.answers[answerIndex].points,
    };
    fm.pending = null;
    fm.retry = false;
    fm.remainingMs = null;
    fm.questionIndex++;
    if (fm.questionIndex >= fm.questions.length) return endFastMoneyTurn(fm);
    fm.deadline = now + remainingMs;
  };

  const fastMoneyAnswer = (fm: FastMoneyState, playerId: string, rawText: string) => {
    if (fm.stage !== "turn" || fm.playerIds[fm.turn] !== playerId) reject("It is not your turn to answer");
    if (fm.pending) reject("An answer is already being judged");
    const remainingMs = Math.max(0, (fm.deadline ?? now) - now);
    const text = rawText.replace(/\s+/g, " ").trim();
    // An empty answer is a pass.
    if (!text) return recordFastMoneyAnswer(fm, "", null, remainingMs);
    // Word for word what the first player said: no need to ask the judge, and the clock keeps running.
    const earlier = fm.turn === 1 ? fm.answers[0][fm.questionIndex]?.text : undefined;
    if (earlier && earlier.toLowerCase() === text.toLowerCase()) {
      fm.retry = true;
      return;
    }
    const requestId = String(++s.seq);
    fm.pending = { requestId, text };
    // The clock stops while the answer is judged, so a slow judge costs the player nothing.
    fm.remainingMs = remainingMs;
    fm.deadline = null;
    effects.push(pendingGrade(s)!);
  };

  const fastMoneyGraded = (fm: FastMoneyState, matchIndex: number | null) => {
    const question = fm.questions[fm.questionIndex];
    const valid = matchIndex !== null && Number.isInteger(matchIndex) && matchIndex >= 0 && matchIndex < question.answers.length;
    const index = valid ? matchIndex : null;
    const remainingMs = fm.remainingMs ?? 0;
    // The second player may not repeat the first player's answer: they must try again.
    if (fm.turn === 1 && index !== null && fm.answers[0][fm.questionIndex]?.answerIndex === index) {
      fm.pending = null;
      fm.retry = true;
      fm.remainingMs = null;
      fm.deadline = now + remainingMs;
      return;
    }
    recordFastMoneyAnswer(fm, fm.pending!.text, index, remainingMs);
  };

  const fastMoneyTick = (fm: FastMoneyState) => {
    if (fm.deadline === null || now < fm.deadline) return;
    switch (fm.stage) {
      case "pick":
        // Nobody confirmed in time: go with whoever volunteered.
        return lockInFastMoneyPlayers(fm);
      case "intro":
        fm.stage = "turn";
        fm.questionIndex = 0;
        fm.deadline = now + t.fastMoneyTurnMs[fm.turn];
        return;
      case "turn":
        return endFastMoneyTurn(fm);
      case "reveal":
        if (fm.turn === 0) {
          fm.turn = 1;
          fm.stage = "intro";
          fm.questionIndex = 0;
          fm.deadline = now + t.fastMoneyIntroMs;
          return;
        }
        fm.stage = "done";
        fm.deadline = null;
        s.phase = "finished";
        return;
    }
  };

  const leader = (): TeamId | null => {
    const { a, b } = s.teams;
    return a.score === b.score ? null : a.score > b.score ? "a" : "b";
  };

  const advance = (round: RoundState) => {
    if (round.kind === "suddenDeath") {
      // Whoever takes the sudden death question takes the game.
      if (round.result?.winner) return finish(round.result.winner);
      s.voidSuddenDeaths++;
      if (s.voidSuddenDeaths >= MAX_VOID_SUDDEN_DEATHS) return finish(leader());
      return startRound();
    }
    if (TEAM_IDS.some((team) => s.teams[team].score >= TARGET_SCORE)) return finish(leader());
    s.roundIndex++;
    startRound();
  };

  // ---- face-off ----------------------------------------------------------

  const nextFaceoffPair = (round: RoundState) => {
    round.faceoff.pair = faceoffPair();
    round.faceoff.first = null;
    s.faceoffCounter++;
  };

  const winFaceoff = (round: RoundState, team: TeamId) => {
    round.controllingTeam = team;
    if (round.revealed.every(Boolean)) return endRound(round, team, "cleared");
    enter(round, "playOrPass", round.faceoff.pair[team], t.pauseMs);
  };

  const afterFaceoffAttempt = (round: RoundState, team: TeamId, hitIndex: number | null) => {
    const fo = round.faceoff;
    const points = (index: number) => round.question.answers[index].points;

    if (!fo.first) {
      // The number one answer wins outright; anything else gives the opponent a go.
      if (hitIndex === 0) return winFaceoff(round, team);
      fo.first = { team, answerIndex: hitIndex };
      return enter(round, "faceoffAnswer", fo.pair[otherTeam(team)], t.pauseMs);
    }

    const first = fo.first;
    const secondBeatsFirst =
      hitIndex !== null && (first.answerIndex === null || points(hitIndex) > points(first.answerIndex));
    if (secondBeatsFirst) return winFaceoff(round, team);
    // A tie on points goes to whoever answered first.
    if (first.answerIndex !== null) return winFaceoff(round, first.team);

    // Neither answer is on the board: the next player from each team steps up.
    fo.pairsTried++;
    if (fo.pairsTried >= MAX_FACEOFF_PAIRS) return endRound(round, null, "void");
    nextFaceoffPair(round);
    enter(round, "faceoffAnswer", fo.pair[fo.leadTeam ?? first.team], t.pauseMs);
  };

  // ---- answers -----------------------------------------------------------

  const resolveAttempt = (round: RoundState, text: string, outcome: AttemptOutcome, answerIndex: number | null) => {
    const playerId = round.activePlayerId;
    const team = playerId ? player(playerId)?.team : null;
    if (!playerId || !team) return;
    const context = round.stage === "faceoffAnswer" ? "faceoff" : round.stage === "steal" ? "steal" : "play";
    const hitIndex = outcome === "hit" ? answerIndex : null;

    round.pending = null;
    round.lastAttempt = { seq: ++s.seq, playerId, team, text, outcome, answerIndex: hitIndex, context };
    if (hitIndex !== null) {
      round.revealed[hitIndex] = true;
      // A stolen answer goes up on the board but is not added to the bank.
      if (context !== "steal") round.bank += round.question.answers[hitIndex].points;
    }

    if (context === "faceoff") return afterFaceoffAttempt(round, team, hitIndex);

    if (context === "steal") {
      return hitIndex !== null
        ? endRound(round, team, "steal")
        : endRound(round, otherTeam(team), "stealFailed");
    }

    if (hitIndex !== null) {
      if (round.revealed.every(Boolean)) return endRound(round, team, "cleared");
      return enter(round, "play", nextMember(team, playerId), t.pauseMs);
    }
    round.strikes++;
    if (round.strikes >= MAX_STRIKES) {
      const stealing = otherTeam(team);
      // The stealing team's captain answers for them.
      return enter(round, "steal", available(stealing)[0].id, t.pauseMs);
    }
    enter(round, "play", nextMember(team, playerId), t.pauseMs);
  };

  const askToBeMoreSpecific = (round: RoundState) => {
    const playerId = round.activePlayerId;
    const team = playerId ? player(playerId)?.team : null;
    if (!playerId || !team || !round.pending) return;
    const context = round.stage === "faceoffAnswer" ? "faceoff" : round.stage === "steal" ? "steal" : "play";
    round.lastAttempt = { seq: ++s.seq, playerId, team, text: round.pending.text, outcome: "vague", answerIndex: null, context };
    round.pending = null;
    round.clarifying = true;
    round.deadline = now + t.pauseMs + stageDuration(round.stage);
  };

  const applyChoice = (round: RoundState, play: boolean) => {
    const winner = round.controllingTeam!;
    const team = play ? winner : otherTeam(winner);
    round.controllingTeam = team;
    round.strikes = 0;
    // Play continues down the line from whoever was at the podium.
    enter(round, "play", nextMember(team, round.faceoff.pair[team]));
  };

  // ---- event handling ----------------------------------------------------

  const resumeIfPaused = () => {
    const round = s.round;
    if (s.phase !== "playing" || !round || round.deadline !== null || round.pending) return;
    round.deadline = now + stageDuration(round.stage);
  };

  const handle = () => {
    switch (event.type) {
      case "connect": {
        const existing = player(event.playerId);
        if (existing) {
          existing.connected = true;
          if (event.name) existing.name = event.name;
          if (event.avatarUrl !== undefined) existing.avatarUrl = event.avatarUrl;
        } else if (event.name) {
          s.players.push({
            id: event.playerId,
            name: event.name,
            avatarUrl: event.avatarUrl ?? null,
            team: null,
            connected: true,
          });
        }
        resumeIfPaused();
        return;
      }

      case "join": {
        const existing = player(event.playerId);
        if (existing) {
          existing.name = event.name;
          existing.connected = true;
        } else {
          s.players.push({ id: event.playerId, name: event.name, avatarUrl: null, team: null, connected: true });
        }
        resumeIfPaused();
        return;
      }

      case "disconnect": {
        const p = player(event.playerId);
        if (!p) return;
        p.connected = false;
        return;
      }

      case "setTeam": {
        const p = player(event.playerId) ?? reject("Join the game first");
        // Mid-game, latecomers may join a team but nobody may switch sides.
        if (s.phase !== "lobby" && (p.team !== null || event.team === null)) reject("Teams are locked during a game");
        p.team = event.team;
        return;
      }

      case "start": {
        if (s.phase !== "lobby") reject("The game has already started");
        if (!player(event.playerId)) reject("Join the game first");
        s.players = s.players.filter((p) => p.connected);
        if (TEAM_IDS.some((team) => members(team).length === 0)) reject("Each team needs at least one player");
        for (const team of TEAM_IDS) s.teams[team].score = 0;
        s.phase = "playing";
        s.roundIndex = 0;
        s.winner = null;
        s.voidSuddenDeaths = 0;
        s.judgeDown = false;
        startRound();
        return;
      }

      case "buzz": {
        const round = requireRound();
        if (round.stage !== "faceoffBuzz") reject("The buzzers are not open");
        const team = player(event.playerId)?.team;
        if (!team || round.faceoff.pair[team] !== event.playerId) reject("You are not in this face-off");
        round.faceoff.leadTeam = team!;
        enter(round, "faceoffAnswer", event.playerId);
        return;
      }

      case "answer": {
        if (s.phase === "fastMoney") return fastMoneyAnswer(requireFastMoney(), event.playerId, event.text);
        const round = requireRound();
        const answering = round.stage === "faceoffAnswer" || round.stage === "play" || round.stage === "steal";
        if (!answering || round.activePlayerId !== event.playerId) reject("It is not your turn to answer");
        if (round.pending) reject("An answer is already being judged");
        const text = event.text.replace(/\s+/g, " ").trim();
        if (!text) return resolveAttempt(round, "", "miss", null);
        const requestId = String(++s.seq);
        round.pending = { requestId, playerId: event.playerId, text };
        round.deadline = null;
        effects.push({
          type: "grade",
          requestId,
          question: round.question.text,
          answers: round.question.answers.map((a, i) => ({ text: a.text, accepts: a.accepts, revealed: round.revealed[i] })),
          guess: text,
        });
        return;
      }

      case "graded": {
        const fm = s.fastMoney;
        if (s.phase === "fastMoney" && fm?.pending?.requestId === event.requestId) return fastMoneyGraded(fm, event.matchIndex);
        const round = s.round;
        // A late or repeated verdict for an answer that is no longer pending.
        if (s.phase !== "playing" || !round?.pending || round.pending.requestId !== event.requestId) return;
        const index = event.matchIndex;
        const valid = index !== null && Number.isInteger(index) && index >= 0 && index < round.revealed.length;
        // "Can you be more specific?" The same player answers again, once, with no penalty.
        if (!valid && event.vague && !round.clarifying) return askToBeMoreSpecific(round);
        const outcome: AttemptOutcome = !valid ? "miss" : round.revealed[index] ? "duplicate" : "hit";
        resolveAttempt(round, round.pending.text, outcome, valid ? index : null);
        return;
      }

      case "gradeFailed": {
        const pending = s.phase === "playing" ? s.round?.pending : s.phase === "fastMoney" ? s.fastMoney?.pending : null;
        if (pending?.requestId !== event.requestId) return;
        // Without a judge nobody can score fairly, so the game is called off rather than guessed at.
        backToLobby();
        s.judgeDown = true;
        return;
      }

      case "choose": {
        const round = requireRound();
        if (round.stage !== "playOrPass" || round.activePlayerId !== event.playerId) reject("It is not your decision");
        applyChoice(round, event.play);
        return;
      }

      case "volunteer": {
        const fm = requireFastMoney();
        if (fm.stage !== "pick") reject("The Fast Money players have already been chosen");
        if (player(event.playerId)?.team !== fm.team) reject("Only the winning team plays Fast Money");
        const at = fm.volunteers.indexOf(event.playerId);
        if (!event.play) {
          if (at >= 0) fm.volunteers.splice(at, 1);
          return;
        }
        if (at >= 0) return;
        if (fm.volunteers.length >= 2) reject("Two players are already in");
        fm.volunteers.push(event.playerId);
        return;
      }

      case "confirmPlayers": {
        const fm = requireFastMoney();
        if (fm.stage !== "pick") reject("The Fast Money players have already been chosen");
        if (player(event.playerId)?.team !== fm.team) reject("Only the winning team can confirm");
        if (fm.volunteers.length < Math.min(2, available(fm.team).length)) reject("Two players need to step up first");
        lockInFastMoneyPlayers(fm);
        return;
      }

      case "devWin": {
        requireRound();
        const team = player(event.playerId)?.team ?? reject("Join a team first");
        s.teams[team].score = Math.max(s.teams[team].score, TARGET_SCORE);
        finish(team);
        return;
      }

      case "playAgain": {
        if (s.phase !== "finished") reject("The game is not over");
        if (!player(event.playerId)) reject("Join the game first");
        backToLobby();
        return;
      }

      // Any player may call a game off, for example when people have to leave.
      case "endGame": {
        if (s.phase !== "playing" && s.phase !== "fastMoney") reject("There is no game in progress");
        if (!player(event.playerId)) reject("Join the game first");
        backToLobby();
        return;
      }

      case "tick": {
        if (s.phase === "fastMoney" && s.fastMoney) return fastMoneyTick(s.fastMoney);
        const round = s.round;
        if (s.phase !== "playing" || !round || round.deadline === null || now < round.deadline) return;
        // Nobody is here: stop the clock until someone reconnects.
        if (!anyoneConnected()) {
          round.deadline = null;
          return;
        }
        switch (round.stage) {
          case "intro":
            return enter(round, "faceoffBuzz", null);
          case "faceoffBuzz":
            round.faceoff.deadBuzzes++;
            if (round.faceoff.deadBuzzes >= MAX_DEAD_BUZZES) return endRound(round, null, "void");
            nextFaceoffPair(round);
            return enter(round, "faceoffBuzz", null);
          case "faceoffAnswer":
          case "play":
          case "steal":
            return resolveAttempt(round, "", "timeout", null);
          case "playOrPass":
            return applyChoice(round, true);
          case "roundEnd":
            return advance(round);
        }
      }
    }
  };

  try {
    handle();
  } catch (error) {
    if (error instanceof Rejected) return { state: prev, effects: [], error: error.message };
    throw error;
  }
  return { state: s, effects };
}
