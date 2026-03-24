---
name: playwright-ui-verification
description: >
  Use Playwright to see the actual dashboard instead of guessing.
  Must be run before claiming any UI change works.
compatibility:
  - augment
allowed-tools: bash node
metadata:
  version: 1.0.0
  tags: [verification, ui, playwright]
---

# playwright-ui-verification

## Activation
Activate this skill whenever:
- A UI change has been made and needs to be verified
- The user asks "does X show up?" or "why is Y missing?"
- Before claiming any front-end fix is working
- After any edit to src/App.tsx, server.ts, or a CSS file

## Preconditions
1. Server must be running (`npm run status` returns RUNNING)
2. `@playwright/test` and chromium must be installed (already done)

## Procedure

### Step 1 — Check server is up
```bash
npm run status
```
If STOPPED, tell the user to run `sudo npm run dev` and wait for it before proceeding.

### Step 2 — Run the verification script
```bash
npm run verify
```
This opens chromium headless, logs in, screenshots the page, calls /api/threads,
and prints a structured report. Read the output — it is ground truth.

### Step 3 — Read the screenshot path from output
The script prints: `Screenshot saved: screenshots/verify-<timestamp>.png`
Open that file or report its path to the user.

### Step 4 — Report structured results
Provide:
- RESULT: list of ✓/✗ for each UI element
- /api/threads data (threads count, CPU, memory)
- Screenshot path
- Any FAIL assertion with the exact error

## Stop / Restart server
```bash
npm run stop        # clean SIGTERM → SIGKILL fallback, removes PID + lock files
sudo npm run dev    # start fresh
npm run status      # confirm running
```

## Resource Guard
- Do NOT spawn additional `npm run dev` if status shows RUNNING
- Do NOT kill processes you did not start
- Always run `npm run status` before `npm run stop`

## Validation
Skill execution is valid only if:
- `npm run verify` exits 0
- Screenshot file exists and is non-empty
- All required UI elements show ✓

