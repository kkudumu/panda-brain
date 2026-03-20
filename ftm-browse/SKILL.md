---
name: ftm-browse
description: Headless browser daemon for visual verification and web interaction. Gives agents the ability to navigate, screenshot, click, fill forms, and inspect ARIA trees via CLI commands. Use when user says "browse", "screenshot", "visual", "look at the app", "open browser", "check the page", "navigate to", "take a screenshot", "visual verification".
---

## Events

### Emits
- `task_completed` — when a visual verification or interaction workflow finishes successfully

### Listens To
(none — ftm-browse is invoked on demand and does not respond to events)

# ftm-browse

ftm-browse is a persistent headless Chromium daemon controlled via a CLI binary at `~/.claude/skills/ftm-browse/bin/ftm-browse`. Each CLI invocation communicates with the daemon over a local HTTP server (bearer-auth, random port), so the browser stays alive across commands without the per-invocation startup penalty. The daemon auto-starts on first use and shuts itself down after 30 minutes of idle. This CLI-to-HTTP model is 4x more token-efficient than driving Playwright MCP directly, because tool calls remain terse and outputs are structured JSON rather than raw browser protocol noise.

---

## Setup

**First run — install the browser engine:**

```bash
npx playwright install chromium
```

**Define the alias in any shell session before use:**

```bash
PB="$HOME/.claude/skills/ftm-browse/bin/ftm-browse"
```

**Verify the installation:**

```bash
$PB goto https://example.com && $PB screenshot
```

The first `goto` command will start the daemon (up to 10 seconds for cold start). All subsequent commands respond in ~100ms because the browser process stays alive.

---

## Command Reference

### WRITE commands — state-mutating

These commands change browser state. Never retry blindly; check the returned `success` field.

**`goto <url>`** — Navigate to a URL. Waits for `domcontentloaded`.

```bash
$PB goto https://example.com
$PB goto http://localhost:3000/dashboard
```

Returns: `{ success, data: { url, title, status } }`

**`click <@ref>`** — Click an interactive element by its `@e` ref. Performs a 5ms staleness check before clicking; fails immediately if the ref is stale rather than waiting.

```bash
$PB click @e3
$PB click @e12
```

Returns: `{ success, data: { url, title } }` — includes the URL after any resulting navigation.

**`fill <@ref> <value>`** — Fill a text input, textarea, or other fillable element. Values with spaces do not need quoting — remaining CLI args are joined.

```bash
$PB fill @e2 hello world
$PB fill @e5 user@example.com
```

Returns: `{ success, data: { ref, value } }`

**`press <key>`** — Send a keyboard key to the active page. Accepts any Playwright key name.

```bash
$PB press Enter
$PB press Tab
$PB press Escape
$PB press ArrowDown
```

Returns: `{ success, data: { key, url } }`

---

### READ commands — safe to retry

These commands do not change browser state. Safe to call multiple times.

**`text`** — Get visible page text via `document.body.innerText`.

```bash
$PB text
```

Returns: `{ success, data: { text } }`

**`html`** — Get full page HTML via `page.content()`.

```bash
$PB html
```

Returns: `{ success, data: { html } }`

**`eval <js-expression>`** — Execute arbitrary JavaScript in the page context. Returns the result as a JSON-serializable value. DOM elements are returned as `{ type: "element", tagName, id, text }`. Functions are returned as `{ type: "function", name }`. Errors inside the expression are caught and returned as `{ error: "..." }` rather than crashing the daemon.

```bash
$PB eval document.title
$PB eval "document.querySelector('input[name=email]').value"
$PB eval "Array.from(document.querySelectorAll('td')).map(td => td.textContent)"
$PB eval window.location.href
$PB eval "document.cookie"
```

Returns: `{ success, data: { result } }` — `result` is whatever the expression evaluated to.

Use cases:
- Reading hidden or programmatically-set form field values not visible in the ARIA tree
- Extracting data from dynamic tables or rendered lists
- Checking feature toggle states or global JS variables (`window.featureFlags`)
- Inspecting `localStorage` or `sessionStorage` values
- Querying computed DOM state not exposed via accessibility roles

