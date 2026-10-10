import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DEFAULT_TIMINGS } from "../../engine/state";
import { MAX_ANSWER_LENGTH } from "../../shared/protocol";
import { otherTeam, TEAM_IDS } from "../../shared/types";
import type { Attempt, Player, PublicRound, PublicState, RoundStage, TeamId } from "../../shared/types";
import { useCountdown, usePrevious } from "../hooks";
import { playSound } from "../sounds";
import { send } from "../store";
import { Avatar } from "./Avatar";
import { Board } from "./Board";

const STAGE_MS: Record<RoundStage, number> = {
  intro: DEFAULT_TIMINGS.introMs,
  faceoffBuzz: DEFAULT_TIMINGS.buzzMs,
  faceoffAnswer: DEFAULT_TIMINGS.faceoffAnswerMs,
  playOrPass: DEFAULT_TIMINGS.decideMs,
  play: DEFAULT_TIMINGS.playMs,
  steal: DEFAULT_TIMINGS.stealMs,
  roundEnd: DEFAULT_TIMINGS.roundEndMs,
};

const TIMED_STAGES: RoundStage[] = ["faceoffBuzz", "faceoffAnswer", "playOrPass", "play", "steal"];

const roundTitle = (game: PublicState, round: PublicRound) => {
  if (round.kind === "suddenDeath") return "Sudden death";
  const value = round.multiplier === 1 ? "Single" : round.multiplier === 2 ? "Double" : "Triple";
  return `Round ${game.roundIndex + 1} · ${value} points`;
};

/** Which team is answering right now (the stealing team during a steal). */
const teamOnTheClock = (game: PublicState, round: PublicRound): TeamId | null =>
  game.players.find((p) => p.id === round.activePlayerId)?.team ?? null;

export function Game({ game, me }: { game: PublicState; me: Player }) {
  const round = game.round;
  const flash = useAttemptFlash(round?.lastAttempt ?? null);
  const stage = round?.stage;
  const previousStage = usePrevious(stage);

  useEffect(() => {
    if (previousStage === "faceoffBuzz" && stage === "faceoffAnswer") playSound("buzz");
  }, [stage, previousStage]);

  if (!round) return null;
  const name = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "Someone";
  const strikesToShow = flash && flash.outcome !== "hit" && flash.outcome !== "vague" ? (flash.context === "play" ? round.strikes || 1 : 1) : 0;

  return (
    <div className="game">
      {game.phase === "playing" && <EndGameButton />}
      <header className="scorebar">
        <TeamPanel team="a" game={game} round={round} me={me} />
        <div className="bank">
          <span className="bank-label">{roundTitle(game, round)}</span>
          <span className="bank-value">{round.bank}</span>
          {round.multiplier > 1 && <span className="bank-multiplier">×{round.multiplier}</span>}
        </div>
        <TeamPanel team="b" game={game} round={round} me={me} />
      </header>

      <main className="stage">
        <h2 className="question">{round.stage === "intro" ? roundTitle(game, round) : round.question}</h2>
        <div className="board-wrap">
          <Board round={round} />
          {strikesToShow > 0 && (
            <div className="strike-flash" key={flash!.seq} aria-live="assertive">
              {Array.from({ length: strikesToShow }, (_, i) => (
                <span key={i}>X</span>
              ))}
            </div>
          )}
        </div>
        <Status game={game} round={round} name={name} />
        <Timer round={round} />
      </main>

      <footer className="actions">
        {game.phase === "finished" ? (
          <Finished />
        ) : (
          <Actions game={game} round={round} me={me} name={name} />
        )}
      </footer>
    </div>
  );
}

/** Keeps the latest judged answer on screen briefly so everyone sees the result. */
function useAttemptFlash(attempt: Attempt | null): Attempt | null {
  const [visible, setVisible] = useState<Attempt | null>(null);
  const seq = attempt?.seq;
  useEffect(() => {
    if (!attempt) return;
    if (attempt.outcome !== "vague") playSound(attempt.outcome === "hit" ? "correct" : "incorrect");
    setVisible(attempt);
    const timer = setTimeout(() => setVisible(null), DEFAULT_TIMINGS.pauseMs);
    return () => clearTimeout(timer);
    // Only a new attempt (a new seq) should replay the flash.
  }, [seq]);
  return visible;
}

