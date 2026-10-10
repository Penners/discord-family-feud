import { useState } from "react";
import type { Player } from "../../shared/types";

/** A stable colour per player, so the same person keeps the same badge all game. */
const hueFor = (id: string) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // Stepping by the golden angle keeps near-identical ids from landing on near-identical colours.
  return Math.round((hash % 997) * 137.508) % 360;
};

/** The player's Discord picture, or their initial on a coloured disc when there is none. */
export function Avatar({ player, size = 28 }: { player: Pick<Player, "id" | "name" | "avatarUrl">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.48 };
  if (player.avatarUrl && !broken) {
    return <img className="avatar" style={style} src={player.avatarUrl} alt="" onError={() => setBroken(true)} />;
  }
  const initial = [...player.name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span className="avatar avatar-initial" style={{ ...style, background: `hsl(${hueFor(player.id)} 62% 42%)` }} aria-hidden>
      {initial}
    </span>
  );
}
