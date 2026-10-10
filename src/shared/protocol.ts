import { z } from "zod";
import type { PublicState } from "./types";

export const MAX_NAME_LENGTH = 24;
export const MAX_ANSWER_LENGTH = 60;

const team = z.enum(["a", "b"]);

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) }),
  z.object({ type: z.literal("setTeam"), team: team.nullable() }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("buzz") }),
  z.object({ type: z.literal("answer"), text: z.string().max(MAX_ANSWER_LENGTH) }),
  z.object({ type: z.literal("choose"), play: z.boolean() }),
  z.object({ type: z.literal("playAgain") }),
  z.object({ type: z.literal("endGame") }),
  z.object({ type: z.literal("volunteer"), play: z.boolean() }),
  z.object({ type: z.literal("confirmPlayers") }),
  /** Development only: the sender's team wins on the spot, to reach Fast Money without a whole game. */
  z.object({ type: z.literal("devWin") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ServerMessage =
  /** `dev` is true when the server has its development features on (DEV_IDENTITIES). */
  | { type: "hello"; userId: string; presetName: string | null; dev: boolean }
  | { type: "state"; state: PublicState; serverNow: number }
  | { type: "error"; message: string };

export const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
