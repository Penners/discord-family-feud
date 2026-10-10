// Builds the question bundle the worker imports from the source list in
// data/megalist-normalised.json. Run with `npm run questions` after editing
// the source. Each answer keeps the show's wording for the board, plus an
// optional `accepts` note in plain English that only the grader reads.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(
  await fs.readFile(path.join(root, "data", "megalist-normalised.json"), "utf8")
);

const clean = (s) => s.replace(/\s+/g, " ").trim();

const questions = source
  .map((q) => ({
    id: q.id,
    text: clean(q.question),
    answers: q.answers
      .filter((a) => a.answer && Number.isFinite(a.points))
      .sort((a, b) => b.points - a.points)
      .map((a) => ({
        text: clean(a.answer),
        points: a.points,
        ...(a.accepts ? { accepts: clean(a.accepts) } : {}),
      })),
  }))
  .filter((q) => q.text && q.answers.length >= 4);

// One answer per line so the file is easy to skim. The bundler strips the
// whitespace, so this costs nothing in the deployed worker.
const format = (q) =>
  [
    "  {",
    `    "id": ${JSON.stringify(q.id)},`,
    `    "text": ${JSON.stringify(q.text)},`,
    '    "answers": [',
    q.answers.map((a) => `      ${JSON.stringify(a).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/","/g, '", "').replace(/,"(points|accepts)"/g, ', "$1"').replace(/":/g, '": ')}`).join(",\n"),
    "    ]",
    "  }",
  ].join("\n");

const out = path.join(root, "src", "worker", "questions.json");
await fs.writeFile(out, `[\n${questions.map(format).join(",\n")}\n]\n`);
console.log(`Wrote ${questions.length} questions to ${path.relative(root, out)}`);
