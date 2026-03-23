# Firefox Process Optimizer

A full-stack, real-time system utility designed to monitor and optimize Firefox's multi-threaded content processes. This application combines a high-performance Bash engine with a modern React/D3.js dashboard to provide full transparency and control over browser resource consumption.

## 🚀 Architecture Overview

The system operates across three distinct layers to ensure reliability, performance, and real-time visibility:

### 1. The Optimizer Engine (`firefox_content_opt.sh`)
A robust Bash script that serves as the system's "heart." It performs the heavy lifting of process monitoring and kernel-level priority adjustments.
- **Capture**: Actively queries the system for Firefox threads using `ps -eL`.
- **Filter**: Automatically ignores idle threads to focus on performance hotspots (default > 5% CPU).
- **Optimize**: Dynamically adjusts CPU priority (`renice`) and I/O priority (`ionice`) for heavy threads.
- **Audit**: Generates a real-time log (`active_threads.log`) with color-coded status and system-wide troubleshooting data.
- **Safety**: Uses a lockfile mechanism to prevent duplicate instances and includes a `--test` (dry run) mode.

### 2. The Backend API (`server.ts`)
An Express server that bridges the gap between the low-level Bash engine and the high-level UI.
- **Process Management**: Spawns the optimizer script as a detached background process and ensures graceful cleanup on shutdown.
- **Log Streaming**: Efficiently reads the tail of the log file and serves it via `/api/logs`.
- **Metrics Aggregation**: Parses log data to provide real-time metrics (optimized events vs active threads) via `/api/metrics`.
- **Status Monitoring**: Tracks the health of the background process via `/api/status`.

### 3. The Dashboard UI (`src/App.tsx`)
A high-fidelity React application designed for real-time monitoring and system transparency.
- **Live Audit Trail**: A terminal-like view that streams the optimizer's logs with syntax highlighting.
- **D3.js Visualization**: A real-time line chart visualizing the relationship between system activity and optimization events.
- **Resilience**: Features a custom Error Boundary for UI stability and a connection monitor that detects backend outages.
- **Motion Design**: Uses `motion/react` for smooth state transitions and high-energy UI feedback.

## 🛠️ Key Features

- **Real-time Evidence**: Unlike "black box" optimizers, this tool provides a live audit trail of every kernel-level change it makes.
- **Kernel-Level Precision**: Uses `renice` and `ionice` to ensure Firefox doesn't starve the rest of the system during heavy loads.
- **D3 Visualization**: High-performance data rendering to track optimization efficacy over time.
- **Fail-Safe Design**:
    - **Backend**: Automatic dependency checks and permission management (`chmod 755`).
    - **Frontend**: Error boundaries and offline state indicators.
    - **Script**: Lockfile protection and self-test suite.

## 🚦 Getting Started

### 1. Prerequisites
- **Linux Environment**: The optimizer script relies on Linux-specific utilities (`ps`, `renice`, `ionice`).
- **Node.js**: Required for the backend and frontend.

### 2. Installation
Install the necessary dependencies:
```bash
npm install
```

### 3. Running the Application
Start the full-stack application (Backend + Frontend):
```bash
npm run dev
```
The application will be accessible at `http://localhost:3000`.

### 4. Testing the Engine
You can run the Bash engine independently for testing:
- **Dry Run**: `bash firefox_content_opt.sh --test`
- **Self-Test**: `bash firefox_content_opt.sh --self-test`

## 📖 User Guide

### Interpreting the Dashboard

The dashboard is divided into three main sections to provide a comprehensive view of your system's health:

#### 1. Performance Metrics (Left Column)
- **CPU Threshold**: The minimum CPU usage percentage required for a thread to be considered "active" and eligible for optimization.
- **Nice Priority**: The value added to the process's current priority. A higher value (e.g., +5) means lower priority, allowing other system tasks to run more smoothly.
- **I/O Class**: The scheduling class used for disk access. "Best-Effort" ensures Firefox doesn't monopolize your hard drive.

#### 2. Activity History (Center Chart)
- **Orange Line (Optimized)**: Tracks the number of threads that were actively throttled in each cycle.
- **Green Line (Active Threads)**: Shows the total number of Firefox threads currently exceeding the CPU threshold.
- **Real-time Updates**: The chart updates every 2 seconds, providing a visual history of system stress and mitigation.

#### 3. Live Audit Trail (Right Column)
- **Color-coded Logs**:
    - **Orange**: Optimization events (e.g., "OPTIMIZED PID: 1234").
    - **Green**: Active thread detection.
    - **Blue**: System-level messages and initialization.
    - **Yellow**: Waiting states (e.g., when Firefox is not running).
- **Auto-scroll**: The terminal automatically scrolls to the latest entry, ensuring you always see the most recent system actions.

### Troubleshooting & Status Indicators

- **System Active (Green Pulse)**: The background optimizer is running and actively monitoring your system.
- **System Offline (Red Pulse)**: The background process has failed or been stopped. Check the server logs for details.
- **Connection Lost**: If you see a red "Connection Lost" banner, the UI cannot reach the backend API. Click the **Refresh** icon next to the banner to attempt a reconnection.
- **System Fault Detected**: If the UI crashes, a full-screen error boundary will appear. Use the **Restart Interface** button to re-initialize the dashboard.

## ⚙️ Configuration

You can customize the optimization parameters at the top of `firefox_content_opt.sh`:
- `MIN_CPU`: Threshold for "active" thread detection (default: 5.0).
- `RENICE_VAL`: Priority adjustment value (default: +5).
- `MONITOR_INTERVAL`: Sampling frequency in seconds (default: 2).

## 🛡️ Safety & Compliance
- **Lockfile**: Prevents system resource exhaustion from duplicate processes.
- **Graceful Shutdown**: Ensures all background processes are terminated when the server stops.
- **Audit Trail**: Maintains a clean, ANSI-stripped log for post-mortem analysis.
