# 🔥 Firefox Process Optimizer

A professional, full-stack system utility that monitors and throttles Firefox's multi-threaded content processes. Combines a high-performance Bash engine with a React/D3.js dashboard for full transparency and control over browser resource consumption.

---

## 📊 Observed Performance Results

Measured on a 4-core system (Fedora, kernel 6.x, 5.68 GB RAM) with Firefox and VSCode running concurrently.

| Metric | Before | After | Change |
| :--- | :--- | :--- | :--- |
| **All-core CPU avg** | 91–96% | 47–56% | **↓ ~44%** |
| **Load average (1 min)** | 10.96 | 3.81 | **↓ 65%** |
| **System memory used** | 4.78 GB | 3.17 GB | **↓ 1.6 GB freed** |
| **Top offender CPU** | 90.7% (PID 61849) | removed from top | **Throttled off chart** |

> The runaway Firefox contentproc (PID 61849, 8+ hours accumulated) was throttled to idle scheduling priority within one optimizer cycle, dropping all-core utilization from ~95% to ~50%.

---

## ⚠️ Known Limitations

- **Nice + ionice are advisory**: `renice`/`ionice` influence the scheduler but do not hard-cap CPU. On a completely idle system a `nice +19` process can still consume 100%. Effectiveness is highest when other work is competing for cores (normal desktop use).
- **Optimizer self-overhead**: The bash engine scans ~960 threads via `ps -eL` every cycle. At the default 2-second interval this costs ~3–5% CPU. Increase `MONITOR_INTERVAL` to `5` on constrained systems.
- **Scope is Firefox only**: VSCode and desktop compositor processes are not targeted. They appear in the top-consumer list but are left at default priority intentionally.
- **Swap pressure persists**: Memory freed from throttled processes does not immediately reclaim swap. Run `sudo swapoff -a && sudo swapon -a` to force reclaim after a sustained idle period.

---

## 📋 Prerequisites

- **Linux Environment**: The optimizer script relies on Linux-specific utilities (`ps`, `renice`, `ionice`).
  - **Supported Distributions**: Ubuntu/Debian (`apt`), Fedora/RHEL (`dnf`/`yum`).
- **Node.js**: Required for the backend and frontend.

---

## ⚡ Quick Start (Test It Now)

### 1. Clone the Repository
```bash
git clone https://github.com/swipswaps/firefox_fix.git
cd firefox_fix
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment (Optional)
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```
*   **`DASHBOARD_PASSWORD`**: The password for the web interface. Default is `admin123`.
*   **`SUDO_PASSWORD`**: (Optional) Your system's administrative password. If provided, the optimizer can non-interactively adjust process priorities. If omitted, the system will attempt to run with limited privileges.

### 4. Run the Application
```bash
npm run dev
```
The dashboard will be available at `http://localhost:3000`.

---

## 🔐 Default Credentials
*   **Password**: `admin123` (Change this via `DASHBOARD_PASSWORD` env var)

---

## 🧪 Testing the Engine

You can run the optimization engine independently to verify its behavior:

*   **Dry Run (No changes)**:
    ```bash
    bash firefox_content_opt.sh --test
    ```
*   **Self-Test (Full diagnostic)**:
    ```bash
    bash firefox_content_opt.sh --self-test
    ```

---

## 🛠️ Key Features

*   **Tiered Throttling**: Two-level CPU/IO priority system — moderate (`OPTIMIZED`) and severe (`THROTTLED`) — that scales response proportionally to thread CPU consumption.
*   **Auto-Recovery**: Server automatically detects optimizer crashes and respawns the engine within 3 seconds; no manual intervention needed.
*   **Local Authentication**: Secure dashboard access with signed cookies and password protection.
*   **Dynamic Configuration**: Adjust CPU thresholds, Nice values, and monitoring intervals in real-time without restarts.
*   **Sudo Privilege Management**: Robust handling of administrative tasks with a background keep-alive subshell.
*   **Forensic Audit Mode**: Deep analysis using `lsof` (open files) and `strace` (syscall summary) for heavy threads. Guarded behind a toggle — never blocks the main loop.
*   **Emergency Recovery**: One-click system reset to clear lockfiles and restart the optimization engine.
*   **D3.js Visualization**: Real-time line charts visualizing system activity vs. optimization efficacy.
*   **Downloadable Reports**: Generate a forensic snapshot of system status and logs in JSON format.

