import { createClefGrader } from "./clef";
import { createJevGrader } from "./jev";
import { createOpenAIGrader } from "./openai";
import type { Grader } from "./types";

export type { Grader, GradeRequest, GradeResult } from "./types";

const TIMEOUT_MS = 6_000;

/** Fails a grading call that takes too long, so a round never hangs on the model. */
function withTimeout(grader: Grader, ms = TIMEOUT_MS): Grader {
  return {
    name: grader.name,
    grade: (request) =>
      Promise.race([
        grader.grade(request),
        new Promise<never>((_, fail) =>
          setTimeout(() => fail(new Error(`${grader.name} timed out after ${ms}ms`)), ms)
        ),
      ]),
  };
}

/**
 * Picks the grader from the GRADER variable:
 *   "clef"   - Workers AI Clef (default; needs the AI binding)
 *   "jev"    - TypeSafe Jev (needs JEV_KEY; JEV_MODEL and JEV_THRESHOLD are optional)
 *   "openai" - OpenAI or any compatible endpoint (needs OPENAI_API_KEY and OPENAI_MODEL)
 * To add another provider, implement `Grader` and add a case here.
 */
export function createGrader(env: Env): Grader {
  switch (env.GRADER || "clef") {
    case "clef": {
      const model = env.CLEF_MODEL === "clef-flash" ? "clef-flash" : "clef";
      const threshold = Number(env.CLEF_THRESHOLD ?? "0.3");
      return withTimeout(createClefGrader(env.AI, { model, threshold }));
    }
    case "jev": {
      if (!env.JEV_KEY) throw new Error('GRADER is "jev" but JEV_KEY is missing');
      const threshold = Number(env.JEV_THRESHOLD ?? "0.7");
      return withTimeout(
        createJevGrader({ apiKey: env.JEV_KEY, model: env.JEV_MODEL || "jev-latest", threshold, baseUrl: env.JEV_BASE_URL })
      );
    }
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      const model = env.OPENAI_MODEL;
      if (!apiKey || !model) throw new Error('GRADER is "openai" but OPENAI_API_KEY or OPENAI_MODEL is missing');
      return withTimeout(createOpenAIGrader({ apiKey, model, baseUrl: env.OPENAI_BASE_URL }));
    }
    default:
      throw new Error(`Unknown GRADER "${env.GRADER}"`);
  }
}
