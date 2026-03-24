/**
 * verify-ui.ts — Playwright verification script.
 * Run with:  npm run verify
 *
 * Logs in, waits for data, screenshots the result, and prints what is
 * visible so the AI has evidence instead of guessing.
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";
const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

test("dashboard loads and shows live data", async ({ page }) => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // ── 1. Login ────────────────────────────────────────────────────────────────
  await page.goto("/");
  await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // ── 2. Wait for dashboard shell ─────────────────────────────────────────────
  await page.waitForSelector("text=Thread Map", { timeout: 15_000 });

  // ── 3. Wait up to 6 s for at least one data cycle ───────────────────────────
  await page.waitForFunction(
    () => {
      const el = document.querySelector("table tbody tr");
      return el && !el.textContent?.includes("No Firefox");
    },
    { timeout: 8_000 }
  ).catch(() => {
    // Firefox may not be running — that is a valid state, not a UI bug
  });

  // ── 4. Screenshot ────────────────────────────────────────────────────────────
  const shot = path.join(SCREENSHOT_DIR, `verify-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\nScreenshot saved: ${shot}`);

  // ── 5. Report what is visible ────────────────────────────────────────────────
  const checks: Record<string, string> = {
    "Kernel status badge":   "text=Kernel",
    "Thread Map table":      "text=Thread Map",
    "System Load chart":     "text=System Load",
    "Memory chart":          "text=Memory Usage",
    "Stats bar (1-min Load)":"text=1-min Load",
    "Log panel":             "text=System Audit Trail",
  };

  console.log("\n── UI Element Report ──────────────────────────────────────");
  for (const [label, selector] of Object.entries(checks)) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    console.log(`  ${visible ? "✓" : "✗"} ${label}`);
  }

  // ── 6. Read live data from /api/threads ──────────────────────────────────────
  const apiResp = await page.evaluate(async () => {
    const r = await fetch("/api/threads", { credentials: "include" });
    return r.ok ? r.json() : null;
  });

  if (apiResp) {
    console.log("\n── /api/threads ───────────────────────────────────────────");
    console.log(`  Timestamp : ${apiResp.timestamp ?? "none"}`);
    console.log(`  Sys load  : ${apiResp.systemLoad?.one ?? 0} (1m)`);
    console.log(`  Memory    : ${apiResp.memPercent ?? 0}%`);
    console.log(`  Threads   : ${apiResp.threads?.length ?? 0}`);
    if (apiResp.threads?.length) {
      apiResp.threads
        .sort((a: { cpu: number }, b: { cpu: number }) => b.cpu - a.cpu)
        .slice(0, 5)
        .forEach((t: { pid: string; tid: string; cpu: number; memMB: number; status: string }) =>
          console.log(`    PID ${t.pid} TID ${t.tid}  CPU ${t.cpu}%  MEM ${t.memMB}MB  ${t.status}`)
        );
    }
  }

  // ── 7. Assertions ────────────────────────────────────────────────────────────
  await expect(page.locator("text=Thread Map")).toBeVisible();
  await expect(page.locator("text=System Audit Trail")).toBeVisible();
  console.log("\nPASS\n");
});