---

## 🚀 Architecture Overview

The system operates across three distinct layers:

### 1. The Optimizer Engine (`firefox_content_opt.sh`)
A robust Bash script that performs the heavy lifting of process monitoring and kernel-level priority adjustments.
- **Capture**: Queries Firefox threads using `ps -eL`, filtered to `-contentproc` via `awk` in a single pipe.
- **Classify**: One `awk` call per thread computes rounded CPU, memory, and tier (`SKIP` / `ACTIVE` / `MODERATE` / `SEVERE`). Replaces the previous 3×`awk` + 1×`bc` per-thread pattern (~75% fewer subprocess spawns).
- **Throttle (Moderate)**: `renice +RENICE_VAL` + `ionice -c 2 -n 7` (best-effort lowest priority I/O). Label: `OPTIMIZED`.
- **Throttle (Severe)**: `renice +19` + `ionice -c 3` (idle I/O — only scheduled when no other I/O is pending). Label: `THROTTLED`.
- **Audit**: Generates a real-time log (`active_threads.log`) with color-coded status and a `METRICS |` line each cycle for dashboard parsing.

### 2. The Backend API (`server.ts`)
An Express server that bridges the low-level Bash engine and the UI.
- **Auth Middleware**: Protects all sensitive routes via `requireAuth` with signed session cookies.
- **Process Management**: Spawns the optimizer as a managed child process with stdout/stderr capture.
- **Auto-Restart**: If the optimizer exits unexpectedly, the server schedules a respawn within 3 seconds. Explicit kills (config change, forensic toggle, recovery) cancel pending auto-restart timers to prevent duplicate spawns.
- **Metrics Aggregation**: Parses `METRICS |` lines from the log file for real-time D3 dashboard updates.

### 3. The Dashboard UI (`src/App.tsx`)
A high-fidelity React application with a **Hardware/Specialist Tool** aesthetic.
- **Live Audit Trail**: Terminal-like view streaming optimizer logs.
- **Interactive Controls**: Real-time sliders for optimization parameters.
- **Resilience**: Integrated Error Boundaries and connection monitors.

---

## ⚙️ Configuration Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MIN_CPU` | CPU % floor — threads below this are skipped entirely | `0.1%` |
| `OPTIMIZE_THRESHOLD` | CPU % triggering **moderate** throttle (`OPTIMIZED`) | `5.0%` |
| `SEVERE_THRESHOLD` | CPU % triggering **severe** throttle (`THROTTLED`) | `15.0%` |
| `RENICE_VAL` | Nice value for moderate tier | `+5` |
| `SEVERE_RENICE_VAL` | Nice value for severe tier (kernel maximum) | `+19` |
| `MONITOR_INTERVAL` | Seconds between scan cycles — increase to `5` on low-RAM systems | `2` |
| `DASHBOARD_PASSWORD` | Web dashboard access password | `admin123` |
| `SUDO_PASSWORD` | Sudo password for privilege escalation (optional) | `""` |

### Throttling Tier Reference

```
cpu < MIN_CPU (0.1%)              → SKIP    (not printed, not counted)
MIN_CPU ≤ cpu < OPTIMIZE_THRESHOLD → ACTIVE  (printed green, no action)
OPTIMIZE_THRESHOLD ≤ cpu < SEVERE  → OPTIMIZED (renice +5, ionice -c 2 -n 7)
cpu ≥ SEVERE_THRESHOLD (15%)      → THROTTLED (renice +19, ionice -c 3 idle)
```

---

## 🛡️ Safety & Compliance
- **Lockfile**: Prevents duplicate optimizer instances.
- **Graceful Shutdown**: SIGTERM/SIGINT handlers terminate the optimizer child before the Node process exits.
- **Auto-Restart Guard**: `restartTimer` variable prevents race conditions between crash recovery and explicit kills.
- **Forensic Guard**: `lsof`/`strace`/`ss` only run when Forensic Mode is explicitly enabled — they are never called in the main scan loop.
- **Audit Trail**: Rotating log (`active_threads.log`, max 1 MB) with timestamped entries for post-mortem analysis.
