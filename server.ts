import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, execSync, ChildProcess } from "child_process";
import cookieParser from "cookie-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  PORT: 3000,
  LOG_FILE: "active_threads.log",
  LOCK_FILE: "firefox_optimizer.lock",
  PID_FILE: ".server.pid",
  OPTIMIZER_SCRIPT: "firefox_content_opt.sh",
  MAX_LOG_LINES: 500,
  /** Only need the most recent METRICS line — 30 lines is ample. */
  METRICS_WINDOW: 30,
  AUTH_COOKIE: "fx_opt_auth",
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || "admin123",
  SUDO_PASSWORD: process.env.SUDO_PASSWORD || "",
};

// Runtime state for dynamic config
let runtimeConfig = {
  minCpu: 0.1,
  optimizeThreshold: 5.0,
  reniceVal: 5,
  monitorInterval: 2
};

/**
 * Read the last N lines of a file efficiently by seeking near the end.
 * Uses try/finally to guarantee the file descriptor is always closed.
 */
function readLastLines(filePath: string, maxLines: number): string[] {
  if (!fs.existsSync(filePath)) {
    return ["SYSTEM: Log file not found. System may be initializing..."];
  }
  let fd: number | null = null;
  try {
    const stats = fs.statSync(filePath);
    const bufferSize = Math.min(stats.size, 65536);
    const buffer = Buffer.alloc(bufferSize);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
    const content = buffer.toString('utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (err) {
    console.error(`Error reading lines from ${filePath}:`, err);
    return [`SYSTEM: Error reading logs: ${err instanceof Error ? err.message : String(err)}`];
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// ─── Structured cycle parser ────────────────────────────────────────────────

interface ThreadInfo {
  pid: string;
  tid: string;
  cpu: number;
  memMB: number;
  status: string;
}

interface CycleData {
  timestamp: string;
  systemLoad: { one: number; five: number; fifteen: number };
  memUsedMB: number;
  memTotalMB: number;
  memPercent: number;
  threads: ThreadInfo[];
}

/**
 * Scan backwards through log lines to extract the most recent complete cycle.
 * Pattern (reading backwards): METRICS line → thread lines → SYSTEM: line → Timestamp: line.
 */
function parseLatestCycle(lines: string[]): CycleData | null {
  let inCycle = false;
  let timestamp = '';
  let loadOne = 0, loadFive = 0, loadFifteen = 0;
  let memUsedMB = 0, memTotalMB = 0, memPercent = 0;
  const threads: ThreadInfo[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Trigger: pass a METRICS line going backwards, then start collecting
    if (!inCycle) {
      if (line.includes('METRICS |')) inCycle = true;
      continue;
    }

    // Thread: "PID 61849 TID 61849 | CPU 69.6% | MEM 578 MB | THROTTLED"
    const tm = line.match(/PID\s+(\d+)\s+TID\s+(\d+)\s+\|\s+CPU\s+([\d.]+)%\s+\|\s+MEM\s+(\d+)\s+MB\s+\|\s+(\S+)/);
    if (tm) {
      threads.unshift({ pid: tm[1], tid: tm[2], cpu: parseFloat(tm[3]), memMB: parseInt(tm[4]), status: tm[5] });
      continue;
    }

    // System: "SYSTEM: Load: 9.94 9.95 8.46 | Mem: Used: 4535MB / Total: 5818MB (77.9%)"
    const sm = line.match(/SYSTEM: Load:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\|\s+Mem: Used:\s+(\d+)MB\s+\/\s+Total:\s+(\d+)MB\s+\(([\d.]+)%\)/);
    if (sm) {
      [, loadOne, loadFive, loadFifteen] = [0, parseFloat(sm[1]), parseFloat(sm[2]), parseFloat(sm[3])];
      memUsedMB = parseInt(sm[4]); memTotalMB = parseInt(sm[5]); memPercent = parseFloat(sm[6]);
      continue;
    }

    // Timestamp marks the start of this cycle — stop scanning
    const tsm = line.match(/Timestamp:\s+(.+)/);
    if (tsm) { timestamp = tsm[1].trim(); break; }
  }

  if (!timestamp && threads.length === 0) return null;
  return { timestamp, systemLoad: { one: loadOne, five: loadFive, fifteen: loadFifteen }, memUsedMB, memTotalMB, memPercent, threads };
}

// ────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.use(cookieParser(process.env.AUTH_SECRET || "fx-opt-secret-default"));
  app.use(express.json());
  let optimizerProcess: ChildProcess | null = null;
  // Tracks a pending auto-restart timer so explicit kills can cancel it cleanly.
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  // Auth Middleware
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.signedCookies[CONFIG.AUTH_COOKIE] === "authenticated") {
      return next();
    }
    res.status(401).json({ error: "Unauthorized" });
  };

  // Login Endpoint
  app.post("/api/login", (req, res) => {
    const { password } = req.body;
    if (password === CONFIG.DASHBOARD_PASSWORD) {
      res.cookie(CONFIG.AUTH_COOKIE, "authenticated", {
        signed: true,
        httpOnly: true,
        maxAge: 86400000, // 24h
        sameSite: 'none',
        secure: true
      });
      return res.json({ success: true });
    }
    res.status(401).json({ error: "Invalid password" });
  });

  // Logout Endpoint
  app.post("/api/logout", (_req, res) => {
    res.clearCookie(CONFIG.AUTH_COOKIE);
    res.json({ success: true });
  });

  function startOptimizer() {
    const optimizerPath = path.join(process.cwd(), CONFIG.OPTIMIZER_SCRIPT);
    if (!fs.existsSync(optimizerPath)) {
      console.error(`CRITICAL: Optimizer script not found at ${optimizerPath}`);
      return;
    }

    try {
      fs.chmodSync(optimizerPath, '755');
      console.log(`Starting Firefox Content Optimizer (Forensic: ${process.env.FORENSIC_MODE || 'false'})...`);
      
      const env = { 
        ...process.env,
        MIN_CPU: runtimeConfig.minCpu.toString(),
        OPTIMIZE_THRESHOLD: runtimeConfig.optimizeThreshold.toString(),
        RENICE_VAL: runtimeConfig.reniceVal.toString(),
        MONITOR_INTERVAL: runtimeConfig.monitorInterval.toString(),
        SUDO_PASSWORD: CONFIG.SUDO_PASSWORD
      };
      optimizerProcess = spawn("bash", [optimizerPath], { env });

      optimizerProcess.stdout?.on("data", (data) => {
        console.log(`[Optimizer] ${data.toString().trim()}`);
      });

      optimizerProcess.stderr?.on("data", (data) => {
        console.error(`[Optimizer Error] ${data.toString().trim()}`);
      });

      optimizerProcess.on("exit", (code) => {
        console.log(`Optimizer process exited with code ${code}`);
        optimizerProcess = null;
        // Auto-restart unless an explicit kill already scheduled a restart.
        if (!restartTimer) {
          console.log("Optimizer exited unexpectedly — auto-restarting in 3s...");
          restartTimer = setTimeout(() => {
            restartTimer = null;
            startOptimizer();
          }, 3000);
        }
      });
    } catch (err) {
      console.error(`CRITICAL: Failed to set permissions or spawn optimizer:`, err);
    }
  }

  // Initial start
  startOptimizer();

  // API: Get latest logs
  app.get("/api/logs", requireAuth, (_req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const lines = readLastLines(logPath, CONFIG.MAX_LOG_LINES);
    
    if (lines.length === 0 && !fs.existsSync(logPath)) {
      return res.json({ lines: ["Waiting for system initialization..."] });
    }
    
    res.json({ lines });
  });

  // API: Get system status
  app.get("/api/status", requireAuth, (_req, res) => {
    let sudoStatus = "missing";
    try {
      // Use top-level execSync (avoids dynamic import overhead on every 2s poll)
      execSync("sudo -n true 2>/dev/null", { stdio: 'ignore' });
      sudoStatus = "acquired";
    } catch {
      sudoStatus = "missing";
    }

    res.json({
      status: "running",
      optimizer: optimizerProcess ? "active" : "failed",
      forensicMode: process.env.FORENSIC_MODE === "true",
      sudoStatus,
      config: runtimeConfig,
      lastUpdate: new Date().toISOString(),
    });
  });

  // API: Update runtime config
  app.post("/api/config", requireAuth, (req, res) => {
    const { minCpu, optimizeThreshold, reniceVal, monitorInterval } = req.body;
    
    if (minCpu !== undefined) runtimeConfig.minCpu = parseFloat(minCpu);
    if (optimizeThreshold !== undefined) runtimeConfig.optimizeThreshold = parseFloat(optimizeThreshold);
    if (reniceVal !== undefined) runtimeConfig.reniceVal = parseInt(reniceVal);
    if (monitorInterval !== undefined) runtimeConfig.monitorInterval = parseInt(monitorInterval);

    // Restart optimizer to apply new config via environment variables
    if (optimizerProcess) {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      optimizerProcess.kill();
      optimizerProcess = null;
      restartTimer = setTimeout(() => { restartTimer = null; startOptimizer(); }, 500);
    }

    res.json({ status: "Configuration updated. System restarting...", config: runtimeConfig });
  });

  // API: Generate Forensic Report
  app.get("/api/report", requireAuth, (_req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const report = {
      generatedAt: new Date().toISOString(),
      systemStatus: optimizerProcess ? "active" : "failed",
      config: runtimeConfig,
      forensicMode: process.env.FORENSIC_MODE === "true",
      recentLogs: readLastLines(logPath, 500)
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=forensic_report.json');
    res.send(JSON.stringify(report, null, 2));
  });

  // API: System Recovery — respond immediately, restart in background
  app.get("/api/recover", requireAuth, (_req, res) => {
    console.log("SYSTEM: Initiating recovery sequence...");

    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (optimizerProcess) {
      optimizerProcess.kill();
      optimizerProcess = null;
    }

    try {
      const lockPath = path.join(process.cwd(), CONFIG.LOCK_FILE);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      const pk = spawn("pkill", ["-f", CONFIG.OPTIMIZER_SCRIPT]);
      pk.on('error', (err) => console.warn("Recovery: pkill not available:", err.message));
    } catch (err) {
      console.warn("Recovery: Cleanup warning:", err);
    }

    // Respond before the restart timer fires to avoid write-after-timeout errors
    res.json({ status: "Recovery sequence completed. System restarting..." });
    restartTimer = setTimeout(() => { restartTimer = null; startOptimizer(); }, 1000);
  });

  // API: Toggle Forensic Mode
  app.post("/api/forensic/toggle", requireAuth, (_req, res) => {
    const current = process.env.FORENSIC_MODE === "true";
    process.env.FORENSIC_MODE = (!current).toString();
    
    if (optimizerProcess) {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      optimizerProcess.kill();
      optimizerProcess = null;
      restartTimer = setTimeout(() => { restartTimer = null; startOptimizer(); }, 500);
    }

    res.json({ forensicMode: !current });
  });

  // API: Get metrics for D3 visualization
  app.get("/api/metrics", requireAuth, (_req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const recentLines = readLastLines(logPath, CONFIG.METRICS_WINDOW);
    
    let optimizedCount = 0;
    let activeCount = 0;
    let totalCpu = 0;
    let totalMem = 0;
    let lastMetricsLine = "";

    // Find the most recent METRICS line
    for (let i = recentLines.length - 1; i >= 0; i--) {
      if (recentLines[i].includes("METRICS |")) {
        lastMetricsLine = recentLines[i];
        break;
      }
    }

    if (lastMetricsLine) {
      // Parse: METRICS | Active: 10 | Optimized: 2 | TotalCPU: 15.5 | TotalMem: 2048 MB
      const parts = lastMetricsLine.split("|").map(p => p.trim());
      activeCount = parseInt(parts[1]?.split(":")[1]) || 0;
      optimizedCount = parseInt(parts[2]?.split(":")[1]) || 0;
      totalCpu = parseFloat(parts[3]?.split(":")[1]) || 0;
      totalMem = parseInt(parts[4]?.split(":")[1]) || 0;
    } else {
      // Fallback to legacy parsing if METRICS line isn't found yet
      optimizedCount = recentLines.filter(l => l.includes("OPTIMIZED")).length;
      activeCount = recentLines.filter(l => l.includes("Active")).length;
    }

    res.json({
      optimized: optimizedCount,
      active: activeCount,
      totalCpu,
      totalMem,
      timestamp: new Date().toISOString()
    });
  });

  // API: Latest cycle — structured thread + system data for the live process table
  app.get("/api/threads", requireAuth, (_req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    // 300 lines covers several cycles (each cycle is ~10-20 lines typically)
    const lines = readLastLines(logPath, 300);
    const cycle = parseLatestCycle(lines);
    if (!cycle) {
      return res.json({
        timestamp: null, threads: [],
        systemLoad: { one: 0, five: 0, fifteen: 0 },
        memUsedMB: 0, memTotalMB: 0, memPercent: 0,
      });
    }
    res.json(cycle);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error("Failed to initialize Vite server:", err);
      process.exit(1);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.warn("Production build (dist/) not found. Serving fallback.");
      app.get("*", (_req, res) => res.status(404).send("Application not built."));
    }
  }

  const server = app.listen(CONFIG.PORT, "0.0.0.0", () => {
    // Write PID file so scripts/stop.sh can send SIGTERM cleanly
    const pidPath = path.join(process.cwd(), CONFIG.PID_FILE);
    fs.writeFileSync(pidPath, String(process.pid));
    console.log(`Server running on http://localhost:${CONFIG.PORT} (PID ${process.pid})`);
  });

  /** Remove all runtime artefacts so the process can be restarted cleanly. */
  const cleanupArtefacts = () => {
    const pidPath = path.join(process.cwd(), CONFIG.PID_FILE);
    const lockPath = path.join(process.cwd(), CONFIG.LOCK_FILE);
    try { if (fs.existsSync(pidPath))  fs.unlinkSync(pidPath);  } catch { /* best-effort */ }
    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch { /* best-effort */ }
  };

  // Graceful shutdown — called by SIGTERM, SIGINT, and uncaught errors
  const shutdown = (reason = "signal") => {
    console.log(`Shutdown: ${reason}. Cleaning up...`);
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (optimizerProcess) {
      console.log("Terminating optimizer process...");
      optimizerProcess.kill("SIGTERM");
      optimizerProcess = null;
    }
    cleanupArtefacts();
    server.close(() => {
      console.log("Server closed cleanly.");
      process.exit(0);
    });
    // Force-exit after 5 s if server.close stalls (e.g. open keep-alive connections)
    setTimeout(() => { console.warn("Force-exiting after 5 s timeout."); process.exit(1); }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown("SIGTERM"));
  process.on('SIGINT',  () => shutdown("SIGINT"));
  process.on('uncaughtException', (err) => {
    console.error("Uncaught exception:", err);
    shutdown("uncaughtException");
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
