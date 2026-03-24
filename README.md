# 🔥 Firefox Process Optimizer

A professional, full-stack system utility designed to monitor and optimize Firefox's multi-threaded content processes. This application combines a high-performance Bash engine with a modern React/D3.js dashboard to provide full transparency and control over browser resource consumption.

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

#### Option A: Secure Terminal Elevation (Recommended)
Run the application with `sudo` directly from your Fedora terminal. This avoids storing your password in any files:
```bash
sudo npm run dev
```
*   The system will prompt you for your password in the terminal.
*   The web interface will show **Sudo Status: Acquired** without needing `SUDO_PASSWORD` in `.env`.

#### Option B: Background Mode (Using .env)
If you want to run the app as a background service:
1.  Add your password to `SUDO_PASSWORD` in `.env`.
2.  Run `npm run dev`.

---

## 🔄 How to Update

To update the application to the latest version and apply new fixes:

1.  **Stop the current process**: Press `Ctrl+C` in your terminal.
2.  **Pull the latest changes**:
    ```bash
    git pull origin main
    ```
3.  **Update dependencies**:
    ```bash
    npm install
    ```
4.  **Restart the application**:
    ```bash
    sudo npm run dev
    ```

---

## 🛠️ Troubleshooting

### "Kernel Halted" or No Live Logs
If the dashboard shows "Kernel Halted" or logs aren't updating:
1.  **Check Firefox**: Ensure Firefox is actually running. The optimizer only shows data when Firefox content processes are active.
2.  **Check Permissions**: Ensure you ran the app with `sudo`.
3.  **Emergency Recovery**: Click the **"Emergency Recovery"** button in the System Control panel. This will clear any stale lockfiles and restart the engine.
4.  **Manual Check**:
    ```bash
    tail -f active_threads.log
    ```
    If this file is empty, the optimizer script isn't running or isn't finding processes.

### Sudo Failures on Fedora
If you see "Sudo Status: Missing" despite running with sudo:
-   Ensure your user is in the `wheel` group.
-   Try running `sudo -v` in your terminal before starting the app to refresh your sudo credentials.

---

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

*   **Local Authentication**: Secure dashboard access with signed cookies and password protection.
*   **Dynamic Configuration**: Adjust CPU thresholds, Nice values, and monitoring intervals in real-time without restarts.
*   **Sudo Privilege Management**: Robust handling of administrative tasks with a background keep-alive subshell.
*   **Forensic Audit Mode**: Deep analysis using `lsof` (open files) and `strace` (syscall summary) for heavy threads.
*   **Emergency Recovery**: One-click system reset to clear lockfiles and restart the optimization engine.
*   **D3.js Visualization**: Real-time line charts visualizing system activity vs. optimization efficacy.
*   **Downloadable Reports**: Generate a forensic snapshot of system status and logs in JSON format.

---

## 🚀 Architecture Overview

The system operates across three distinct layers:

### 1. The Optimizer Engine (`firefox_content_opt.sh`)
A robust Bash script that performs the heavy lifting of process monitoring and kernel-level priority adjustments.
- **Capture**: Queries Firefox threads using `ps -eL`.
- **Optimize**: Dynamically adjusts CPU priority (`renice`) and I/O priority (`ionice`).
- **Audit**: Generates a real-time log (`active_threads.log`) with color-coded status.

### 2. The Backend API (`server.ts`)
An Express server that bridges the gap between the low-level Bash engine and the UI.
- **Auth Middleware**: Protects all sensitive routes via `requireAuth`.
- **Process Management**: Spawns the optimizer as a detached background process.
- **Metrics Aggregation**: Parses log data for real-time dashboard updates.

### 3. The Dashboard UI (`src/App.tsx`)
A high-fidelity React application with a **Hardware/Specialist Tool** aesthetic.
- **Live Audit Trail**: Terminal-like view streaming optimizer logs.
- **Interactive Controls**: Real-time sliders for optimization parameters.
- **Resilience**: Integrated Error Boundaries and connection monitors.

---

## ⚙️ Configuration Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `MIN_CPU` | CPU threshold for optimization | `5.0%` |
| `RENICE_VAL` | Priority adjustment value | `+5` |
| `MONITOR_INTERVAL` | Sampling frequency | `2s` |
| `DASHBOARD_PASSWORD` | Access password | `admin123` |
| `SUDO_PASSWORD` | Sudo password for escalation | `""` |

---

## 🛡️ Safety & Compliance
- **Lockfile**: Prevents duplicate processes.
- **Graceful Shutdown**: Ensures background processes are terminated on exit.
- **Audit Trail**: Maintains a clean log for post-mortem analysis.
