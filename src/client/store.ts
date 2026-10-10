import PartySocket from "partysocket";
import { create } from "zustand";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import type { PublicState } from "../shared/types";
import type { Platform } from "./platform";

interface Store {
  platform: Platform | null;
  connected: boolean;
  userId: string | null;
  /** Name supplied by the platform (Discord); null means the player types one. */
  presetName: string | null;
  game: PublicState | null;
  /** Server clock minus local clock, so countdowns agree across players. */
  clockOffset: number;
  error: string | null;
  fatal: string | null;
  connect(platform: Platform): void;
  send(message: ClientMessage): void;
  clearError(): void;
}

let socket: PartySocket | null = null;
let errorTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<Store>((set) => ({
  platform: null,
  connected: false,
  userId: null,
  presetName: null,
  game: null,
  clockOffset: 0,
  error: null,
  fatal: null,

  connect(platform) {
    socket?.close();
    set({ platform });
    socket = new PartySocket({
      host: window.location.host,
      prefix: `${platform.basePath.replace(/^\//, "")}${platform.basePath ? "/" : ""}parties`,
      party: "game-room",
      room: platform.roomId,
      query: platform.socketQuery,
    });
    socket.addEventListener("open", () => set({ connected: true }));
    socket.addEventListener("close", () => set({ connected: false }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      switch (message.type) {
        case "hello":
          return set({ userId: message.userId, presetName: message.presetName });
        case "state":
          return set({ game: message.state, clockOffset: message.serverNow - Date.now() });
        case "error":
          clearTimeout(errorTimer);
          errorTimer = setTimeout(() => set({ error: null }), 4000);
          return set({ error: message.message });
      }
    });
  },

  send(message) {
    socket?.send(JSON.stringify(message));
  },

  clearError() {
    set({ error: null });
  },
}));

export const send = (message: ClientMessage) => useStore.getState().send(message);
