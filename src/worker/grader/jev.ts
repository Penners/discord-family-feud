import { createDecisionGrader } from "./decision";
import type { Grader } from "./types";

export interface JevOptions {
  apiKey: string;
  /** For example "jev-latest" or a pinned version. */
  model: string;
  /** A board answer must be the top option with at least this probability to count. */
  threshold: number;
  baseUrl?: string;
}

/** TypeSafe's Jev decision model, called over its System One HTTP API. */
export function createJevGrader(options: JevOptions): Grader {
  const url = `${(options.baseUrl ?? "https://api.typesafe.ai").replace(/\/+$/, "")}/v1/systemone`;
  return createDecisionGrader(`jev:${options.model}`, options.threshold, async (input) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ model: options.model, ...input }),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  });
}
