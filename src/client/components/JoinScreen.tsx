import { useState } from "react";
import type { FormEvent } from "react";
import { MAX_NAME_LENGTH } from "../../shared/protocol";
import { send } from "../store";

const NAME_KEY = "ff-name";

const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

export function JoinScreen() {
  const [name, setName] = useState(savedName);
  const trimmed = name.trim();

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    try {
      localStorage.setItem(NAME_KEY, trimmed);
    } catch {
      // Not being able to remember the name is fine.
    }
    send({ type: "join", name: trimmed });
  };

  return (
    <div className="splash">
      <h1 className="logo">Family Feud</h1>
      <form className="panel join" onSubmit={join}>
        <label htmlFor="name">What should we call you?</label>
        <input
          id="name"
          autoFocus
          autoComplete="off"
          maxLength={MAX_NAME_LENGTH}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="button primary" disabled={!trimmed}>
          Join game
        </button>
      </form>
    </div>
  );
}
