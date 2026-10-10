import { useState } from "react";
import { isMuted, setMuted } from "../sounds";

export function MuteButton() {
  const [muted, setLocal] = useState(isMuted());
  const toggle = () => {
    setMuted(!muted);
    setLocal(!muted);
  };
  return (
    <button className="mute" onClick={toggle} aria-pressed={muted} title={muted ? "Turn sound on" : "Turn sound off"}>
      {muted ? "Sound off" : "Sound on"}
    </button>
  );
}
