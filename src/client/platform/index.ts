import { initBrowserPlatform } from "./browser";
import { initDiscordPlatform } from "./discord";
import type { Platform } from "./types";

export type { Platform } from "./types";

/** Discord launches activities in an iframe with a `frame_id` query parameter. */
const insideDiscord = () => new URLSearchParams(window.location.search).has("frame_id");

export async function initPlatform(): Promise<Platform> {
  return insideDiscord() ? initDiscordPlatform() : initBrowserPlatform();
}