function TeamPanel({ team, game, round, me }: { team: TeamId; game: PublicState; round: PublicRound; me: Player }) {
  const players = game.players.filter((p) => p.team === team);
  const inFaceoff = round.stage === "faceoffBuzz" || round.stage === "faceoffAnswer";
  const playing = game.phase === "playing" && round.controllingTeam === team && (round.stage === "play" || round.stage === "steal");
  const winner = game.phase === "finished" && game.winner === team;
  return (
    <section className={`team-panel team-${team} ${teamOnTheClock(game, round) === team ? "on-clock" : ""} ${winner ? "winner" : ""}`}>
      <div className="team-head">
        <span className="team-name">{game.teams[team].name}</span>
        <span className="team-score">{game.teams[team].score}</span>
      </div>
      <ul className="team-players">
        {players.map((p) => (
          <li
            key={p.id}
            className={[
              p.id === round.activePlayerId ? "active" : "",
              p.connected ? "" : "offline",
              inFaceoff && round.faceoffPlayers[team] === p.id ? "podium" : "",
            ].join(" ")}
          >
            <Avatar player={p} size={22} />
            <span>
              {p.name}
              {p.id === me.id && " (you)"}
            </span>
          </li>
        ))}
      </ul>
      {playing && (
        <div className="strikes" aria-label={`${round.strikes} strikes`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < round.strikes ? "on" : ""}>
              X
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Status({ game, round, name }: { game: PublicState; round: PublicRound; name: (id: string | null) => string }) {
  const teamName = (team: TeamId) => game.teams[team].name;
  let text: string;
  if (game.phase === "finished") {
    text = game.winner ? `${teamName(game.winner)} win the game!` : "It's a draw!";
  } else if (round.pending) {
    text = `${name(round.pending.playerId)} says “${round.pending.text}”…`;
  } else {
    switch (round.stage) {
      case "intro":
        text = "Get ready…";
        break;
      case "faceoffBuzz":
        text = `Face-off: ${name(round.faceoffPlayers.a)} vs ${name(round.faceoffPlayers.b)}. Buzz in!`;
        break;
      case "faceoffAnswer":
        text = `Face-off: ${name(round.activePlayerId)} to answer`;
        break;
      case "playOrPass":
        text = `${teamName(round.controllingTeam!)} won the face-off. ${name(round.activePlayerId)}: play or pass?`;
        break;
      case "play":
        text = `${name(round.activePlayerId)} to answer`;
        break;
      case "steal":
        text = `Three strikes! ${teamName(otherTeam(round.controllingTeam!))} can steal. ${name(round.activePlayerId)} answers for the team`;
        break;
      case "roundEnd":
        text = resultText(game, round);
        break;
    }
  }
  const last = round.lastAttempt;
  // Whoever the game is waiting on: the player answering, or both players at the buzzers.
  const spotlightIds =
    game.phase !== "playing"
      ? []
      : round.stage === "faceoffBuzz"
        ? [round.faceoffPlayers.a, round.faceoffPlayers.b]
        : [round.pending?.playerId ?? round.activePlayerId];
  const spotlight = spotlightIds.flatMap((id) => game.players.find((p) => p.id === id) ?? []);
  return (
    <div className="status">
      <p className="status-main">
        {spotlight.length > 0 && (
          <span className="status-avatars">
            {spotlight.map((p) => (
              <span key={p.id} className={`avatar-ring team-${p.team}`}>
                <Avatar player={p} size={44} />
              </span>
            ))}
          </span>
        )}
        {text}
      </p>
      {last && !round.pending && round.stage !== "roundEnd" && (
        <p className={`status-last ${last.outcome === "hit" ? "good" : last.outcome === "vague" ? "ask" : "bad"}`}>
          {name(last.playerId)}: {attemptText(last)}
        </p>
      )}
    </div>
  );
}

const attemptText = (attempt: Attempt) => {
  switch (attempt.outcome) {
    case "hit":
      return `“${attempt.text}” is on the board`;
    case "duplicate":
      return `“${attempt.text}” is already on the board`;
    case "timeout":
      return "ran out of time";
    case "vague":
      return `“${attempt.text}”… can you be more specific?`;
    case "miss":
      return attempt.text ? `“${attempt.text}” is not on the board` : "no answer";
  }
};

const resultText = (game: PublicState, round: PublicRound) => {
  const result = round.result;
  if (!result?.winner) return "Nobody got on the board. No points this round.";
  const team = game.teams[result.winner].name;
  const points = `${result.awarded} points`;
  switch (result.via) {
    case "steal":
      return `Stolen! ${team} take ${points}.`;
    case "stealFailed":
      return `The steal failed. ${team} keep ${points}.`;
    default:
      return `${team} cleared the board for ${points}.`;
  }
};

function Timer({ round }: { round: PublicRound }) {
  const countdown = useCountdown(round.deadline);
  const timed = TIMED_STAGES.includes(round.stage) && countdown !== null && !round.pending;
  const remaining = countdown ?? 0;
  const fraction = timed ? Math.min(1, remaining / STAGE_MS[round.stage]) : 0;
  return (
    <div className={`timer ${timed ? "" : "idle"} ${timed && remaining < 5000 ? "urgent" : ""}`}>
      <div className="timer-bar" style={{ transform: `scaleX(${fraction})` }} />
      <span className="timer-text">{timed ? Math.ceil(Math.min(remaining, STAGE_MS[round.stage]) / 1000) : ""}</span>
    </div>
  );
}

function Actions({
  game,
  round,
  me,
  name,
}: {
  game: PublicState;
  round: PublicRound;
  me: Player;
  name: (id: string | null) => string;
}) {
  const myTurn = round.activePlayerId === me.id && !round.pending;
  const answering = round.stage === "faceoffAnswer" || round.stage === "play" || round.stage === "steal";

  if (me.team === null) {
    return (
      <div className="actions-row">
        <span className="muted">You're watching.</span>
        {TEAM_IDS.map((team) => (
          <button key={team} className="button" onClick={() => send({ type: "setTeam", team })}>
            Join {game.teams[team].name}
          </button>
        ))}
      </div>
    );
  }

  if (round.stage === "faceoffBuzz" && round.faceoffPlayers[me.team] === me.id) return <Buzzer />;
  if (myTurn && answering) return <AnswerForm key={`${round.stage}-${round.lastAttempt?.seq ?? 0}`} />;
  if (myTurn && round.stage === "playOrPass") {
    return (
      <div className="actions-row">
        <button className="button primary big" onClick={() => send({ type: "choose", play: true })}>
          Play
        </button>
        <button className="button big" onClick={() => send({ type: "choose", play: false })}>
          Pass
        </button>
      </div>
    );
  }

  let hint = "";
  if (round.pending) hint = "Checking the survey…";
  else if (round.stage === "faceoffBuzz") hint = "Your teammate is at the podium.";
  else if (round.stage === "roundEnd") hint = "Next round coming up…";
  else if (round.stage === "steal" && teamOnTheClock(game, round) === me.team) hint = `Help ${name(round.activePlayerId)} pick the steal answer!`;
  else if (answering || round.stage === "playOrPass") hint = `Waiting for ${name(round.activePlayerId)}…`;
  return <p className="actions-hint muted">{hint}</p>;
}

function Buzzer() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        send({ type: "buzz" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button className="buzzer" onClick={() => send({ type: "buzz" })}>
      Buzz
      <small>or press space</small>
    </button>
  );
}

function AnswerForm() {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    send({ type: "answer", text });
  };
  return (
    <form className="answer-form" onSubmit={submit}>
      <input
        autoFocus
        autoComplete="off"
        maxLength={MAX_ANSWER_LENGTH}
        placeholder="Type your answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="button primary" disabled={!text.trim()}>
        Answer
      </button>
    </form>
  );
}

function Finished() {
  return (
    <div className="actions-row">
      <button className="button primary big" onClick={() => send({ type: "playAgain" })}>
        Play again
      </button>
    </div>
  );
}

/** Ends the game for everyone. Asks first, since one stray click would wipe the scores. */
function EndGameButton() {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);
  if (!confirming) {
    return (
      <button className="end-game" onClick={() => setConfirming(true)}>
        End game
      </button>
    );
  }
  return (
    <div className="end-game confirming" role="alertdialog" aria-label="End the game for everyone?">
      End for everyone?
      <button onClick={() => send({ type: "endGame" })}>Yes, end it</button>
      <button onClick={() => setConfirming(false)}>No</button>
    </div>
  );
}
