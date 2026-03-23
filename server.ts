import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Start the Bash optimizer in the background
  const optimizerPath = path.join(process.cwd(), "firefox_content_opt.sh");
  if (fs.existsSync(optimizerPath)) {
    console.log("Starting Firefox Content Optimizer...");
    const optimizer = spawn("bash", [optimizerPath], {
      detached: true,
      stdio: "ignore",
    });
    optimizer.unref();
  }

  // API to get the latest logs
  app.get("/api/logs", (req, res) => {
    const logPath = path.join(process.cwd(), "active_threads.log");
    if (fs.existsSync(logPath)) {
      try {
        const logs = fs.readFileSync(logPath, "utf8");
        const lines = logs.split("\n").filter(Boolean).slice(-100);
        res.json({ lines });
      } catch (err) {
        res.status(500).json({ error: "Failed to read logs" });
      }
    } else {
      res.json({ lines: ["Waiting for log file to be created..."] });
    }
  });

  // API to get system status
  app.get("/api/status", (req, res) => {
    res.json({
      status: "running",
      optimizer: "active",
      lastUpdate: new Date().toISOString(),
    });
  });

  // API to get metrics for D3 visualization
  app.get("/api/metrics", (req, res) => {
    const logPath = path.join(process.cwd(), "active_threads.log");
    if (fs.existsSync(logPath)) {
      try {
        const logs = fs.readFileSync(logPath, "utf8");
        const lines = logs.split("\n").filter(Boolean);
        
        // Extract some metrics from the last 500 lines
        const recentLines = lines.slice(-500);
        const optimizedCount = recentLines.filter(l => l.includes("OPTIMIZED")).length;
        const activeCount = recentLines.filter(l => l.includes("Active")).length;
        const cycles = recentLines.filter(l => l.includes("Timestamp:")).length;

        res.json({
          optimized: optimizedCount,
          active: activeCount,
          cycles,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        res.status(500).json({ error: "Failed to read metrics" });
      }
    } else {
      res.json({ optimized: 0, active: 0, cycles: 0, timestamp: new Date().toISOString() });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
