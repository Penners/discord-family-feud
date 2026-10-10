// Scores the configured grader against the hand-labelled cases in
// evals/grading-cases.json. Needs the dev server running with
// DEV_IDENTITIES=true:
//
//   npm run eval                 every case
//   npm run eval -- --limit 40   a quick sample
//   npm run eval -- --url http://localhost:5173
//   npm run eval -- --grader jev --model jev-latest   another grader, without changing config
//   npm run eval -- --save run.json                   keep every verdict
//   npm run eval -- --reveal                          mid-round: half of the other answers already showing
//
// Every case is one model call, so a full run uses real Workers AI quota.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const url = option("--url", "http://localhost:5173");
const limit = Number(option("--limit", Infinity));
const reveal = args.includes("--reveal");
const query = new URLSearchParams();
for (const name of ["grader", "model", "threshold"]) if (option(`--${name}`)) query.set(name, option(`--${name}`));

const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const questions = new Map(read("src/worker/questions.json").map((q) => [q.id, q]));
let cases = read("evals/grading-cases.json");
if (limit < cases.length) {
  // Spread the sample across the file rather than taking the first few questions.
  const step = cases.length / limit;
  cases = Array.from({ length: limit }, (_, i) => cases[Math.floor(i * step)]);
}

async function grade(testCase) {
  const question = questions.get(testCase.questionId);
  const response = await fetch(`${url}/api/dev/grade?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: question.text,
      answers: question.answers.map((a, k) => ({
        text: a.text,
        accepts: a.accepts,
        revealed: reveal && k % 2 === 1 && a.text !== testCase.expect,
      })),
      guess: testCase.guess,
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  const verdict = await response.json();
  const got = verdict.matchIndex !== null ? question.answers[verdict.matchIndex].text : verdict.vague ? "(too vague)" : null;
  return { ...testCase, got, confidence: verdict.confidence, ms: verdict.ms, source: verdict.source };
}

const results = new Array(cases.length);
let next = 0;
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await grade(cases[i]).catch((error) => ({ ...cases[i], error: String(error) }));
    }
  })
);

if (option("--save")) fs.writeFileSync(option("--save"), JSON.stringify(results, null, 1));
const failed = results.filter((r) => r.error);
if (failed.length) console.log(`${failed.length} calls failed, e.g. ${failed[0].error}\n`);
const done = results.filter((r) => !r.error);
const clear = done.filter((r) => !r.vague);
const vague = done.filter((r) => r.vague);
const asked = (r) => r.got === "(too vague)";

const right = clear.filter((r) => r.got === r.expect);
const wronglyAccepted = clear.filter((r) => r.expect === null && r.got !== null && !asked(r));
const wronglyRejected = clear.filter((r) => r.expect !== null && r.got === null);
const wrongSlot = clear.filter((r) => r.expect !== null && r.got !== null && !asked(r) && r.got !== r.expect);
const askedGood = clear.filter((r) => r.expect !== null && asked(r));
const askedWrong = clear.filter((r) => r.expect === null && asked(r));
const times = done.map((r) => r.ms).sort((a, b) => a - b);

console.log(`Grader: ${done[0]?.source ?? "?"}   cases: ${done.length}`);
console.log(`Right:                      ${right.length}/${clear.length} (${((100 * right.length) / clear.length).toFixed(1)}%)`);
console.log(`Wrong answer accepted:      ${wronglyAccepted.length}`);
console.log(`Good answer rejected:       ${wronglyRejected.length}`);
console.log(`Good answer, wrong slot:    ${wrongSlot.length}`);
console.log(`Good answer asked to be more specific: ${askedGood.length} (no penalty, player answers again)`);
console.log(`Wrong answer asked to be more specific: ${askedWrong.length}`);
console.log(`Vague cases: asked ${vague.filter(asked).length}, rejected ${vague.filter((r) => r.got === null).length}, matched ${vague.filter((r) => r.got !== null && !asked(r)).length} of ${vague.length}`);
console.log(`Latency: median ${times[times.length >> 1]}ms, p95 ${times[Math.floor(times.length * 0.95)]}ms\n`);

const show = (title, rows) => {
  if (!rows.length) return;
  console.log(title);
  for (const r of rows) console.log(`  "${r.guess}"  expected ${r.expect ?? "no match"}, got ${r.got ?? "no match"}`);
};
show("Wrong answers accepted:", wronglyAccepted);
show("Good answers rejected:", wronglyRejected);
show("Good answers put in the wrong slot:", wrongSlot);
