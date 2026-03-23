import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, ChildProcess } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  PORT: 3000,
  LOG_FILE: "active_threads.log",
  LOCK_FILE: "firefox_opt.lock",
  OPTIMIZER_SCRIPT: "firefox_content_opt.sh",
  MAX_LOG_LINES: 100,
  METRICS_WINDOW: 500,
  POLL_INTERVAL: 2000,
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
  let optimizerProcess: ChildProcess | null = null;

  function startOptimizer() {
    const optimizerPath = path.join(process.cwd(), CONFIG.OPTIMIZER_SCRIPT);
    if (!fs.existsSync(optimizerPath)) {
      console.error(`CRITICAL: Optimizer script not found at ${optimizerPath}`);
      return;
    }

    try {
      fs.chmodSync(optimizerPath, '755');
      console.log(`Starting Firefox Content Optimizer (Forensic: ${process.env.FORENSIC_MODE || 'false'})...`);
      
      const env = { ...process.env };
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
      });
    } catch (err) {
      console.error(`CRITICAL: Failed to set permissions or spawn optimizer:`, err);
    }
  }

  // Initial start
  startOptimizer();

  // API: Get latest logs
  app.get("/api/logs", (req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const lines = readLastLines(logPath, CONFIG.MAX_LOG_LINES);
    
    if (lines.length === 0 && !fs.existsSync(logPath)) {
      return res.json({ lines: ["Waiting for system initialization..."] });
    }
    
    res.json({ lines });
  });

  // API: Get system status
  app.get("/api/status", (req, res) => {
    res.json({
      status: "running",
      optimizer: optimizerProcess ? "active" : "failed",
      forensicMode: process.env.FORENSIC_MODE === "true",
      lastUpdate: new Date().toISOString(),
    });
  });

  // API: System Recovery
  app.get("/api/recover", async (req, res) => {
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
      spawn("pkill", ["-f", CONFIG.OPTIMIZER_SCRIPT]);
    } catch (err) {
      console.warn("Recovery: Cleanup warning:", err);
    }

    setTimeout(() => {
      startOptimizer();
      res.json({ status: "Recovery sequence completed. System restarting..." });
    }, 1000);
  });

  // API: Toggle Forensic Mode
  app.post("/api/forensic/toggle", (req, res) => {
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
  app.get("/api/metrics", (req, res) => {
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
