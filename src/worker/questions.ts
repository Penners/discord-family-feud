import type { QuestionSpec } from "../engine/state";
import type { Question } from "../shared/types";
import bank from "./questions.json";

const questions = bank as Question[];

const fits = (question: Question, spec: QuestionSpec): boolean => {
  const count = question.answers.length;
  // Sudden death is decided on the top answer, so it needs a clear favourite.
  if (spec.kind === "suddenDeath") return question.answers[0].points >= 30;
  // Fast Money is scored on single answers, so each question needs one worth chasing.
  if (spec.kind === "fastMoney") return question.answers[0].points >= 25;
  // Bigger boards for single-value rounds, smaller ones once points multiply.
  return spec.multiplier === 1 ? count >= 6 : count <= 6;
};

export function pickQuestion(
  spec: QuestionSpec,
  usedIds: readonly string[],
  random: () => number = Math.random
): Question {
  const used = new Set(usedIds);
  const suitable = questions.filter((q) => fits(q, spec));
  const fresh = suitable.filter((q) => !used.has(q.id));
  // If a room somehow plays through every question, start reusing them.
  const pool = fresh.length > 0 ? fresh : suitable;
  return pool[Math.floor(random() * pool.length)];
}
