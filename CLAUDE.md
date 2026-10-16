# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## Project

Github Board is a webapp listing the open GitHub pull requests of a few tracked repositories, one row per PR: a **React + TypeScript** frontend (Vite, TanStack Query) and a **Node.js + TypeScript** backend (Express 5) that holds the GitHub token, calls the GitHub REST API and persists each user's settings in a JSON file. See [README.md](README.md) for features, configuration and the API routes.

- `shared/` — code used by both sides (imported with relative paths and `.ts` extensions)
  - `config.ts` — tracked GitHub repositories (`REPOS`); edit this list to add/remove a repo. Also `REQUIRED_APPROVALS` (approvals needed to merge, used by the list view's status)
  - `types.ts`, `state.ts` (pure logic: default settings, migration, filter, grouping by repo, stacked PRs, PR status), `schema.ts` (zod validation)
- `server/src/` — `index.ts` (entry, env vars), `app.ts` (Express routes), `github.ts` (GitHub client), `store.ts` (JSON persistence), `claude.ts` (local Claude Code CLI: starts, lists and reads review sessions)
- `client/src/` — `App.tsx`, `components/` (`PrList.tsx` list view, `PrRow.tsx` table row, `MyActions.tsx` "Actions pour moi", `ReviewDialogs.tsx` review session dialogs, `Dashboard.tsx` top bar, dialogs, login), `state/` (settings context + debounced save), `lib/` (backend API client, formatting)
- Tests: `shared/*.test.ts`, `server/test/`, `client/test/` (Vitest, Testing Library)

Conventions:
- Node runs the backend's TypeScript **natively** (type stripping, Node ≥ 22.18): no build step for the server. Only erasable TS syntax is allowed (`erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties), and relative imports must end in `.ts`/`.tsx`.
- The GitHub token must never reach the browser; all GitHub calls go through the backend.
- The review routes (`/api/pulls/…/review`, `/api/reviews…`) run the local Claude CLI or read its files: keep commands fixed (`execFile`, no shell, no user-provided arguments beyond validated PR identifiers), never build a file path from client input (session ids come from the CLI's own listing), keep them behind the `localOnly` guard (loopback requests carrying the `X-Github-Board` header), and never pass the GitHub token to the child process.
- Use Yarn (`yarn.lock`).
- **Language: English only.** All code (identifiers, comments, log and error messages), the README and every other Markdown documentation file must be written in English. When touching existing French code comments or docs, translate them to English. User-facing UI text stays in French.

Commands: `yarn dev` (backend on :3001 + Vite on :5173), `yarn build`, `yarn start`, `yarn test`, `yarn typecheck`.

## Mandatory steps after every AI-driven change

Every change made by an AI assistant must be followed by these two steps before it is considered done:

### 1. Run the unit tests

- Run the unit test suite: `yarn test` (Vitest), and `yarn typecheck`.
- Tests live in `shared/*.test.ts`, `server/test/` and `client/test/`.
- All tests must pass. If a test fails, fix the code (or the test, if the behavior change is intended) and run them again.
- When adding or changing logic, add or update the matching tests.
- If no test suite exists yet for the code you touched, say so explicitly in your summary rather than claiming the change is tested.

### 2. Review and update the documentation

- Review every Markdown documentation file of the project (currently [README.md](README.md), plus any other `*.md` file added later, including this one).
- Update them so they reflect the change: features, shortcuts, settings, file structure, setup steps, known limitations, etc.
- Keep the existing style of each document, and write it in English (see Conventions).
- If no documentation update is needed, state that you checked and why.

In your final summary, report the test results and which documentation files were updated (or that none needed changes).
