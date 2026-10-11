import { routePartykitRequest } from "partyserver";
import { MAX_NAME_LENGTH, ROOM_NAME_PATTERN } from "../shared/protocol";
import { createGrader } from "./grader";
import type { GradeRequest } from "./grader";
import { IDENTITY_HEADER } from "./room";
import {
  authenticate,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  signSession,
  verifySession,
} from "./session";

export { GameRoom } from "./room";

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

/**
 * Anonymous browser sign-in: the first visit gets a random user id in a
 * signed cookie. With DEV_IDENTITIES on, `?as=2` hands back a token for a
 * separate identity so several tabs in one browser can be different players.
 */
async function anonymousSession(request: Request, env: Env): Promise<Response> {
  if (env.ALLOW_ANONYMOUS !== "true") return json({ error: "Anonymous play is disabled" }, { status: 403 });
  const url = new URL(request.url);
  const headers = new Headers();

  const existing = readCookie(request, SESSION_COOKIE);
  let identity = existing ? await verifySession(existing, env.SESSION_SECRET) : null;
  if (!identity || identity.name) {
    identity = { userId: `anon-${crypto.randomUUID()}` };
    const token = await signSession(identity, env.SESSION_SECRET);
    headers.set("set-cookie", sessionCookie(token, url.protocol === "https:"));
  }

  const as = url.searchParams.get("as");
  if (as && env.DEV_IDENTITIES === "true" && /^[A-Za-z0-9]{1,8}$/.test(as)) {
    const userId = `${identity.userId}~${as}`;
    return json({ userId, token: await signSession({ userId }, env.SESSION_SECRET) }, { headers });
  }
  return json({ userId: identity.userId, token: null }, { headers });
}

/**
 * Discord sign-in: swaps the one-time code from the Embedded App SDK for a
 * Discord access token, looks the user up, and issues our own session. The
 * Discord token is used once here and never stored or sent to the client.
 */
async function discordSession(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ error: "Discord is not configured on the server" }, { status: 503 });
  }
  const { code } = (await request.json().catch(() => ({}))) as { code?: unknown };
  if (typeof code !== "string" || !code) return json({ error: "Missing code" }, { status: 400 });

  const exchange = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!exchange.ok) {
    console.error("[discord] code exchange failed", exchange.status, (await exchange.text()).slice(0, 300));
    return json({ error: "Discord rejected the sign-in" }, { status: 401 });
  }
  const { access_token } = (await exchange.json()) as { access_token: string };

  const lookup = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!lookup.ok) {
    console.error("[discord] user lookup failed", lookup.status);
    return json({ error: "Could not read your Discord profile" }, { status: 502 });
  }
  const user = (await lookup.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };

  const token = await signSession(
    {
      userId: `discord-${user.id}`,
      name: (user.global_name || user.username).slice(0, MAX_NAME_LENGTH),
      ...(user.avatar ? { avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` } : {}),
    },
    env.SESSION_SECRET
  );
  return json({ token });
}

/**
 * Maintenance: wipes one room by its Durable Object id (as Cloudflare's API lists
 * them), unless someone is connected. Needs no password: the ids cannot be
 * guessed, and one from outside this namespace is rejected.
 */
async function purgeRoom(hexId: string, env: Env): Promise<Response> {
  let id: DurableObjectId;
  try {
    id = env.GameRoom.idFromString(hexId);
  } catch {
    return json({ error: "Unknown room" }, { status: 404 });
  }
  return json({ purged: await env.GameRoom.get(id).purgeIfEmpty() });
}

/**
 * Development only: judge one answer directly, for the grading eval script.
 * `?grader=`, `?model=` and `?threshold=` override the configured grader for one call.
 */
async function devGrade(request: Request, env: Env): Promise<Response> {
  if (env.DEV_IDENTITIES !== "true") return json({ error: "Not found" }, { status: 404 });
  const body = (await request.json()) as GradeRequest;
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const grader = searchParams.get("grader") ?? env.GRADER;
  const model = searchParams.get("model");
  const threshold = searchParams.get("threshold");
  const overrides = {
    ...(model ? { CLEF_MODEL: model, JEV_MODEL: model, OPENAI_MODEL: model } : {}),
    ...(threshold ? { CLEF_THRESHOLD: threshold, JEV_THRESHOLD: threshold } : {}),
  };
  const verdict = await createGrader({ ...env, ...overrides, GRADER: grader }).grade(body);
  return json({ ...verdict, ms: Date.now() - started });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/session" && request.method === "POST") return anonymousSession(request, env);
    if (url.pathname === "/api/discord/config") return json({ clientId: env.DISCORD_CLIENT_ID || null });
    if (url.pathname === "/api/discord/token" && request.method === "POST") return discordSession(request, env);
    if (url.pathname === "/api/dev/grade" && request.method === "POST") return devGrade(request, env);
    const purge = /^\/api\/rooms\/([0-9a-f]{64})\/purge$/.exec(url.pathname);
    if (purge && request.method === "POST") return purgeRoom(purge[1]!, env);

    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect: async (req, lobby) => {
        if (!ROOM_NAME_PATTERN.test(lobby.name)) return new Response("Invalid room", { status: 400 });
        const identity = await authenticate(req, env.SESSION_SECRET);
        if (!identity) return new Response("Unauthorized", { status: 401 });
        // Overwrite rather than append so a client cannot supply its own identity.
        const headers = new Headers(req.headers);
        headers.set(IDENTITY_HEADER, encodeURIComponent(JSON.stringify(identity)));
        return new Request(req, { headers });
      },
      // Rooms are only reachable over an authenticated socket.
      onBeforeRequest: () => new Response("Not found", { status: 404 }),
    });
    return routed ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
