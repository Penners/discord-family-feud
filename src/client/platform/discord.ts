import { DiscordSDK } from "@discord/embedded-app-sdk";
import type { Platform } from "./types";

/**
 * Inside Discord every request goes through Discord's proxy on
 * `<client id>.discordsays.com`. Depending on the proxy version our own
 * server sits behind "/.proxy" or at the root, so find out which answers.
 */
async function findBasePath(): Promise<{ basePath: string; clientId: string }> {
  for (const basePath of ["/.proxy", ""]) {
    try {
      const response = await fetch(`${basePath}/api/discord/config`);
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) continue;
      const { clientId } = (await response.json()) as { clientId: string | null };
      if (!clientId) throw new Error("The server has no DISCORD_CLIENT_ID configured.");
      return { basePath, clientId };
    } catch (error) {
      if (error instanceof Error && error.message.includes("DISCORD_CLIENT_ID")) throw error;
    }
  }
  throw new Error("Could not reach the game server through Discord. Check the Activity's URL mapping.");
}

/**
 * Discord Activity: Discord vouches for who the player is, and everyone in
 * the same Activity instance shares one room. The server swaps Discord's
 * one-time code for our own session token, which rides on the socket URL
 * because cookies are unreliable inside Discord's iframe.
 */
export async function initDiscordPlatform(): Promise<Platform> {
  const { basePath, clientId } = await findBasePath();
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const response = await fetch(`${basePath}/api/discord/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const detail = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(detail ?? "Discord sign-in failed.");
  }
  const session = (await response.json()) as { token: string };

  return {
    kind: "discord",
    // Instance ids contain only letters, digits and dashes, but keep to the room-name rule regardless.
    roomId: sdk.instanceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
    socketQuery: { token: session.token },
    basePath,
    inviteUrl: null,
  };
}
