# AI Reply for WhatsApp — Agent Instructions

## Communication

- Keep responses concise and technical — avoid filler, hedging, and restating what the user already knows.
- When a feature can reasonably be implemented in more than one way, ask the user which approach they prefer before writing code.
- Ask clarifying questions whenever requirements, scope, or expected behavior are ambiguous — don't guess silently.

## Repository Structure

```
ai-reply-for-whatsapp/
├── packages/shared/  # TypeScript types shared between server and app
├── server/           # Node backend (Fastify + Baileys, SQLite storage)
└── app/              # Expo React Native app for iPhone
```

See [README.md](README.md) for the architecture overview and how to run the server and app.

## Workflow

- **When asked to implement a GitHub issue, always create a separate branch first** (e.g. `issue-<number>-short-description`) and do the work there — never commit the implementation directly to `main`.
- **Avoid stacking when possible — base every PR on `main`. Only genuinely dependent changes need stacking.** (Stacked PRs combined with squash merges force rebases and force-pushes of the child branches; for a dependent sequence, prefer merging each PR before starting the next one on fresh `main`.)
- **Every completed change — not just GitHub issues — ends with a pull request that is then reviewed.** However small the change, once it is done: publish the branch and open a PR (`git push -u` the branch, then create the PR with `gh pr create`), then run the code review as described below. Reference the issue it implements in the PR description, if any.
- **Make GitHub close the issue automatically when the PR merges:** include a closing keyword followed by the issue number — `Fixes #<issue>`, `Closes #<issue>`, or `Resolves #<issue>` — in **both** the PR description and the commit message. Plain references like "issue #10" or "see #10" do **not** auto-close; the closing keyword is required.
- **Check for merge conflicts with `main` and fix them without being asked.** Before opening a PR, and again whenever you return to an already-open one (`main` moves while a branch is in review), run `git fetch origin` and check the branch merges cleanly (`gh pr view <PR#> --json mergeable`, or attempt `git merge origin/main`). On a conflict, resolve it yourself by merging `origin/main` into the branch — adopt the conventions `main` introduced in the meantime, don't just splice the textual halves together. Re-run the affected packages' checks after the merge, then push it.
- **Then review the pull request as a real GitHub code review**, not just a summary comment. Run `/code-review --comment`, which posts each finding as an **inline review comment anchored to the exact file and line** on the PR (it uses `gh` under the hood to create the review). Do not post findings only as a plain `gh pr comment` timeline comment. Address any findings before considering the work done.
  - **Keep review feedback concise:** one sentence per finding — state the problem and its impact, do not restate the surrounding code or add preamble. Only report real issues; do not add "looks good" filler comments.
  - **Control the depth with the effort level — always at least `medium`.** Default to `/code-review medium --comment` for fewer, high-confidence findings. Use `/code-review high --comment` (up to `max`) only when broad coverage matters more than noise. Do not use `low` — it misses too much for reviews that gate merging.
- **After implementing a change, start the affected parts locally and check that they run without errors.** Start the server with `npm run server` and the app with `npm run app` (see the README for first-time setup). Then actually exercise the changed endpoints and screens — watch the server log and the Metro/app output for errors, don't just check that the processes start.
  - **Stop the dev servers when you are done testing**, so the ports are free for the next agent session — ports are frequently left occupied by an already-finished session.
  - **If a port is already in use, do not kill the occupying process on your own** — it may belong to another still-running agent session. Ask the user whether you may kill it first.

### Coding guidelines

- Prefer immutable variables and functions.
- Prefer a result type with a success and error case over exceptions.
- Avoid using try-catch blocks for branching. Prefer to check if something exists instead of handling exceptions.

### Testing

Run the relevant checks for every workspace you change before considering a task done:

- `packages/shared/`: `npm run typecheck` (tsc). Server and app import it as a workspace package — type-check consumers after changing shared types.
- `server/`: `npm run typecheck` (tsc).
- `app/`: `npm run typecheck` (tsc).

`npm run typecheck` at the repo root runs the check for all workspaces.
