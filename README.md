# Github Board

Webapp listing **every open Pull Request of a few tracked GitHub repositories, one compact row per PR**, to see at a glance what is waiting for review and what can be merged.

**React + TypeScript** frontend (Vite, TanStack Query) and **Node.js + TypeScript** backend (Express). The backend holds the GitHub token, calls the GitHub REST API and stores each user's settings.

## Features

- **Tracked repositories**: defined in [`shared/config.ts`](shared/config.ts) (`REPOS`), currently `DiliTrust/service-clm`, `DiliTrust/DT_Public_API` and `DiliTrust/webapp-clm`. A banner flags any repository the token cannot read.
- **Actions for me**: a highlighted block above the list with your own open PRs that wait for you (a quiet line when there are none):
  - **Ready to merge**: the PR reached the required approvals
  - **N unanswered comments**: unresolved review threads whose last comment is someone else's (outdated threads, whose code has changed since, are taken as addressed), plus the conversation (PR comments and the text of "comment" / "changes requested" reviews) when its last message is someone else's. Bots such as CodeRabbit are ignored.

  These PRs also stay in their project below. Finished reviews (see "Review with Claude") are listed here too.
- **PR list**, grouped by project under a separator (in the order of `REPOS`, with the number of PRs; projects without open PRs are hidden), newest first within each project. Click a separator to **collapse / expand** its project; the choice is saved with your settings, and a collapsed project does not load its PRs' details. One row per PR with:
  - title (link to GitHub) and number
  - author
  - time since the PR was opened (`45 min`, `5 h`, `3 d`, `2 w`, `4 mo`, `1 y`; full date on hover)
  - approvals out of the number required to merge (`1/2`; the threshold is `REQUIRED_APPROVALS` in `shared/config.ts`, currently **2**)
  - status, the most blocking one winning: **CI FAILED** (a check or commit status of the last commit failed — failed, timed out, cancelled, action required; only the latest run of each check counts, so a successful re-run clears an earlier failure) › **Draft** › **Conflict** (merge conflict) › **Changes requested** › **Approved** (required approvals reached) › **Review pending**
  - change size (`+added −deleted` lines; number of files on hover)
- **Stacked PRs** are kept together: a PR whose base branch is the branch of another open PR of the same project is listed right under it, indented (↳, with the parent PR on hover), and the first PR of the stack shows `stack · N`. A stack is placed where its newest PR would be; a PR with several stacked PRs forms a tree, oldest child first.
- **Review with Claude** (✦ button at the end of each row of the project list): starts a **background Claude Code session** on the server's machine, named `review <project>#<number>`, that runs the user's **`/pr-review <PR URL>`** skill (in `~/.claude/skills/pr-review`). The skill reviews the PR without posting anything and saves its findings to `~/.cache/pr-review/<owner>-<repo>-<number>/findings.json`.
  - **While it runs**, the ✦ button pulses (yellow when the session waits for an answer); clicking it shows the command that opens the session in a terminal, `claude attach "review service-clm#16664"`, with a copy button. Sessions are checked every 5 seconds while one runs.
  - **Once finished**, "Actions for me" lists the PR with a **Review summary** button showing the session's final answer full screen, rendered as Markdown (GitHub flavor: tables, checklists; raw HTML is ignored, links open in a new tab), and the command to resume the conversation, `claude attach <session id>` (a finished session is no longer found by its name). **Mark as read** removes it (saved with your settings); the PR can then be reviewed again. A session that ended in error is flagged **Review failed**.
  - **Findings**: each finding is stacked under the entry (which says **No findings** when there are none), most severe first: severity (Critical, Major, Minor, Nit), title, `file:line`, and a `suggestion` tag when it comes with a fix. Clicking one opens its detail, laid out like a GitHub review comment: the commented lines highlighted among their surrounding code (fetched from GitHub at the reviewed commit), the comment (Markdown), the suggested change as a diff of those lines, a link to the lines on GitHub, and the `/pick-change <PR URL>` command that posts the chosen findings on GitHub.
- Instant filter on title, project, number and author
- Auto refresh, API quota counter, light/dark theme
- Shortcuts: `/` filter, `r` refresh

The interface is in English.

## Getting started

