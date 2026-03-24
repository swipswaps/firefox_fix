#!/usr/bin/env bash
# firefox_content_opt.sh
#
# PRF-compliant: Automatically captures Firefox threads, filters active ones (>0.0% CPU),
# preserves timestamps, prints to terminal with color, and applies renice/ionice optimizations.
#
# Best Practices Upgrades:
# 1. POSIX-compliant command checking (command -v).
# 2. Robust ANSI escape sequence stripping (supports more variants).
# 3. Job-controlled sudo keep-alive (prevents orphan processes).
# 4. Optimized process capture (native awk filtering to reduce pipes).
# 5. Localized variables to prevent namespace pollution.
# 6. Shellcheck-clean code (quoting, array handling).
# 7. Enhanced error handling for system calls.

# Exit on error, undefined variable, and pipe failure
set -euo pipefail

# -----------------------------
# CONFIGURATION
# -----------------------------
# Use absolute paths where possible or ensure relative paths are safe
OUTPUT_FILE="./active_threads.log"
LOCK_FILE="./firefox_optimizer.lock"
MAX_LOG_SIZE_KB=1024            # Rotate log after 1MB
MIN_CPU=${MIN_CPU:-0.1}         # Threshold for "active" (0.1% CPU)
RENICE_VAL=${RENICE_VAL:-5}           # Moderate tier: nice +5
SEVERE_RENICE_VAL=${SEVERE_RENICE_VAL:-19}  # Severe tier: nice +19 (absolute minimum)
SEVERE_THRESHOLD=${SEVERE_THRESHOLD:-15.0}  # CPU % triggering severe throttle
IONICE_CLASS=2                        # Moderate tier: best-effort I/O
IONICE_PRIO=7                         # Moderate tier: lowest within class
MONITOR_INTERVAL=${MONITOR_INTERVAL:-2} # Seconds between cycles
TIMESTAMP_PREFIX="Timestamp:"
OPTIMIZE_THRESHOLD=${OPTIMIZE_THRESHOLD:-5.0} # CPU % to trigger renice/ionice
DRY_RUN=${DRY_RUN:-false}       # Set to true to skip actual renice/ionice
FORENSIC_MODE=${FORENSIC_MODE:-false} # Set to true for deep thread analysis
SELF_TEST_MODE=false            # Internal flag for self-test
SUDO_REFRESH_PID=""             # Global to track the refresher

# Terminal Colors (using printf-compatible escapes)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ANSI Strip Pattern (Robust regex for various escape sequences)
# Reference: https://stackoverflow.com/questions/14693701/how-can-i-remove-the-ansi-escape-sequences-from-a-string-in-python
ANSI_STRIP_RE="s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g"

# -----------------------------
# OS CHECK
# -----------------------------
# Best Practice: Use uname -s for explicit string comparison
if [[ "$(uname -s)" != "Linux" ]]; then
    printf "${RED}ERROR: This script requires a Linux environment (kernel features like /proc and ionice are required).${NC}\n"
    printf "${YELLOW}If you are on Windows, please run this inside WSL2 (Windows Subsystem for Linux).${NC}\n"
    exit 1
fi

# -----------------------------
# FUNCTIONS
# -----------------------------

# Internal assertion helper
# Best Practice: Use local variables and explicit exit codes
assert() {
    local condition="$1"
    local msg="$2"
    if ! eval "$condition"; then
        printf "${RED}ASSERTION FAILED: %s${NC}\n" "$msg" >&2
        exit 1
    fi
}

