import { describeAnswer, describeSituation, JUDGING_RULES } from "./prompt";
import type { Grader, GradeRequest } from "./types";

const NONE = "none";
const VAGUE = "vague";
const optionId = (index: number) => `a${index}`;

const INSTRUCTIONS = `${JUDGING_RULES} Which group does the contestant's answer belong to?`;

/** The request body shared by decision models (Clef and Jev use the same shape). */
export interface DecisionInput {
  state: string;
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>;
}

interface DecisionOutput {
  answers?: { match?: { probabilities?: Record<string, number> } };
}

/**
 * Grades with a decision model. It is asked one multiple-choice question:
 * which board answer is this, is it too vague, or is it not there. A board
 * answer must be the top option with at least `threshold` probability to count.
 * The wording and threshold are tuned with `npm run eval` (see evals/).
 */
export function createDecisionGrader(
  name: string,
  threshold: number,
  ask: (input: DecisionInput) => Promise<unknown>
): Grader {
  return {
    name,
    async grade(request: GradeRequest) {
      const criteria: Record<string, string> = {};
      request.answers.forEach((answer, index) => {
        criteria[optionId(index)] = `It would be counted under the board answer: ${describeAnswer(answer)}`;
      });
      criteria[VAGUE] =
        "It is too broad to judge: it could equally belong to two or more board answers, so the host asks the contestant to be more specific";
      criteria[NONE] = "It would not be counted under any board answer";

      const response = (await ask({
        state: describeSituation(request),
        questions: { match: { type: "choice", instructions: INSTRUCTIONS, criteria } },
      })) as DecisionOutput;

      const probabilities = response.answers?.match?.probabilities;
      if (!probabilities) throw new Error(`Unexpected ${name} response: ${JSON.stringify(response).slice(0, 300)}`);
      const [top, confidence] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];

      const index = top.startsWith("a") ? Number(top.slice(1)) : -1;
      if (index >= 0 && index < request.answers.length && confidence >= threshold) {
        return { matchIndex: index, source: name, confidence };
      }
      // No confident match: ask for a clearer answer only if that beats "not on the board".
      const vague = (probabilities[VAGUE] ?? 0) > (probabilities[NONE] ?? 0);
      return { matchIndex: null, vague, source: name, confidence };
    },
  };
}
