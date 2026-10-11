# Family Feud

A two-team Family Feud game you can play in a browser tab or as a Discord Activity. Players
type their answers and an AI model judges them against the survey board, so "sneakers"
counts for VELCRO KICKS.

It runs as a single Cloudflare Worker: a React client, one Durable Object per game room,
and a pluggable answer judge. Cloudflare's free plan is enough to host it.

- [Host your own copy](#host-your-own-copy)
- [Play on the web](#play-on-the-web)
- [Add it to Discord](#add-it-to-discord)
- [Settings](#settings)
- [Develop locally](#develop-locally)
- [Where the questions come from](#where-the-questions-come-from)

## Host your own copy

You need:

- A [Cloudflare account](https://dash.cloudflare.com/sign-up). The free plan works.
- [Node.js](https://nodejs.org) 20 or newer.
- About ten minutes.

### 1. Get the code

```sh
git clone https://github.com/Penners/discord-family-feud.git
cd discord-family-feud
npm install
npx wrangler login
```

`wrangler login` opens a browser window to connect the command line to your Cloudflare account.

### 2. Choose who judges the answers

Every answer is sent to an AI model. Pick one and set `GRADER` in `wrangler.jsonc`:

| `GRADER` | What it is | What you need | Notes |
|---|---|---|---|
| `clef` | Cloudflare Workers AI | Nothing extra | Free plan allows 10,000 Neurons a day, which is roughly several hundred answers. When the allowance runs out, games are cancelled until it resets at 00:00 UTC. |
| `jev` | TypeSafe Jev | A TypeSafe API key | The most accurate in our tests (about 97% against 91% for Clef on an earlier prompt) and the fastest (about a quarter of a second). Paid per use. |
| `openai` | OpenAI, or any compatible endpoint | An API key and a model name | Included but not yet tested. |

The repository ships with `"GRADER": "jev"`. If you don't have a Jev key, change it to `"clef"`.

### 3. Deploy

```sh
npm run deploy
```

This builds the app and uploads it. At the end it prints your address, which looks like
`https://discord-family-feud.<your-subdomain>.workers.dev`. To change the first part, edit
`name` in `wrangler.jsonc` before deploying.

### 4. Add the secrets

Secrets are stored by Cloudflare, not in the code. Each command asks you to paste a value.

```sh
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` signs players' sessions and is always required. Use any long random
string; this prints a suitable one:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then add whatever your grader needs:

| Grader | Secrets |
|---|---|
| `clef` | None |
| `jev` | `JEV_KEY` |
| `openai` | `OPENAI_API_KEY` and `OPENAI_MODEL` |

The game is live as soon as the secrets are saved. To update later, pull the new code and
run `npm run deploy` again; secrets are kept.

## Play on the web

Open your address in a browser. You get a new room, and its code is added to the address
bar. Type a name, press **Copy invite link**, and send the link to the other players. Each
team needs at least one player, and anyone can press **Start game**.

Anyone who has the link can join that room, and nobody needs an account. If you only want
people to play through Discord, turn web play off with `ALLOW_ANONYMOUS` (see
[Settings](#settings)).

## Add it to Discord

This makes the game launchable from a voice channel, with players signed in under their
Discord names and pictures. Do the [hosting steps](#host-your-own-copy) first.

### 1. Create the Discord app

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Click **Create App**, give it a name, and press **Create**.
2. Open **Installation** and tick both **User Install** and **Guild Install**.
3. Open **OAuth2**. Under **Redirects**, add `https://127.0.0.1` and save. Nothing visits
   this address, but Discord requires one.
4. On the same page, copy the **Client ID**, then press **Reset Secret** and copy the
   **Client Secret**.

### 2. Give the game the credentials

```sh
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

### 3. Point Discord at your copy

Back in the Developer Portal:

1. Open **Activities → URL Mappings** and add one row:
   - **Prefix:** `/`
   - **Target:** your address without `https://`, for example
     `discord-family-feud.<your-subdomain>.workers.dev`
2. Open **Activities → Settings**, tick **Enable Activities**, and tick the platforms you
   want under **Supported Platforms**.

### 4. Launch it

Install the app to your server from the **Installation** page's install link. Then join a
voice channel, open the Activity shelf (the rocket button), and pick your app. Everyone who
joins the Activity in that channel lands in the same game.

Discord's documentation only promises that the app's owner and team members can launch an
Activity that Discord has not verified. If other people can't see it, add them to a team in
the Developer Portal.

### If something goes wrong

| What you see | Likely cause |
|---|---|
| A blank Activity | The URL mapping's target is wrong, or the Discord desktop app is holding old settings. Check the mapping, then press **Ctrl+R** in Discord. |
| "Discord is not configured on the server" | `DISCORD_CLIENT_ID` or `DISCORD_CLIENT_SECRET` is missing. |
| "Discord rejected the sign-in" | The client secret doesn't match the client ID. Reset the secret and save it again. |
| "The game was cancelled" in the lobby | The answer judge failed twice in a row: out of credit, a wrong key, or the provider is down. |

To see errors from inside Discord, open Discord in a web browser instead of the desktop app
and use the browser's developer console.

## Settings

Plain settings live under `vars` in `wrangler.jsonc`; redeploy after changing them.

| Setting | Default | What it does |
|---|---|---|
| `GRADER` | `jev` | Which model judges answers: `clef`, `jev` or `openai`. |
| `ALLOW_ANONYMOUS` | `true` | Lets people play in a browser with a typed name. Set to `false` for Discord only. |
| `DEV_IDENTITIES` | `false` | Lets one browser play several seats for testing. Leave off when hosting. |
| `CLEF_MODEL` | `clef` | `clef`, or `clef-flash`, which is about six times cheaper but misjudged far more answers. |
| `CLEF_THRESHOLD` | `0.3` | How sure Clef must be before an answer counts. |
| `JEV_THRESHOLD` | `0.7` | The same for Jev. Optional. |
| `JEV_MODEL` | `jev-latest` | Optional. |

## Rules

Four rounds (single, single, double, triple). The first team to 300 wins; if nobody gets
there, a sudden-death round is decided on the top answer. Face-off, play or pass, three
strikes and one steal attempt follow the current US show.

- The winning team plays Fast Money: two players answer the same five questions against the
  clock (a minute each, since answers are typed) and need 200 points between them. The team chooses who plays;
  the second player can't see the first player's turn and can't repeat their answers. A
  one-player team plays both turns. It's for bragging rights and doesn't change who won.
- A vague answer gets one "can you be more specific?" retry with no strike.
- Any player can start a game, start a new one, or end the game in progress.
- If the judge fails twice on one answer, the game is cancelled and the lobby says why.

Timers and board sizes are our own choices and live in `src/engine/state.ts` and
`src/worker/questions.ts`.

## Develop locally

```sh
cp .env.example .env   # then set SESSION_SECRET to any long random string
npx wrangler login     # Workers AI runs on your Cloudflare account, even in dev
npm run dev
```

Open the printed URL, type a name and share the invite link. To play several seats in one
browser, add `&as=2`, `&as=3` and so on to the URL in other tabs (needs
`DEV_IDENTITIES=true` in `.env`).

`npm run dev:offline` starts without a Cloudflare sign-in. The Clef grader is unreachable in
that mode; Jev and OpenAI still work.

To test inside Discord without deploying, expose the dev server with a
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
quick tunnel and use its hostname as the URL mapping's target. The hostname changes each
time the tunnel starts.

```sh
cloudflared tunnel --url http://localhost:5173
```

### Commands

- `npm test` runs the rules tests.
- `npm run typecheck` checks types.
- `npm run questions` rebuilds the question bundle from `data/megalist-normalised.json`. `npm run dev`
  and `npm run build` do this for you, so an edit to the list takes effect on the next start or deploy.
- `npm run eval` scores the grader against the labelled answers in `evals/grading-cases.json`.
  It needs the dev server running and makes one model call per case. Useful options:
  `--limit 40` for a quick sample, `--grader jev` to score another grader without changing
  config, `--reveal` to test with half the board already showing, and `--tag british` to run
  only the British-English cases.
- `npm run deploy` builds and deploys.

### Layout

| Path | What it is |
|---|---|
| `src/engine` | The rules as a pure reducer, with tests. No I/O. |
| `src/worker/room.ts` | The game room: applies events, persists state, runs timers as alarms. |
| `src/worker/grader` | The answer judges (`clef`, `jev`, `openai`), chosen by the `GRADER` variable. |
| `src/worker/session.ts` | Signed sessions shared by every sign-in method. |
| `src/client/platform` | Where the app is running (browser tab or Discord). The UI only sees this interface. |
| `src/client/components` | The lobby and game screens. |
| `data/megalist-normalised.json` | The list the game uses: every scraped season, with a plain-English `accepts` note on answers whose wording is slang or a joke. |
| `scripts/scrape-season.mjs` | Scrapes another season into `data/season-<n>.json`, a staging file (not committed) to annotate and merge into the list. |

### How answers are judged

There is no text matching. The board shows the show's own wording ("VELCRO KICKS"), and the
model also sees that answer's `accepts` note ("shoes, sneakers"), so slang does not cost
players a correct answer. The model is asked one multiple-choice question: which board
answer is this, is it too vague, or is it not on the board.

## Where the questions come from

The 2,039 survey boards and their answers (seasons 23, 24 and 27 of the show) were sourced from
the season pages at <https://mstiescott.neocities.org/feud27>. The `accepts` notes in
`data/megalist-normalised.json` were added for this project and are not part of that source.