# Check if sudo is available and functional
# Best Practice: Use -n (non-interactive) to avoid hanging
has_sudo() {
    # If already root, we don't need sudo
    if [[ "$EUID" -eq 0 ]]; then
        return 1
    fi
    command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

# Sudo Refresher
# Best Practice: Use a subshell with job control and ensure cleanup
init_sudo() {
    if [[ "$DRY_RUN" == "true" || "$SELF_TEST_MODE" == "true" ]]; then
        return
    fi

    printf "${BLUE}Requesting administrative privileges for process optimization...${NC}\n"
    
    # Check if password is provided via env
    local sudo_cmd="sudo -v"
    if [[ -n "${SUDO_PASSWORD:-}" ]]; then
        printf "%s" "$SUDO_PASSWORD" | sudo -S -v 2>/dev/null || true
    else
        # Prompt for password once (if interactive); || true prevents set -e exit
        sudo -n -v 2>/dev/null || true
    fi

    if sudo -n -v 2>/dev/null; then
        # Keep-alive sudo in background subshell
        (
            while kill -0 "$$" 2>/dev/null; do
                if [[ -n "${SUDO_PASSWORD:-}" ]]; then
                    printf "%s" "$SUDO_PASSWORD" | sudo -S -v 2>/dev/null || exit
                else
                    sudo -n -v 2>/dev/null || exit
                fi
                sleep 60
            done
        ) &
        SUDO_REFRESH_PID=$!
        # Ensure the refresher is killed on exit
        trap 'cleanup' EXIT SIGINT SIGTERM
        printf "${GREEN}Sudo privileges acquired and kept alive (PID: %d).${NC}\n" "$SUDO_REFRESH_PID"
    else
        printf "${YELLOW}WARNING: Sudo privileges not acquired. Optimizations may fail with 'Perm Denied'.${NC}\n"
    fi
}

# Dependency management
# Best Practice: Map tools to packages explicitly for multiple managers
check_dependencies() {
    local tools=("ps" "pkill" "awk" "grep" "uptime" "free" "renice" "ionice" "sed" "tee" "lsof" "strace" "bc")
    local missing=()

    assert "[[ ${#tools[@]} -gt 0 ]]" "Tools list for dependency check is empty"

    for tool in "${tools[@]}"; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing+=("$tool")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        printf "${YELLOW}Missing dependencies: %s${NC}\n" "${missing[*]}"
        
        if has_sudo; then
            printf "${BLUE}Attempting to install missing tools via sudo...${NC}\n"
            if command -v dnf >/dev/null 2>&1; then
                # Fedora/RHEL support
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps"|"pkill"|"free"|"uptime") sudo dnf install -y -q procps-ng ;;
                        "renice") sudo dnf install -y -q util-linux ;;
                        "ionice") sudo dnf install -y -q util-linux ;;
                        *) sudo dnf install -y -q "$tool" ;;
                    esac
                done
            elif command -v apt-get >/dev/null 2>&1; then
                sudo apt-get update -qq
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps"|"pkill"|"free"|"uptime") sudo apt-get install -y -qq procps ;;
                        "renice") sudo apt-get install -y -qq bsdutils ;;
                        "ionice") sudo apt-get install -y -qq util-linux ;;
                        *) sudo apt-get install -y -qq "$tool" ;;
                    esac
                done
            elif command -v yum >/dev/null 2>&1; then
                for tool in "${missing[@]}"; do
                    sudo yum install -y -q "$tool"
                done
            fi
        else
            printf "${RED}ERROR: Missing tools and sudo not available.${NC}\n"
            printf "${BLUE}Please install the following packages manually:${NC}\n"
            printf "  - procps (ps, free, uptime)\n"
            printf "  - bsdutils (renice)\n"
            printf "  - util-linux (ionice)\n"
            printf "  - coreutils, sed, grep, gawk\n"
            exit 1
        fi
        
        # Re-verify
        for tool in "${missing[@]}"; do
            if ! command -v "$tool" >/dev/null 2>&1; then
                printf "${RED}ERROR: Failed to install '%s'.${NC}\n" "$tool"
                exit 1
            fi
        done
        printf "${GREEN}All dependencies installed successfully.${NC}\n"
    fi
}

# Logging function
# Best Practice: Use printf for consistent output and handle ANSI stripping centrally
log_msg() {
    local msg="$1"
    local color="${2:-$NC}"
    
    [[ -z "$msg" ]] && return

    # Log rotation check
    if [[ -f "$OUTPUT_FILE" ]]; then
        local size_kb
        size_kb=$(du -k "$OUTPUT_FILE" | cut -f1)
        if (( size_kb > MAX_LOG_SIZE_KB )); then
            mv "$OUTPUT_FILE" "${OUTPUT_FILE}.old"
            printf "%s | Log rotated due to size limit (%d KB).\n" "$(date '+%F %T')" "$size_kb" > "$OUTPUT_FILE"
        fi
    fi

    # Print to terminal with color
    printf "${color}%s | %s${NC}\n" "$(date '+%F %T')" "$msg"
    # Append to log file without color
    printf "%s | %s\n" "$(date '+%F %T')" "$msg" | sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE"
    
    assert "[[ -f '$OUTPUT_FILE' ]]" "Log file $OUTPUT_FILE was not created/updated"
}

