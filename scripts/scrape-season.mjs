// Scrapes one season of survey boards from https://mstiescott.neocities.org
// into data/season-<n>.json: a staging file (not committed) to annotate and
// merge into data/megalist-normalised.json, which it matches in shape.
//
//   node scripts/scrape-season.mjs 27                 download and parse
//   node scripts/scrape-season.mjs 27 --from <dir>    parse pages already saved as <dir>/27-<answers>.html
//
// Ids match the megalist: md5("<season>-<question>") for a question
// and md5("<season>-<question>-<answer>") for each of its answers.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://mstiescott.neocities.org";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [season, ...rest] = process.argv.slice(2);
if (!/^\d+$/.test(season ?? "")) {
  console.error("Usage: node scripts/scrape-season.mjs <season number> [--from <dir>]");
  process.exit(1);
}
const from = rest[0] === "--from" ? rest[1] : null;

const md5 = (input) => crypto.createHash("md5").update(input).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The pages are windows-1252, not UTF-8: decoding them properly keeps accents and curly quotes intact.
const decodePage = (bytes) => new TextDecoder("windows-1252").decode(bytes);

async function download(page) {
  const response = await fetch(`${SITE}/${page}`, { headers: { "user-agent": "family-feud hobby scraper" } });
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`);
  return decodePage(await response.arrayBuffer());
}

// Slips in the source pages: an accent that was saved as two stray characters, and È typed for É.
const REPAIRS = [
  [/Ã[\u0088ˆ]/g, "È"],
  [/(BEYONC|FIANC)È/g, "$1É"],
];

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const text = (html) =>
  REPAIRS.reduce((fixed, [from, to]) => fixed.replace(from, to), html)
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();

/** Each board is a question table, a score box, then a table of answer and points cells. */
function parsePage(html) {
  const questionPattern = /<TD VALIGN=TOP>\s*<P><FONT[^>]*>([\s\S]*?)<BR>\s*<FONT SIZE=1>/gi;
  const starts = [...html.matchAll(questionPattern)];
  return starts.flatMap((match, i) => {
    const question = text(match[1]);
    const block = html.slice(match.index + match[0].length, starts[i + 1]?.index ?? html.length);
    // Skip the score box: the answers live in the bordered table after it.
    const boardAt = block.search(/feud\d+border\.png/i);
    // The page footer ("Back to index") is laid out like a question but has no board.
    if (boardAt < 0) return [];
    const board = block.slice(boardAt);
    // Cells are read up to the closing FONT tag, not </B>, because the source has the odd mistyped "/B>".
    const cells = [...board.matchAll(/<B>([\s\S]*?)<\/FONT>/gi)].map((cell) => text(cell[1].replace(/<?\/B>\s*$/i, "")));
    if (cells.length === 0 || cells.length % 2 !== 0) throw new Error(`Odd board for "${question}": ${cells.join(" | ")}`);
    const answers = [];
    for (let k = 0; k < cells.length; k += 2) {
      // An unfilled slot in the site's page template, e.g. "ANSWER8" worth "S8".
      if (/^ANSWER\d+$/.test(cells[k]) && /^S\d+$/.test(cells[k + 1])) {
        console.log(`  skipped an unfilled slot on "${question}"`);
        continue;
      }
      const points = Number(cells[k + 1]);
      if (!cells[k] || !Number.isInteger(points)) throw new Error(`Bad answer on "${question}": ${cells[k]} / ${cells[k + 1]}`);
      answers.push({ id: md5(`${season}-${question}-${cells[k]}`), answer: cells[k], points });
    }
    answers.sort((a, b) => b.points - a.points);
    return { id: md5(`${season}-${question}`), question, season, numberOfAnswers: answers.length, answers };
  });
}

let pages;
if (from) {
  pages = fs.readdirSync(from).filter((file) => new RegExp(`^${season}-\\d+\\.html$`).test(file));
  pages = pages.map((file) => ({ name: file, html: decodePage(fs.readFileSync(path.join(from, file))) }));
} else {
  const index = await download(`feud${season}`);
  const links = [...new Set([...index.matchAll(new RegExp(`feud${season}_\\d+\\.html`, "gi"))].map((m) => m[0]))];
  pages = [];
  for (const link of links) {
    await sleep(1000); // be gentle with a hobbyist's site
    pages.push({ name: link, html: await download(link) });
  }
}
if (pages.length === 0) throw new Error(`No pages found for season ${season}`);

const boards = [];
for (const page of pages.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))) {
  const parsed = parsePage(page.html);
  console.log(`${page.name}: ${parsed.length} boards`);
  boards.push(...parsed);
}

const seen = new Set();
const unique = boards.filter((board) => !seen.has(board.id) && seen.add(board.id));
if (unique.length !== boards.length) console.log(`Dropped ${boards.length - unique.length} repeated questions`);

const out = path.join(root, "data", `season-${season}.json`);
fs.writeFileSync(out, JSON.stringify(unique, null, 2) + "\n");
console.log(`Wrote ${unique.length} boards to ${path.relative(root, out)}`);
