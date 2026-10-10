import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DEFAULT_TIMINGS } from "../../engine/state";
import { MAX_ANSWER_LENGTH } from "../../shared/protocol";
import type { Player, PublicFastMoney, PublicState } from "../../shared/types";
import { useCountdown } from "../hooks";
import { playSound } from "../sounds";
import { send } from "../store";
import { Avatar } from "./Avatar";
import { EndGameButton } from "./Game";

/** Keeps the question line from collapsing when there is nothing to show. */
const NBSP = String.fromCharCode(160);

/** Gap between one answer turning over and the next during a reveal. */
const REVEAL_STEP_MS = 1400;

/**
 * How many of the current turn's answers have been turned over. The server
 * sends every score at once when a turn ends; turning them over one at a
 * time is purely for show.
 */
function useRevealStep(fm: PublicFastMoney): number {
  const revealing = fm.stage === "reveal";
  const count = fm.rows.length;
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    if (!revealing) return;
    const interval = setInterval(() => setStep((n) => Math.min(n + 1, count)), REVEAL_STEP_MS);
    return () => clearInterval(interval);
  }, [revealing, fm.turn, count]);
  return revealing ? step : count;
}

export function FastMoney({ game, me }: { game: PublicState; me: Player }) {
  const fm = game.fastMoney!;
  const step = useRevealStep(fm);
  const players = fm.playerIds.map((id) => game.players.find((p) => p.id === id));
  const name = (turn: number) => players[turn]?.name ?? "Someone";
  const teamName = game.teams[fm.team].name;
  const solo = fm.playerIds[0] === fm.playerIds[1];

  /** A slot's score, or null while it is still face down. */
  const shownPoints = (turn: number, row: number): number | null => {
    const points = fm.rows[row].answers[turn]?.points ?? null;
    if (fm.stage === "reveal" && turn === fm.turn && row >= step) return null;
    return points;
  };

  useEffect(() => {
    if (fm.stage !== "reveal" || step === 0) return;
    const points = fm.rows[step - 1].answers[fm.turn]?.points;
    if (points !== null && points !== undefined) playSound(points > 0 ? "correct" : "incorrect");
    // Only a newly turned-over answer should make a sound.
  }, [step]);

  useEffect(() => {
    if (fm.retry) playSound("incorrect");
  }, [fm.retry]);

  const total = fm.isolated
    ? null
    : fm.rows.reduce((sum, _, row) => sum + (shownPoints(0, row) ?? 0) + (shownPoints(1, row) ?? 0), 0);
  const won = fm.stage === "done" && (fm.total ?? 0) >= fm.target;
  const picking = fm.stage === "pick";
  const inBooth = fm.isolated && fm.turn === 0;
  const currentQuestion = fm.stage === "turn" ? fm.rows[fm.questionIndex]?.question : null;

  let status: string;
  if (picking) {
    status = `${teamName} win the game! Who's playing Fast Money?`;
  } else if (fm.stage === "done") {
    status = won
      ? `${teamName} win Fast Money with ${fm.total} points!`
      : `${fm.total} points: ${fm.target - (fm.total ?? 0)} short of the ${fm.target} needed.`;
  } else if (fm.stage === "intro" && fm.turn === 0) {
    status = `${solo ? `${teamName} win the game! ` : ""}${name(0)} goes first: five questions, ${DEFAULT_TIMINGS.fastMoneyTurnMs[0] / 1000} seconds.`;
  } else if (fm.stage === "intro") {
    status = `${name(1)}, you're up: ${DEFAULT_TIMINGS.fastMoneyTurnMs[1] / 1000} seconds${solo ? ", and no repeating your first answers." : `. You can't repeat ${name(0)}'s answers.`}`;
  } else if (fm.stage === "reveal") {
    status = `Survey says… ${name(fm.turn)}'s answers`;
  } else if (fm.judging) {
    status = "Checking the survey…";
  } else if (fm.retry) {
    status = "Already said! Try again.";
  } else {
    status = `${name(fm.turn)} to answer`;
  }

  return (
    <div className="game fast-money">
      {game.phase === "fastMoney" && <EndGameButton />}
      <header className="fm-head">
        <div>
          <h1 className="fm-title">Fast Money</h1>
          <span className={`fm-team team-${fm.team}`}>{teamName}</span>
        </div>
        <div className={`bank fm-total ${won ? "won" : ""}`}>
          <span className="bank-label">Target {fm.target}</span>
          <span className="bank-value">{total ?? "?"}</span>
        </div>
      </header>

      <main className="stage">
        <h2 className="question">
          {picking ? "Pick two players" : inBooth ? "No peeking!" : (currentQuestion ?? NBSP)}
        </h2>

        {picking ? (
          <PickPlayers game={game} fm={fm} me={me} />
        ) : inBooth ? (
          <div className="panel fm-booth">
            <p>You're up second, so you can't see or hear {name(0)}'s turn.</p>
            <p className="muted">Your {DEFAULT_TIMINGS.fastMoneyTurnMs[1] / 1000} seconds start when they're done.</p>
          </div>
        ) : (
          <div className="fm-board">
            <div className="fm-row fm-columns">
              <span />
              {[0, 1].map((turn) => (
                <span key={turn} className={`fm-player ${fm.stage !== "done" && fm.turn === turn ? "active" : ""}`}>
                  {players[turn] && <Avatar player={players[turn]} size={22} />}
                  {name(turn)}
                  {solo && (turn === 0 ? " (first go)" : " (second go)")}
                </span>
              ))}
            </div>
            {fm.rows.map((row, index) => (
              <div key={index} className="fm-row">
                <span className="fm-question">{row.question ?? ""}</span>
                {[0, 1].map((turn) => {
                  const slot = row.answers[turn];
                  const points = shownPoints(turn, index);
                  const answering = fm.stage === "turn" && fm.turn === turn && fm.questionIndex === index;
                  const covered = fm.isolated && turn === 0;
                  return (
                    <span
                      key={turn}
                      className={`fm-slot ${answering ? "answering" : ""} ${covered ? "covered" : ""} ${points !== null && points > 0 ? "scored" : ""}`}
                    >
                      <span className="fm-answer">{covered ? "hidden" : slot ? slot.text || "—" : ""}</span>
                      <span className="fm-points">{points ?? ""}</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className="status">
          <p className="status-main">{status}</p>
        </div>
        <TurnTimer fm={fm} />
      </main>

      <footer className="actions">
        <Actions fm={fm} me={me} waitingFor={name(fm.turn)} />
      </footer>
    </div>
  );
}

/** The winning team puts two players forward, then anyone on the team confirms. */
function PickPlayers({ game, fm, me }: { game: PublicState; fm: PublicFastMoney; me: Player }) {
  const team = game.players.filter((p) => p.team === fm.team);
  const onTeam = me.team === fm.team;
  const needed = Math.min(2, team.filter((p) => p.connected).length);
  const full = fm.volunteers.length >= 2;
  return (
    <div className="panel fm-pick">
      <ul className="fm-pick-list">
        {team.map((p) => {
          const place = fm.volunteers.indexOf(p.id);
          const mine = p.id === me.id;
          return (
            <li key={p.id} className={`${place >= 0 ? "in" : ""} ${p.connected ? "" : "offline"}`}>
              <Avatar player={p} size={34} />
              <span className="fm-pick-name">
                {p.name}
                {mine && <span className="tag">you</span>}
              </span>
              {place >= 0 && <span className="fm-pick-place">{place === 0 ? "Goes first" : "Goes second"}</span>}
              {mine && (
                <button
                  className={`button ${place >= 0 ? "" : "primary"}`}
                  disabled={place < 0 && full}
                  onClick={() => send({ type: "volunteer", play: place < 0 })}
                >
                  {place >= 0 ? "Step down" : "I'll play"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {onTeam && (
        <button
          className="button primary big"
          disabled={fm.volunteers.length < needed}
          onClick={() => send({ type: "confirmPlayers" })}
        >
          Start Fast Money
        </button>
      )}
    </div>
  );
}

function TurnTimer({ fm }: { fm: PublicFastMoney }) {
  const countdown = useCountdown(fm.deadline);
  const timed = fm.stage === "turn" || fm.stage === "pick";
  const length = fm.stage === "pick" ? DEFAULT_TIMINGS.fastMoneyPickMs : DEFAULT_TIMINGS.fastMoneyTurnMs[fm.turn];
  // While an answer is judged the clock is stopped at `remainingMs`.
  const remaining = Math.min(countdown ?? fm.remainingMs ?? 0, length);
  return (
    <div className={`timer ${timed ? "" : "idle"} ${timed && remaining < 5000 ? "urgent" : ""}`}>
      <div className="timer-bar" style={{ transform: `scaleX(${timed ? remaining / length : 0})` }} />
      <span className="timer-text">{timed ? Math.ceil(remaining / 1000) : ""}</span>
    </div>
  );
}

function Actions({ fm, me, waitingFor }: { fm: PublicFastMoney; me: Player; waitingFor: string }) {
  if (fm.stage === "pick") {
    const hint =
      me.team === fm.team
        ? "Players go in the order they step up. If time runs out, teammates fill any empty seat."
        : "The winning team is choosing its players…";
    return <p className="actions-hint muted">{hint}</p>;
  }
  if (fm.stage === "done") {
    return (
      <div className="actions-row">
        <button className="button primary big" onClick={() => send({ type: "playAgain" })}>
          Play again
        </button>
      </div>
    );
  }
  const myTurn = fm.stage === "turn" && fm.playerIds[fm.turn] === me.id;
  if (myTurn && !fm.judging) return <AnswerForm key={`${fm.turn}-${fm.questionIndex}`} />;
  let hint = "";
  if (fm.stage === "turn") hint = myTurn ? "Checking the survey…" : `Waiting for ${waitingFor}…`;
  else if (fm.stage === "intro") hint = fm.playerIds[fm.turn] === me.id ? "Get ready…" : "";
  return <p className="actions-hint muted">{hint}</p>;
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
      {/* An empty answer is a pass: no points, straight on to the next question. */}
      <button type="button" className="button" onClick={() => send({ type: "answer", text: "" })}>
        Pass
      </button>
    </form>
  );
}