cleanup() {
    # Best Practice: Avoid recursive calls or infinite loops in cleanup
    # Kill the sudo refresher if it exists
    if [[ -n "$SUDO_REFRESH_PID" ]]; then
        kill "$SUDO_REFRESH_PID" 2>/dev/null || true
    fi

    # Remove lockfile
    rm -f "$LOCK_FILE"

    printf "\n${BLUE}Shutting down Firefox Process Optimizer...${NC}\n"
    # We don't call log_msg here to avoid potential issues if log_msg fails
    printf "%s | Optimizer stopped by user.\n" "$(date '+%F %T')" >> "$OUTPUT_FILE"
    exit 0
}

# Backup management
backup_logs() {
    local backup_dir="backups"
    local timestamp
    timestamp=$(date '+%Y%m%d_%H%M%S')
    
    mkdir -p "$backup_dir"
    if [[ -f "$OUTPUT_FILE" ]]; then
        cp "$OUTPUT_FILE" "$backup_dir/audit_trail_${timestamp}.log"
        # Keep only the last 5 backups
        ls -t "$backup_dir"/audit_trail_*.log | tail -n +6 | xargs rm -f 2>/dev/null
        log_msg "SYSTEM: Log backup created: audit_trail_${timestamp}.log" "$BLUE"
    fi
}

# Forensic Audit for heavy threads — only runs when FORENSIC_MODE=true.
# lsof and ss can block for several seconds; running them in standard mode
# would stall the main loop and prevent METRICS lines from being written.
forensic_audit() {
    local tid=$1
    local pid=$2

    if [[ "$FORENSIC_MODE" != "true" ]]; then
        return
    fi

    if command -v lsof >/dev/null 2>&1; then
        local files_count
        files_count=$(lsof -p "$pid" 2>/dev/null | wc -l)
        printf "${BLUE}FORENSIC: PID %s Open Files: %d${NC}\n" "$pid" "$files_count" | \
            tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
    fi

    # Network Connections
    if command -v ss >/dev/null 2>&1; then
        local net_conns
        net_conns=$(ss -tpn "pid=$pid" 2>/dev/null | grep -v "State" | head -n 5)
        if [[ -n "$net_conns" ]]; then
            printf "${BLUE}FORENSIC: PID %s Network Connections (Top 5):${NC}\n%s\n" "$pid" "$net_conns" | \
                tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
        fi
    elif command -v netstat >/dev/null 2>&1; then
        local net_conns
        net_conns=$(netstat -tpn 2>/dev/null | grep "$pid/" | head -n 5)
        if [[ -n "$net_conns" ]]; then
            printf "${BLUE}FORENSIC: PID %s Network Connections (Top 5):${NC}\n%s\n" "$pid" "$net_conns" | \
                tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
        fi
    fi
    
    # Optional: strace a small sample (1s) to see what it's doing
    # This is heavy, so we only do it if explicitly requested or for very heavy threads
    if [[ "$FORENSIC_MODE" == "true" ]] && command -v strace >/dev/null 2>&1; then
        local syscall_summary
        syscall_summary=$(timeout 1 strace -p "$tid" -c 2>&1 | grep -A 20 "% time" | tail -n +3 | head -n 5)
        if [[ -n "$syscall_summary" ]]; then
            printf "${BLUE}FORENSIC: TID %s Syscall Summary (1s):${NC}\n%s\n" "$tid" "$syscall_summary" | \
                tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
        fi
    fi
}

