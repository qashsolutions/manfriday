# webapp tests

Three layers, three commands (all from `webapp/`):

| Command | What it proves |
|---|---|
| `npm run test` | Vitest contract tests for the analyst routes (`tests/analyst/`) |
| `npm run probe:rls` | The database refuses strangers: anon-key SELECT + INSERT against all 14 RLS tables must come back denied/empty (`tests/rls/probe.mjs`) |
| `npm run test:e2e` | Playwright smoke: `/`, `/terms`, `/privacy` render their headlines (`tests/e2e/`) |

One-time setup for Playwright: `npx playwright install chromium`.

## Authenticated smoke — capturing the storage state once

`tests/e2e/authed.spec.ts` is **skipped** unless `tests/.auth/state.json`
exists. There is no auth bypass and none should be added — you capture a
real signed-in session by hand, once:

1. In one terminal, start the dev server on the port Playwright uses:

   ```
   npm run dev -- --port 3100
   ```

2. In another terminal, open a recording browser that saves its cookies on
   exit:

   ```
   npx playwright codegen --save-storage=tests/.auth/state.json http://localhost:3100/settings
   ```

3. In the window that opens, sign in with Google as usual (complete MFA if
   prompted). When you can see the app, close the browser window — the
   session state is written to `tests/.auth/state.json`.

4. `npm run test:e2e` now runs the authenticated spec too.

**`tests/.auth/state.json` holds live session cookies for your real
account.** It is gitignored (`webapp/.gitignore`) and must stay that way —
never commit it, never share it. When the session expires, delete the file
and repeat the capture; delete it any time to return the authed spec to
skipped.