---

### META commands

**`snapshot`** — Full ARIA accessibility tree of the current page. Includes both interactive and structural elements (headings, nav, main, etc.).

```bash
$PB snapshot
```

Returns: `{ success, data: { url, title, interactive_only: false, tree, refs, aria_text? } }`

**`snapshot -i`** — Interactive elements only, each labeled with an `@e1`, `@e2`... ref. Use this before clicking or filling — never guess a ref.

```bash
$PB snapshot -i
```

Returns: same shape as `snapshot` with `interactive_only: true`; the `refs` map contains the locator entries for each `@eN`.

**`screenshot`** — Capture a viewport screenshot (1280x800). Saves to `~/.ftm-browse/screenshots/screenshot-<timestamp>.png` by default and returns the path.

```bash
$PB screenshot
$PB screenshot --path /tmp/before.png
$PB screenshot --path /tmp/after.png
```

Returns: `{ success, data: { path, url, title } }`

**`tabs`** — List all open browser tabs.

```bash
$PB tabs
```

Returns: `{ success, data: { tabs: [{ index, url, title, active }] } }`

**`chain '<json-array>'`** — Execute multiple commands in sequence in a single CLI invocation. The chain stops at the first failure. Use this to reduce round-trips for multi-step operations.

```bash
$PB chain '[
  {"command":"goto","args":{"url":"https://example.com"}},
  {"command":"snapshot","args":{"interactive_only":true}},
  {"command":"screenshot","args":{}}
]'
```

Returns: `{ success, data: { results: [{ command, result }] } }`. On failure: adds `failed_at` field.

**`health`** — Check that the daemon is alive and responding.

```bash
$PB health
```

