import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, ChildProcess } from "child_process";
import cookieParser from "cookie-parser";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  PORT: 3000,
  LOG_FILE: "active_threads.log",
  LOCK_FILE: "firefox_optimizer.lock",
  OPTIMIZER_SCRIPT: "firefox_content_opt.sh",
  MAX_LOG_LINES: 500,
  METRICS_WINDOW: 500,
  POLL_INTERVAL: 2000,
  BACKUP_DIR: "backups",
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
 * Utility to read the last N lines of a file efficiently.
 * For very large files, this should use a reverse stream, but for this utility,
 * reading the last chunk is sufficient.
 */
function readLastLines(filePath: string, maxLines: number): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      return ["SYSTEM: Log file not found. System may be initializing..."];
    }
    
    // Read the last 64KB of the file which should contain more than enough lines
    const stats = fs.statSync(filePath);
    const bufferSize = Math.min(stats.size, 65536);
    const buffer = Buffer.alloc(bufferSize);
    const fd = fs.openSync(filePath, 'r');
    
    fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stats.size - bufferSize));
    fs.closeSync(fd);
    
    const content = buffer.toString('utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (err) {
    console.error(`Error reading lines from ${filePath}:`, err);
    return [`SYSTEM: Error reading logs: ${err instanceof Error ? err.message : String(err)}`];
  }
}

