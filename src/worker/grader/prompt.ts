import type { GradeRequest } from "./types";

/** How the show judges an answer. Shared by every grader so they are compared on equal terms. */
export const JUDGING_RULES =
  "Family Feud surveyed 100 people and grouped the responses that meant the same thing. Each board answer is " +
  "the show's playful label for one group: slang, jokes, and extra adjectives or numbers are decoration. A slash " +
  "separates alternative wordings or gives an example. The words in brackets after a label say in plain English " +
  "what the group covers. Decide whether the contestant's answer would have been counted in one of the groups. " +
  "Be generous, as the show's judges are: synonyms, slang, misspellings and specific examples of a general " +
  "answer all count, and so does the general thing when the label is a specific example. Only treat an answer " +
  "as too vague if it could equally belong to two or more groups.";

/** One board answer as the grader sees it: the label, plus its plain-English note if it has one. */
export const describeAnswer = (answer: GradeRequest["answers"][number]): string =>
  answer.accepts ? `${answer.text} (${answer.accepts})` : answer.text;

/**
 * The question and what the contestant said. Which answers are already showing
 * is deliberately left out: telling the model made it far less sure of plain
 * matches mid-round ("grapefruit" for GRAPEFRUITS fell from 0.96 to 0.6).
 */
export const describeSituation = (request: GradeRequest): string => {
  return [
    `Family Feud survey question: ${request.question}`,
    `The contestant answered: "${request.guess}"`,
  ].join("\n");
};
