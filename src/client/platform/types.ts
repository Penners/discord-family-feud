/**
 * Everything the app needs to know about where it is running. The game UI
 * and the socket only talk to this, never to Discord or the browser directly.
 */
export interface Platform {
  kind: "browser" | "discord";
  /** Which game room to join. */
  roomId: string;
  /** Extra socket query parameters, e.g. a session token where cookies are unavailable. */
  socketQuery: Record<string, string>;
  /** Prefix for requests back to our own server ("" in a browser, "/.proxy" inside Discord). */
  basePath: string;
  /** A link other people can open to join this room, if the platform has one. */
  inviteUrl: string | null;
}
