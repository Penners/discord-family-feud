import { useState } from "react";
import { TEAM_IDS } from "../../shared/types";
import type { Player, PublicState, TeamId } from "../../shared/types";
import { send, useStore } from "../store";
import { Avatar } from "./Avatar";

export function Lobby({ game, me }: { game: PublicState; me: Player }) {
  const inviteUrl = useStore((s) => s.platform?.inviteUrl ?? null);
  const [copied, setCopied] = useState(false);
  const watching = game.players.filter((p) => p.team === null);
  const ready = TEAM_IDS.every((team) => game.players.some((p) => p.team === team && p.connected));

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lobby">
      <h1 className="logo">Family Feud</h1>
      {game.judgeDown && (
        <div className="notice" role="alert">
          <strong>The game was cancelled.</strong> The AI judge that checks answers has stopped responding, most
          likely because it has run out of credit. Games won't work until the developer tops it up.
        </div>
      )}
      <p className="muted">Pick a team. You need at least one player on each side.</p>

      <div className="lobby-teams">
        {TEAM_IDS.map((team) => (
          <TeamColumn key={team} team={team} game={game} me={me} />
        ))}
      </div>

      {watching.length > 0 && (
        <p className="muted">
          Not on a team yet: {watching.map((p) => p.name).join(", ")}
        </p>
      )}

      <div className="lobby-actions">
        <button className="button primary big" disabled={!ready} onClick={() => send({ type: "start" })}>
          Start game
        </button>
        {inviteUrl && (
          <button className="button" onClick={copyInvite}>
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        )}
      </div>
    </div>
  );
}

function TeamColumn({ team, game, me }: { team: TeamId; game: PublicState; me: Player }) {
  const players = game.players.filter((p) => p.team === team);
  const mine = me.team === team;
  return (
    <section className={`panel lobby-team team-${team}`}>
      <h2>{game.teams[team].name}</h2>
      <ul className="lobby-players">
        {players.map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            <Avatar player={p} size={32} />
            {p.name}
            {p.id === me.id && <span className="tag">you</span>}
            {!p.connected && <span className="tag">away</span>}
          </li>
        ))}
        {players.length === 0 && <li className="muted">Nobody yet</li>}
      </ul>
      <button className="button" onClick={() => send({ type: "setTeam", team: mine ? null : team })}>
        {mine ? "Leave team" : "Join team"}
      </button>
    </section>
  );
}
