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

  // Fail-fast: Check if optimizer script exists
  const optimizerPath = path.join(process.cwd(), CONFIG.OPTIMIZER_SCRIPT);
  if (!fs.existsSync(optimizerPath)) {
    console.error(`CRITICAL: Optimizer script not found at ${optimizerPath}`);
  } else {
    try {
      fs.chmodSync(optimizerPath, '755');
      console.log("Starting Firefox Content Optimizer...");
      optimizerProcess = spawn("bash", [optimizerPath], {
      detached: true,
      stdio: "ignore",
    });
    optimizerProcess.unref();
    } catch (err) {
      console.error(`CRITICAL: Failed to set permissions or spawn optimizer:`, err);
    }
  }

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
      lastUpdate: new Date().toISOString(),
    });
  });

  // API: Get metrics for D3 visualization
  app.get("/api/metrics", (req, res) => {
    const logPath = path.join(process.cwd(), CONFIG.LOG_FILE);
    const recentLines = readLastLines(logPath, CONFIG.METRICS_WINDOW);
    
    const optimizedCount = recentLines.filter(l => l.includes("OPTIMIZED")).length;
    const activeCount = recentLines.filter(l => l.includes("Active")).length;
    const cycles = recentLines.filter(l => l.includes("Timestamp:")).length;

    res.json({
      optimized: optimizedCount,
      active: activeCount,
      cycles,
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
