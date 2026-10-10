import type { CSSProperties } from "react";
import type { PublicRound } from "../../shared/types";

/** The answer board: numbered tiles that flip over as answers are revealed. */
export function Board({ round }: { round: PublicRound }) {
  const count = round.answers.length;
  const columns = count > 1 ? 2 : 1;
  const rows = Math.ceil(count / columns);
  const hiddenAtIntro = round.stage === "intro";

  return (
    <div
      className={`board ${hiddenAtIntro ? "board-dim" : ""}`}
      style={{ "--rows": rows, "--columns": columns } as CSSProperties}
    >
      {round.answers.map((answer, index) => {
        // Answers nobody found flip over one after another at the end of the round.
        const delay = answer && !answer.found ? `${index * 0.35}s` : "0s";
        return (
          <div
            key={index}
            className={`tile ${answer ? "shown" : ""} ${answer && !answer.found ? "missed" : ""}`}
            style={{ "--delay": delay } as CSSProperties}
          >
            <div className="tile-inner">
              <div className="tile-face tile-front">
                <span className="tile-number">{index + 1}</span>
              </div>
              <div className="tile-face tile-back">
                <span className="tile-text">{answer?.text}</span>
                <span className="tile-points">{answer?.points}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
