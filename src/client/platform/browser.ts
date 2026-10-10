import type { Platform } from "./types";

const randomRoom = () => Math.random().toString(36).slice(2, 8);

/**
 * Plain browser tab: the room comes from `?room=`, and the server hands out
 * an anonymous user id in a cookie. `?as=2` asks for a separate identity so
 * one browser can play several seats (only honoured when the server allows it).
 */
export async function initBrowserPlatform(): Promise<Platform> {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("room");
  if (!roomId) {
    roomId = randomRoom();
    url.searchParams.set("room", roomId);
    window.history.replaceState(null, "", url);
  }

  const as = url.searchParams.get("as");
  const response = await fetch(`/api/session${as ? `?as=${encodeURIComponent(as)}` : ""}`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Could not start a session. Is anonymous play enabled?");
  const session = (await response.json()) as { userId: string; token: string | null };

  const invite = new URL(url);
  invite.searchParams.delete("as");
  return {
    kind: "browser",
    roomId,
    socketQuery: session.token ? { token: session.token } : {},
    basePath: "",
    inviteUrl: invite.toString(),
  };
}