process_cycle() {
    local ts load mem_info
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    
    assert "[[ -n '$ts' ]]" "Failed to generate timestamp"

    # Best Practice: Use more robust parsing for uptime and free
    load=$(uptime | awk -F'load average:' '{ print $2 }' | sed 's/^ //; s/,//g')
    mem_info=$(free -m | awk '/Mem:/ { printf "Used: %dMB / Total: %dMB (%.1f%%)", $3, $2, $3*100/$2 }')

    assert "[[ -n '$load' ]]" "Failed to capture system load"
    assert "[[ -n '$mem_info' ]]" "Failed to capture memory info"

    # Header for the cycle — write plain text to file and stdout via tee.
    # Use '%s\n' format to avoid bash printf treating leading dashes as option flags.
    local sep="----------------------------------------------------------------"
    {
        printf '%s\n' "$sep"
        printf '%s %s\n' "$TIMESTAMP_PREFIX" "$ts"
        printf 'SYSTEM: Load: %s | Mem: %s\n' "$load" "$mem_info"
        printf '%s\n' "$sep"
    } | tee -a "$OUTPUT_FILE"

    local opt_count=0
    
    # Capture thread data
    # Best Practice: Use native awk filtering to reduce pipes and overhead
    # Harden: Ensure ps output is valid and handle potential empty/malformed lines
    local ps_output
    if ! ps_output=$(ps -eL -o pid,tid,pcpu,rss,args --no-headers 2>/dev/null | awk '/-contentproc/ { print $0 }'); then
        log_msg "CRITICAL: Failed to execute ps command. Check system permissions." "$RED"
        return
    fi

    # Simulation for self-test
    if [[ "$SELF_TEST_MODE" == "true" && -z "$ps_output" ]]; then
        printf "${YELLOW}SELF-TEST: Simulating heavy Firefox thread...${NC}\n"
        ps_output="9999 9999 15.5 524288 /usr/lib/firefox/firefox -contentproc"
    fi

    if [[ -n "$ps_output" ]]; then
        local use_sudo="false"
        has_sudo && use_sudo="true"

        # One awk call per thread handles all float ops + tier classification.
        # Eliminates bc pipe and 3 separate awk forks — ~75% fewer subprocess spawns per cycle.
        local total_cpu_x10=0   # cpu*10 accumulated as integer; divided at METRICS line
        local total_mem=0
        local active_threads=0

        while read -r pid tid cpu rss args; do
            if [[ ! "$pid" =~ ^[0-9]+$ || ! "$tid" =~ ^[0-9]+$ ]]; then
                continue
            fi

            # Single awk: round cpu, convert mem, classify tier (replaces 3 awk + 1 bc per thread)
            local cpu_val cpu_x10 mem_mb tier
            read -r cpu_val cpu_x10 mem_mb tier <<< "$(awk \
                -v cpu="$cpu" -v rss="$rss" \
                -v min="$MIN_CPU" -v opt="$OPTIMIZE_THRESHOLD" -v sev="$SEVERE_THRESHOLD" \
                'BEGIN {
                    cv = int(cpu + 0.5)
                    cx = int(cpu * 10 + 0.5)
                    mm = int(rss / 1024)
                    if      (cpu >= sev) t = "SEVERE"
                    else if (cpu >= opt) t = "MODERATE"
                    else if (cpu >= min) t = "ACTIVE"
                    else                 t = "SKIP"
                    print cv, cx, mm, t
                }')"

            (( ++active_threads ))
            total_cpu_x10=$(( total_cpu_x10 + cpu_x10 ))
            total_mem=$(( total_mem + mem_mb ))

            local status="Active" color="$GREEN"

            if [[ "$tier" == "MODERATE" || "$tier" == "SEVERE" ]]; then
                if [[ "$DRY_RUN" == "true" ]]; then
                    status="DRY-RUN (Skip Opt)"
                    color="$YELLOW"
                else
                    local prefix=""
                    if [[ "$EUID" -ne 0 ]]; then
                        [[ "$use_sudo" == "true" ]] && prefix="sudo "
                    fi

                    # Tiered throttling: severe (>= SEVERE_THRESHOLD) vs moderate (>= OPTIMIZE_THRESHOLD)
                    # Severe:   renice +19 (absolute minimum) + ionice -c 3 (idle I/O)
                    # Moderate: renice +RENICE_VAL + ionice -c 2 -n 7
                    local nice_val i_class i_prio tier_label err_msg
                    if [[ "$tier" == "SEVERE" ]]; then
                        nice_val="$SEVERE_RENICE_VAL"
                        i_class=3; i_prio=0
                        tier_label="THROTTLED"
                    else
                        nice_val="$RENICE_VAL"
                        i_class="$IONICE_CLASS"; i_prio="$IONICE_PRIO"
                        tier_label="OPTIMIZED"
                    fi

                    if err_msg=$( { $prefix renice -n "$nice_val" -p "$tid" && \
                                   $prefix ionice -c "$i_class" -n "$i_prio" -p "$tid"; } 2>&1 ); then
                        status="$tier_label"
                        color="$RED"
                        (( ++opt_count ))
                        forensic_audit "$tid" "$pid"
                    else
                        local clean_err
                        clean_err=$(echo "$err_msg" | head -n1 | sed 's/renice: //; s/ionice: //')
                        status="HIGH (Err: ${clean_err})"
                        color="$YELLOW"
                    fi
                fi
            fi

            if [[ "$tier" != "SKIP" ]]; then
                printf "${color}PID %-5s TID %-5s | CPU %5s%% | MEM %5d MB | %s${NC}\n" \
                    "$pid" "$tid" "$cpu" "$mem_mb" "$status" | \
                    tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
            fi
        done <<< "$ps_output"

        # Convert accumulated integer back to float for METRICS line
        local total_cpu
        total_cpu=$(awk -v x="$total_cpu_x10" 'BEGIN { printf "%.1f", x / 10 }')

        # Structured Metrics for Backend Parsing
        # Format: METRICS | Active: [N] | Optimized: [N] | TotalCPU: [N] | TotalMem: [N]
        printf "METRICS | Active: %d | Optimized: %d | TotalCPU: %.1f | TotalMem: %d MB\n" \
            "$active_threads" "$opt_count" "$total_cpu" "$total_mem" | tee -a "$OUTPUT_FILE" > /dev/null
    else
        printf "${YELLOW}Waiting for Firefox content processes... (None active currently)${NC}\n"
        # Always write a METRICS line so the dashboard stays live with zeroed values
        printf "METRICS | Active: 0 | Optimized: 0 | TotalCPU: 0.0 | TotalMem: 0 MB\n" >> "$OUTPUT_FILE"
    fi

    if [[ $opt_count -gt 0 ]]; then
        log_msg "Cycle complete: Optimized $opt_count heavy thread(s)." "$YELLOW"
    fi
}