async function startServer() {
  const app = express();
  app.use(cookieParser(process.env.AUTH_SECRET || "fx-opt-secret-default"));
  app.use(express.json());
  let optimizerProcess: ChildProcess | null = null;

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
  app.post("/api/logout", (req, res) => {
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
        const errorMsg = data.toString().trim();
        console.error(`[Optimizer Error] ${errorMsg}`);
        // Log critical errors to the audit trail so the user can see them in the UI
        fs.appendFileSync(
          path.join(process.cwd(), CONFIG.LOG_FILE),
          `${new Date().toISOString()} | SYSTEM ERROR: ${errorMsg}\n`
        );
      });

      optimizerProcess.on("exit", (code) => {
        console.log(`Optimizer process exited with code ${code}`);
        optimizerProcess = null;
        // If it crashed (non-zero), log it to the audit trail
        if (code !== 0 && code !== null) {
          fs.appendFileSync(
            path.join(process.cwd(), CONFIG.LOG_FILE),
            `${new Date().toISOString()} | CRITICAL: Optimizer crashed with code ${code}. Check dependencies.\n`
          );
        }
      });
    } catch (err) {
      console.error(`CRITICAL: Failed to set permissions or spawn optimizer:`, err);
    }
  }

  // Initial start
  startOptimizer();

  // API: Get latest logs
  app.get("/api/logs", requireAuth, (req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const lines = readLastLines(logPath, CONFIG.MAX_LOG_LINES);
    
    if (lines.length === 0 && !fs.existsSync(logPath)) {
      return res.json({ lines: ["Waiting for system initialization..."] });
    }
    
    res.json({ lines });
  });

  // API: Get system status
  app.get("/api/status", requireAuth, async (req, res) => {
    let sudoStatus = "missing";
    try {
      // Check if sudo is available non-interactively
      const { execSync } = await import("child_process");
      execSync("sudo -n true 2>/dev/null");
      sudoStatus = "acquired";
    } catch (err) {
      sudoStatus = "missing";
    }

    // Find the last optimizer cycle time from logs
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const recentLines = readLastLines(logPath, 50);
    let lastCycleTime = null;
    for (let i = recentLines.length - 1; i >= 0; i--) {
      const line = recentLines[i];
      if (line.includes("Timestamp:")) {
        const match = line.match(/Timestamp:\s+(.*)/);
        if (match) {
          lastCycleTime = match[1];
          break;
        }
      }
    }

    res.json({
      status: "running",
      optimizer: optimizerProcess ? "active" : "failed",
      forensicMode: process.env.FORENSIC_MODE === "true",
      sudoStatus,
      config: runtimeConfig,
      lastUpdate: new Date().toISOString(),
      lastOptimizerCycle: lastCycleTime
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
      optimizerProcess.kill();
      optimizerProcess = null;
      setTimeout(startOptimizer, 500);
    }

    res.json({ status: "Configuration updated. System restarting...", config: runtimeConfig });
  });

  // API: Generate Forensic Report
  app.get("/api/report", requireAuth, (req, res) => {
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

  // API: System Recovery
  app.get("/api/recover", requireAuth, async (req, res) => {
    console.log("SYSTEM: Initiating recovery sequence...");
    
    if (optimizerProcess) {
      optimizerProcess.kill();
      optimizerProcess = null;
    }

    try {
      const lockPath = path.join(process.cwd(), CONFIG.LOCK_FILE);
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
      const pk = spawn("pkill", ["-f", CONFIG.OPTIMIZER_SCRIPT]);
      pk.on('error', (err) => console.warn("Recovery: pkill not available:", err.message));
    } catch (err) {
      console.warn("Recovery: Cleanup warning:", err);
    }

    setTimeout(() => {
      startOptimizer();
      res.json({ status: "Recovery sequence completed. System restarting..." });
    }, 1000);
  });

  // API: Toggle Forensic Mode
  app.post("/api/forensic/toggle", requireAuth, (req, res) => {
    const current = process.env.FORENSIC_MODE === "true";
    process.env.FORENSIC_MODE = (!current).toString();
    
    if (optimizerProcess) {
      optimizerProcess.kill();
      optimizerProcess = null;
      setTimeout(startOptimizer, 500);
    }

    res.json({ forensicMode: !current });
  });

  // API: Get metrics for D3 visualization
  app.get("/api/metrics", requireAuth, (req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const recentLines = readLastLines(logPath, CONFIG.METRICS_WINDOW);
    
    let optimizedCount = 0;
    let activeCount = 0;
    let totalCpu = 0;
    let totalMem = 0;
    let lastMetricsLine = "";
    const threads: any[] = [];

    // Find the most recent METRICS line and collect THREAD lines from the same cycle
    let inLatestCycle = false;
    for (let i = recentLines.length - 1; i >= 0; i--) {
      const line = recentLines[i];
      
      if (line.includes("METRICS |")) {
        if (!lastMetricsLine) {
          lastMetricsLine = line;
          inLatestCycle = true;
        } else if (inLatestCycle) {
          break;
        }
      }

      if (inLatestCycle && line.includes("THREAD |")) {
        const threadData: any = {};
        line.split("|").slice(1).forEach(part => {
          const [key, val] = part.split(":").map(s => s.trim());
          threadData[key.toLowerCase()] = isNaN(Number(val)) ? val : Number(val);
        });
        threads.push(threadData);
      }

      if (inLatestCycle && line.includes("Timestamp:")) {
        inLatestCycle = false;
      }
    }

    if (lastMetricsLine) {
      const parts = lastMetricsLine.split("|").map(p => p.trim());
      activeCount = parseInt(parts[1]?.split(":")[1]) || 0;
      optimizedCount = parseInt(parts[2]?.split(":")[1]) || 0;
      totalCpu = parseFloat(parts[3]?.split(":")[1]) || 0;
      totalMem = parseInt(parts[4]?.split(":")[1]) || 0;
    } else {
      optimizedCount = recentLines.filter(l => l.includes("OPTIMIZED")).length;
      activeCount = recentLines.filter(l => l.includes("Active")).length;
    }

    res.json({
      optimized: optimizedCount,
      active: activeCount,
      totalCpu,
      totalMem,
      threads,
      timestamp: new Date().toISOString()
    });
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
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.warn("Production build (dist/) not found. Serving fallback.");
      app.get("*", (req, res) => res.status(404).send("Application not built."));
    }
  }

  const server = app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${CONFIG.PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutdown signal received. Cleaning up...");
    if (optimizerProcess) {
      console.log("Terminating optimizer process...");
      optimizerProcess.kill();
    }
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
