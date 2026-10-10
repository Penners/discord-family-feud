import { useEffect, useState } from "react";
import { Game } from "./components/Game";
import { JoinScreen } from "./components/JoinScreen";
import { Lobby } from "./components/Lobby";
import { MuteButton } from "./components/MuteButton";
import { usePrevious } from "./hooks";
import { initPlatform } from "./platform";
import { playSound, setSoundBasePath } from "./sounds";
import { useStore } from "./store";

// Guards against React strict mode running the start-up effect twice.
let booting: Promise<void> | null = null;

export function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const { game, userId, connected, error } = useStore();
  const phase = game?.phase;
  const previousPhase = usePrevious(phase);

  useEffect(() => {
    booting ??= initPlatform().then((platform) => {
      setSoundBasePath(platform.basePath);
      useStore.getState().connect(platform);
    });
    booting.catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (previousPhase === "lobby" && phase === "playing") playSound("intro", 0.35);
  }, [phase, previousPhase]);

  if (bootError) return <Splash title="Something went wrong" detail={bootError} />;
  if (!game || !userId) return <Splash title="Connecting…" />;

  const me = game.players.find((p) => p.id === userId);
  return (
    <div className="app">
      <MuteButton />
      {!me ? <JoinScreen /> : game.phase === "lobby" ? <Lobby game={game} me={me} /> : <Game game={game} me={me} />}
      {!connected && <div className="toast">Reconnecting…</div>}
      {connected && error && <div className="toast toast-error">{error}</div>}
    </div>
  );
}

function Splash({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="app splash">
      <h1 className="logo">Family Feud</h1>
      <p className="splash-title">{title}</p>
      {detail && <p className="muted">{detail}</p>}
    </div>
  );
}