# -----------------------------
# SELF-TEST SUITE
# -----------------------------
run_self_test() {
    printf "${BLUE}Starting Internal Self-Test Suite...${NC}\n"
    
    # 1. Test Dependency Check
    printf "Testing check_dependencies... "
    check_dependencies
    printf "${GREEN}PASS${NC}\n"

    # 2. Test Logging
    printf "Testing log_msg... "
    local test_msg="Self-test log message"
    log_msg "$test_msg"
    grep -q "$test_msg" "$OUTPUT_FILE"
    printf "${GREEN}PASS${NC}\n"

    # 3. Test Process Cycle (Simulation)
    printf "Testing process_cycle (Simulation)... "
    SELF_TEST_MODE=true
    DRY_RUN=true
    process_cycle > /dev/null
    printf "${GREEN}PASS${NC}\n"

    printf "${GREEN}All self-tests passed successfully.${NC}\n"
    exit 0
}

# -----------------------------
# MAIN LOOP
# -----------------------------
# Parse arguments
for arg in "$@"; do
    case $arg in
        --test)
            printf "${GREEN}Running in TEST mode (Dry Run)...${NC}\n"
            DRY_RUN=true
            ;;
        --self-test)
            run_self_test
            ;;
    esac
done

# Lockfile check
if [[ -f "$LOCK_FILE" ]]; then
    PID=$(cat "$LOCK_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        printf "${RED}ERROR: Optimizer is already running (PID: %s). Exiting.${NC}\n" "$PID"
        exit 1
    fi
fi
echo "$$" > "$LOCK_FILE"

# Ensure the lockfile is removed on exit
trap 'cleanup' EXIT SIGINT SIGTERM

# Initialize
check_dependencies
init_sudo

log_msg "Starting Firefox Content Optimizer (Best Practices Mode)" "$BLUE"
[[ "$DRY_RUN" == "true" ]] && printf "${YELLOW}WARNING: DRY_RUN enabled. No optimizations will be applied.${NC}\n"

# Ensure log file exists
touch "$OUTPUT_FILE"

# Main loop
cycle=0
while true; do
    (( ++cycle ))
    process_cycle
    
    # Backup logs every 100 cycles
    if (( cycle % 100 == 0 )); then
        backup_logs
    fi
    
    sleep "$MONITOR_INTERVAL"
done