Returns: `{ status: "ok", pid }` (wrapped in standard result envelope from the daemon's health handler — note this endpoint bypasses `executeCommand` and returns directly).

**`stop`** (alias: `shutdown`) — Send SIGTERM to the daemon. The daemon cleans up its state file and exits.

```bash
$PB stop
```

---

## The @e Ref System

Refs are short handles (`@e1`, `@e2`, ...) that identify interactive elements. They are assigned fresh on each `snapshot` call and map to stable Playwright locator strategies (by label, by role+name, by placeholder, by name attribute, or by nth-position CSS fallback).

**Getting refs:**

```bash
$PB snapshot -i
# Output includes tree nodes like:
# { "ref": "@e3", "role": "button", "name": "Submit", "interactive": true }
# { "ref": "@e5", "role": "textbox", "name": "Email", "interactive": true }
```

**Using refs:**

```bash
$PB fill @e5 user@example.com
$PB click @e3
```

**Staleness rule:** After any navigation event — whether from `goto`, a `click` that follows a link, or `press Enter` submitting a form — the current ref map is invalidated. The daemon detects stale refs in ~5ms and returns an error asking you to re-snapshot. Always re-run `snapshot -i` after navigation before using refs again.

**Typical interaction workflow:**

```bash
# 1. Navigate to the page
$PB goto http://localhost:3000/login

# 2. Get interactive refs
$PB snapshot -i

# 3. Identify target elements from the output, then interact
$PB fill @e2 admin@example.com
$PB fill @e3 password123
$PB click @e4          # "Sign in" button

# 4. Page navigated — refs are stale; re-snapshot
$PB snapshot -i

# 5. Continue on the new page
$PB screenshot
```

---

## Common Workflows

### Visual smoke test

```bash
PB="$HOME/.claude/skills/ftm-browse/bin/ftm-browse"
$PB goto http://localhost:3000
$PB screenshot --path /tmp/smoke.png
# Read /tmp/smoke.png to verify layout
```

### Form filling

```bash
$PB goto http://localhost:3000/signup
$PB snapshot -i
# Identify: @e1=name input, @e2=email input, @e3=password, @e4=submit button
$PB fill @e1 Jane Doe
$PB fill @e2 jane@example.com
$PB fill @e3 s3cret!
$PB click @e4
$PB screenshot --path /tmp/after-signup.png
```

### Navigation verification

```bash
$PB goto http://localhost:3000
$PB snapshot -i
# Find nav links
$PB click @e7          # "Dashboard" link
$PB text               # Verify content changed
$PB screenshot
```

### Before/after comparison

```bash
$PB goto http://localhost:3000/widget
$PB screenshot --path /tmp/before.png
# ... make changes in code ...
$PB goto http://localhost:3000/widget   # reload after change
$PB screenshot --path /tmp/after.png
# Compare /tmp/before.png and /tmp/after.png visually
```

### Multi-step with chain (fewer round-trips)

```bash
$PB chain '[
  {"command":"goto","args":{"url":"http://localhost:3000/login"}},
  {"command":"fill","args":{"ref":"@e2","value":"admin@example.com"}},
  {"command":"fill","args":{"ref":"@e3","value":"password"}},
  {"command":"click","args":{"ref":"@e4"}},
  {"command":"screenshot","args":{}}
]'
```

Note: When using `chain` with refs, you must have called `snapshot -i` first in a separate command to populate the ref map. Refs set by a `snapshot` inside the same chain are available to subsequent steps in that chain.

---

## Integration with Other FTM Skills

**ftm-debug** — Use ftm-browse to visually verify bug fixes. Take a screenshot before applying a fix, apply the fix, reload, screenshot again. Compare before/after to confirm the fix is visible. Also use `snapshot` to inspect DOM state when debugging rendering issues — the ARIA tree reveals whether components have mounted and populated correctly.

**ftm-audit** — Use ftm-browse to verify runtime wiring. Navigate to each route the audit is checking, call `snapshot` to confirm the component appears in the ARIA tree with the correct role and name, and screenshot for documentation. This catches hydration failures, missing route registrations, and components that render blank.

**ftm-executor** — After completing a task that touches frontend code, use ftm-browse as the post-task smoke test harness. If the project has a dev server running, `goto` the affected route, take a screenshot, and verify the page renders without errors. Include the screenshot path in the task completion report.

---

## Supervised Execution Mode

When ftm-browse is executing browser steps within an approved plan (dispatched by ftm-executor or ftm-mind), activate supervised mode. This mode adds verification guardrails after every navigation action.

### Activation

Supervised mode activates automatically when:
- The browse command is part of a plan step (context includes plan step reference)
- The caller provides expected page state (title pattern, URL pattern, or element selector)

### Post-Navigation Verification

After every `goto`, `click` that triggers navigation, or `fill` + `submit` sequence:

1. **Wait for page load** — wait for `networkidle` or 5-second timeout, whichever comes first
2. **Check URL** — if expected URL pattern was provided, verify current URL matches
3. **Check title** — if expected title pattern was provided, verify page title matches
4. **Check for error indicators** — scan for common error patterns:
   - HTTP error codes in title (403, 404, 500, 502, 503)
   - Error modals or alert dialogs
   - "Access Denied", "Unauthorized", "Session Expired" text in page
5. **Check for auth redirects** — if current URL contains `/login`, `/signin`, `/sso`, `/oauth`, or `/saml` when it wasn't the intended destination, flag as auth redirect

### On Unexpected State

When verification detects a mismatch or error:

1. **Stop execution immediately** — do not proceed to the next browser step
2. **Take a screenshot** — capture the current page state
3. **Present the situation** to the user:

```
⚠ Unexpected browser state during plan step [N]:

Expected: [expected URL/title/state]
Actual: [current URL/title]
Issue: [description — wrong page / error page / auth redirect / modal detected]

Screenshot: [path to screenshot]

Options:
  1. retry  — navigate again
  2. skip   — skip this browser step, continue plan
  3. abort  — stop plan execution entirely
  4. manual — open interactive browser for manual intervention
```

4. **Wait for user choice** — do not proceed without explicit selection

### Auth Redirect Detection

Authentication redirects are especially dangerous because silently following them can:
- Leak credentials to unexpected domains
- Complete OAuth flows the user didn't intend
- Grant permissions the user didn't approve

When an auth redirect is detected:
- NEVER automatically follow it
- Flag it prominently: "Auth redirect detected — redirected to [domain]"
- The user must explicitly choose to proceed

### Audit Trail

Every browser step within a plan produces:
- **Before screenshot** — taken just before the action
- **After screenshot** — taken after the action completes (or after error)
- **Timing** — how long the action took
- **Verification result** — PASS or FAIL with details

Screenshots saved to a temp directory, paths included in the step report.

### Non-Plan Usage

When ftm-browse is used directly (not within a plan), supervised mode is OFF by default. The user gets the raw browse experience. They can enable it manually with `--supervised` flag.

---

## Error Handling

| Symptom | Cause | Fix |
|---|---|---|
| First command hangs up to 10s | Daemon cold start | Normal — wait for it |
| `Ref @eN not found. The page may have changed` | Stale ref after navigation | Re-run `snapshot -i` |
| `Ref @eN no longer exists on the page` | Element removed from DOM | Re-run `snapshot -i` |
| `Timeout` on goto | Page slow to load or wrong URL | Check URL, verify server is running |
| `Browser not installed` or Chromium launch error | Playwright Chromium missing | Run `npx playwright install chromium` |
| `Daemon failed to start within 10 seconds` | Bun or binary issue | Check `~/.ftm-browse/` for logs; verify binary is executable |
| Connection refused | Daemon died (idle timeout or crash) | Next command will auto-restart it |
| `commands must be an array` | Bad JSON passed to chain | Validate JSON before passing to chain |
| `Evaluation failed: ...` | Playwright could not serialize or run the expression | Check for syntax errors; wrap complex expressions in quotes |

---

## Tips

- Always run `snapshot -i` before `click` or `fill` — never guess or hardcode a ref number.
- Use `chain` for multi-step flows to reduce round-trip overhead; each step result is available in the returned array.
- Screenshots are cheap — take them liberally at key points (before interaction, after submit, after navigation) as a natural audit trail.
- The daemon persists across all commands in a session. Cold start only happens once per 30-minute idle window.
- `$PB text` is the fastest way to assert page content without parsing HTML.
- `$PB html` is useful when you need to inspect the raw DOM, check for hidden elements, or verify server-rendered markup.
- The daemon uses a 1280x800 headless Chromium viewport with a standard Mac Chrome user-agent, so most sites render predictably.
- To stop the daemon explicitly: `$PB stop`. It will auto-restart on next use.
- `$PB eval` is the escape hatch for anything the ARIA tree doesn't expose — hidden inputs, JS globals, localStorage, computed values.

## Requirements

- tool: `$HOME/.claude/skills/ftm-browse/bin/ftm-browse` | required | headless browser CLI binary
- tool: `npx playwright install chromium` | required | Chromium browser engine (first-time setup)
- reference: none required

## Risk

- level: low_write
- scope: navigates browser, takes screenshots saved to ~/.ftm-browse/screenshots/; does not modify project source files; form fills and clicks can have side effects on the target application
- rollback: no project file mutations; browser interactions on local dev servers are typically reversible by reloading

## Approval Gates

- trigger: auth redirect detected during supervised execution | action: STOP immediately, present options (retry/skip/abort/manual), wait for user choice
- trigger: unexpected browser state during plan step | action: STOP, take screenshot, present situation to user, wait for explicit choice
- trigger: supervised mode enabled AND state mismatch detected | action: halt and report before proceeding
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: daemon binary not found at expected path | action: report installation instructions and stop
- condition: Chromium not installed | action: instruct user to run "npx playwright install chromium" and stop
- condition: daemon fails to start within 10 seconds | action: check ~/.ftm-browse/ logs, report binary or Bun issue
- condition: dev server not running when navigating to localhost | action: report timeout error with the URL attempted
- condition: stale ref after navigation | action: re-run snapshot -i before retrying click/fill

## Capabilities

- cli: `$HOME/.claude/skills/ftm-browse/bin/ftm-browse` | required | headless Chromium control CLI

## Event Payloads

### task_completed
- skill: string — "ftm-browse"
- workflow: string — description of the visual verification or interaction performed
- screenshots: string[] — absolute paths to screenshots taken
- duration_ms: number — total workflow duration
