import { Server } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { pendingGrade, reduce } from "../engine/reducer";
import type { Effect, GameEvent } from "../engine/reducer";
import { initialState, nextDeadline, toPublicState } from "../engine/state";
import type { GameState } from "../engine/state";
import { ClientMessage } from "../shared/protocol";
import type { ServerMessage } from "../shared/protocol";
import { createGrader } from "./grader";
import type { Grader } from "./grader";
import { pickQuestion } from "./questions";
import type { Identity } from "./session";

/** Set by the worker after it has verified the session; never trusted from clients. */
export const IDENTITY_HEADER = "x-ff-identity";

const STATE_KEY = "state";
/** A failed grading call is tried once more after this long before the game is called off. */
const GRADE_RETRY_MS = 750;

interface ConnectionData {
  userId: string;
}

export class GameRoom extends Server<Env> {
  static options = { hibernate: true };

  #state: GameState = initialState();
  #grader: Grader | null = null;

  async onStart() {
    this.#state = (await this.ctx.storage.get<GameState>(STATE_KEY)) ?? initialState();

    // Sockets can open and close while the room is asleep or restarting, so
    // rebuild presence from the connections that are actually here.
    const online = new Set([...this.getConnections<ConnectionData>()].map((c) => c.state?.userId));
    for (const player of this.#state.players) {
      if (player.connected !== online.has(player.id)) {
        this.dispatch({ type: online.has(player.id) ? "connect" : "disconnect", playerId: player.id });
      }
    }

    // An answer was mid-grading when the room went away: judge it again.
    const pending = pendingGrade(this.#state);
    if (pending) this.runEffect(pending);
    await this.syncAlarm();
  }

  getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
    const identity = readIdentity(ctx.request);
    return identity ? [identity.userId] : [];
  }

  onConnect(connection: Connection<ConnectionData>, ctx: ConnectionContext) {
    const identity = readIdentity(ctx.request);
    if (!identity) return connection.close(4401, "Unauthorized");
    connection.setState({ userId: identity.userId });
    this.send(connection, {
      type: "hello",
      userId: identity.userId,
      presetName: identity.name ?? null,
      dev: this.env.DEV_IDENTITIES === "true",
    });
    this.dispatch({
      type: "connect",
      playerId: identity.userId,
      name: identity.name,
      avatarUrl: identity.name ? (identity.avatarUrl ?? null) : undefined,
    });
  }

  onMessage(connection: Connection<ConnectionData>, message: WSMessage) {
    const userId = connection.state?.userId;
    if (!userId || typeof message !== "string") return;
    let parsed: ClientMessage;
    try {
      parsed = ClientMessage.parse(JSON.parse(message));
    } catch {
      return this.send(connection, { type: "error", message: "Unrecognised message" });
    }
    if (parsed.type === "devWin" && this.env.DEV_IDENTITIES !== "true") {
      return this.send(connection, { type: "error", message: "Not available" });
    }
    const error = this.dispatch({ ...parsed, playerId: userId });
    if (error) this.send(connection, { type: "error", message: error });
  }

  onClose(connection: Connection<ConnectionData>) {
    this.handleGone(connection);
  }

  onError(connection: Connection<ConnectionData>) {
    this.handleGone(connection);
  }

  async onAlarm() {
    this.dispatch({ type: "tick" });
    // Alarms can fire slightly early; make sure a still-pending deadline is rescheduled.
    await this.syncAlarm();
  }

  private handleGone(connection: Connection<ConnectionData>) {
    const userId = connection.state?.userId;
    if (!userId) return;
    // The same player may still be here in another tab.
    const others = [...this.getConnections<ConnectionData>(userId)].filter((c) => c.id !== connection.id);
    if (others.length === 0) this.dispatch({ type: "disconnect", playerId: userId });
  }

  /** Applies an event, persists and broadcasts the result. Returns a rejection message, if any. */
  private dispatch(event: GameEvent): string | undefined {
    const result = reduce(this.#state, event, { now: Date.now(), pickQuestion });
    if (result.error) return result.error;
    if (result.state === this.#state) return;
    this.#state = result.state;
    void this.ctx.storage.put(STATE_KEY, this.#state);
    void this.syncAlarm();
    this.broadcastState();
    for (const effect of result.effects) this.runEffect(effect);
  }

  private runEffect(effect: Effect) {
    this.ctx.waitUntil(
      this.grade(effect).then((verdict) => {
        if (verdict) this.dispatch({ type: "graded", requestId: effect.requestId, ...verdict });
        else this.dispatch({ type: "gradeFailed", requestId: effect.requestId });
      })
    );
  }

  /**
   * Judges an answer, trying twice. Null means the grader is not working (out
   * of credit, bad key, provider down), which calls the game off: counting the
   * answer as wrong would hand out strikes nobody earned.
   */
  private async grade(effect: Effect): Promise<{ matchIndex: number | null; vague?: boolean } | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.#grader ??= createGrader(this.env);
        const started = Date.now();
        const { matchIndex, vague, source } = await this.#grader.grade(effect);
        console.log(
          `[grade] ${JSON.stringify(effect.guess)} -> ${matchIndex !== null ? effect.answers[matchIndex]?.text : vague ? "too vague" : "no match"} (${source}, ${Date.now() - started}ms)`
        );
        return { matchIndex, vague };
      } catch (error) {
        console.error(`[grade] attempt ${attempt} failed`, error);
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, GRADE_RETRY_MS));
      }
    }
    return null;
  }

  private async syncAlarm() {
    const deadline = nextDeadline(this.#state);
    if (deadline === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(deadline, Date.now() + 1));
  }

  /** Each connection gets its own view, because Fast Money hides one player's turn from the other. */
  private broadcastState() {
    const serverNow = Date.now();
    for (const connection of this.getConnections<ConnectionData>()) {
      this.send(connection, { type: "state", state: toPublicState(this.#state, connection.state?.userId), serverNow });
    }
  }

  private send(connection: Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }
}

function readIdentity(request: Request): Identity | null {
  const header = request.headers.get(IDENTITY_HEADER);
  if (!header) return null;
  try {
    return JSON.parse(decodeURIComponent(header)) as Identity;
  } catch {
    return null;
  }
}
