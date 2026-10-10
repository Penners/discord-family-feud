/**
 * Every platform (anonymous browser, Discord) ends up with the same signed
 * session, so the game room never needs to know where a player came from.
 */
export interface Identity {
  userId: string;
  /** Set when the platform vouches for the name (Discord); guests type theirs. */
  name?: string;
  avatarUrl?: string;
}

interface SessionPayload extends Identity {
  exp: number;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);

export async function signSession(identity: Identity, secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = { ...identity, exp: now + SESSION_TTL_MS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(token: string, secret: string, now = Date.now()): Promise<Identity | null> {
  try {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body)
    );
    if (!valid) return null;
    const { exp, ...identity } = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload;
    if (typeof identity.userId !== "string" || typeof exp !== "number" || exp < now) return null;
    return identity;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "ff_session";

export const readCookie = (request: Request, name: string): string | null => {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
};

export const sessionCookie = (token: string, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;

/** Resolves the caller from a `token` query parameter (Discord) or the session cookie (browser). */
export async function authenticate(request: Request, secret: string): Promise<Identity | null> {
  const token = new URL(request.url).searchParams.get("token") ?? readCookie(request, SESSION_COOKIE);
  return token ? verifySession(token, secret) : null;
}