Requirements: **Node.js ≥ 22.18** (the backend's TypeScript is run directly by Node) and **Yarn**.

```bash
git clone https://github.com/<you>/Github-Board.git
cd Github-Board
yarn install
cp .env.example .env   # optional: GITHUB_TOKEN, PORT…
```

### Development

```bash
yarn dev
```

Starts the backend (<http://127.0.0.1:3001>, reloaded on every change) and the Vite frontend (<http://localhost:5173>, which proxies `/api` to the backend). Open <http://localhost:5173>.

### Production

```bash
yarn build   # builds the frontend into client/dist
yarn start   # the backend serves the API and the built frontend on http://127.0.0.1:3001
```

### Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | — | Token used by the server. When set, no login is asked (for local use only: anyone reaching the server uses it). |
| `HOST` / `PORT` | `127.0.0.1` / `3001` | Backend listen address. |
| `CLAUDE_BIN` | `claude` | Claude Code executable started by the Review button (full path if it is not in the server's `PATH`). |
| `CLAUDE_CWD` | server's folder | Folder in which Review sessions start. |
| `DATA_FILE` | `server/data/state.json` | JSON file of each GitHub user's settings (theme, refresh interval, collapsed projects, reviews marked as read). |

### Token

Create a [Personal Access Token](https://github.com/settings/tokens/new?scopes=repo&description=Github%20Board):

- **Classic**: `repo` scope (or `public_repo` if you only track public repositories)
- **Fine-grained**: read access to *Pull requests*, *Commit statuses* and *Checks* on the relevant repositories

The tracked repositories are **private** and belong to the DiliTrust organisation, so the token must have access to them; if the organisation enforces SAML SSO, authorise the token for DiliTrust (**Configure SSO → Authorize** in the token list). Otherwise, a warning banner lists the inaccessible repositories (their PRs are left out of the list).

Once logged in, the token never goes through the browser: it is either read from `GITHUB_TOKEN`, or entered at login and then kept **in memory** by the server, tied to an `HttpOnly` session cookie. Restarting the server therefore requires logging in again (except with `GITHUB_TOKEN`).

## Structure

```
shared/              Code shared by frontend and backend
  config.ts          Tracked repositories (REPOS), required approvals — edit to add/remove a repository
  types.ts           Types (settings, PRs, details, session…)
  state.ts           Pure logic: default settings, migration, filter, grouping, stacks, PR status
  schema.ts          Validation (zod) of the saved settings
server/
  src/index.ts       Entry point (environment variables)
  src/app.ts         Express REST API (/api) + serving of the built frontend
  src/github.ts      GitHub client: REST (open PRs, PR details, file contents, repository access, quota), GraphQL (actions for me)
  src/store.ts       Per-user JSON persistence of the settings
  src/claude.ts      Local Claude Code CLI: starts, lists and reads the review sessions
  test/              Backend tests
client/
  index.html, vite.config.ts
  src/App.tsx        Session and settings loading
  src/components/    PR list and rows, "Actions for me", top bar, settings dialog, login
  src/state/         Settings (React context, automatic saving)
  src/lib/           Backend API client, formatting, line diff of suggestions
  test/              Frontend tests (Testing Library)
```

### Backend API

| Method and route | Purpose |
| --- | --- |
| `POST /api/session` · `GET` · `DELETE` | Log in with a token, current session, log out |
| `GET /api/state` · `PUT` | Read / save the user's settings |
| `GET /api/pulls?limit=` | Open PRs of the tracked repositories with their base and head branches, newest first (`limit` newest, default 100) |
| `GET /api/pulls/:owner/:repo/:number/details?updatedAt=` | Reviews (decision and approval count), diff size, mergeability and CI state of a PR (cached) |
| `GET /api/actions` | The logged-in user's open PRs waiting for them (approved, or with unanswered discussions), via GraphQL |
| `POST /api/pulls/:owner/:repo/:number/review` | Starts a background Claude Code session (`claude --bg`) on the server's machine; requires the `X-Github-Board: 1` header and a request from that machine |
| `GET /api/reviews` | Review sessions of the tracked repositories (latest per PR, running or finished), from `claude agents --json --all`; same restrictions |
| `GET /api/reviews/:id/result` | Result of a finished review session: its final answer (from its transcript), and the findings its `/pr-review` skill saved for the PR since the session started, each with its code excerpt at the reviewed commit; same restrictions |
| `GET /api/repos/access` | Token access to the tracked repositories |
| `GET /api/rate` | Remaining GitHub quota |

### Changing the tracked repositories

Edit the `REPOS` array in `shared/config.ts`: the list and the access check use it directly.

## Tests and checks

```bash
yarn test        # Vitest: shared + server (Node) and client (jsdom)
yarn typecheck   # TypeScript, backend and frontend
```

The `.github/workflows/ci.yml` workflow runs typecheck, tests and build on every push and pull request.

## Known limitations

- The list shows at most the 100 most recently opened PRs across the tracked repositories (each costs ~4 API calls for its details); the counter above it says when there are more. A stack whose oldest PRs fall outside these 100 is shown from the first listed PR.
- "Actions for me" reads up to 100 of your open PRs, 100 review threads and the last 100 comments and reviews of each. A reply does not count as an answer when it is a separate PR comment while the question is in a review thread: resolve the thread, or reply in it.
- Stacks are computed on the filtered list: a PR whose parent does not match the filter is shown on its own.
- Approvals, status and size cost 4 GitHub API calls per PR (PR, reviews, check runs, commit statuses), cached until the PR changes.
- A CI finishing does not change the PR itself: while a PR's CI is running, its details are fetched again at each refresh (auto refresh interval), so a failure shows up at the latest one refresh later.
- GitHub computes mergeability lazily: right after a push, a conflict may only show up after a few seconds (the app checks again automatically).
- Review: Claude Code must be installed and logged in on the server's machine, and must trust the folder the sessions start in (`CLAUDE_CWD`, by default the server's folder): run `claude` once in that folder and accept, otherwise the button reports "workspace not trusted". The button only works when the browser and the server run on the same machine; the server runs a fixed command (`claude --bg --name … "/pr-review <PR URL>"`, no shell, only for tracked repositories) and does not pass its GitHub token to Claude.
- A review's synthesis is read from the session's transcript in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`), an internal Claude Code format that may change; `claude logs` cannot be used since it stops working once the session is stopped. Only sessions whose PR is in the list (the 100 newest open PRs) are shown.
- Findings come from the `/pr-review` skill's `findings.json`, and are only shown when it was written after the session started (otherwise they belong to an earlier review). The skill may ask a question in the background session (findings already saved for that PR, very large diff) or wait for a permission: the ✦ button then pulses yellow, and `claude attach` lets you answer.
- A finding's code excerpt costs 1 GitHub API call per commented file (cached per commit). It is missing when the file is over 1 MB, or when the skill's line numbers do not fit the reviewed version of the file. Code is shown without syntax highlighting.
- Sessions are kept in memory: restarting the server logs users out (except with `GITHUB_TOKEN`).
- The app now needs a Node server: it can no longer be published on GitHub Pages.
- If the state is changed from two tabs at the same time, the last save wins.

## License

MIT
