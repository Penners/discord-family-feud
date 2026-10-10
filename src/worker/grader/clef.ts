import { createDecisionGrader } from "./decision";
import type { Grader } from "./types";

export interface ClefOptions {
  /** "clef" (accurate) or "clef-flash" (cheaper, but misjudges far more answers). */
  model: "clef" | "clef-flash";
  /** A board answer must be the top option with at least this probability to count. */
  threshold: number;
}

/** Cloudflare Workers AI decision model. */
export function createClefGrader(ai: Ai, options: ClefOptions): Grader {
  // Clef is newer than the model list in the generated types, hence the loose signature.
  const client = ai as unknown as { run(model: string, input: unknown): Promise<unknown> };
  return createDecisionGrader(`clef:${options.model}`, options.threshold, (input) =>
    client.run(`@cf/cloudflare/${options.model}`, { model: options.model, ...input })
  );
}
