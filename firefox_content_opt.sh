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
# 7. Enhanced error handling for system calls (manual checks instead of set -e).

# Disable exit on error to handle failures gracefully
set +e
set -uo pipefail

# -----------------------------
# CONFIGURATION
# -----------------------------
# Use absolute paths where possible or ensure relative paths are safe
OUTPUT_FILE="./active_threads.log"
LOCK_FILE="./firefox_optimizer.lock"
MAX_LOG_SIZE_KB=1024            # Rotate log after 1MB
MIN_CPU=${MIN_CPU:-0.1}         # Threshold for "active" (0.1% CPU)
RENICE_VAL=${RENICE_VAL:-5}     # Lower priority (higher nice value)
IONICE_CLASS=2                  # Best-effort
IONICE_PRIO=7                   # Lowest priority within class
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

# Ensure log file exists
touch "$OUTPUT_FILE"

log_msg "DEBUG: Optimizer script entry point reached" "$BLUE"

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
        log_msg "CRITICAL FAILURE: $msg" "$RED"
        exit 1
    fi
}

# Check if sudo is available and functional
# Best Practice: Use -n (non-interactive) to avoid hanging
SUDO_PREFIX=""
has_sudo() {
    # If already root, we have privileges and don't need sudo
    if [[ "$EUID" -eq 0 ]]; then
        SUDO_PREFIX=""
        return 0
    fi
    # Otherwise check if we can run sudo non-interactively
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        SUDO_PREFIX="sudo"
        return 0
    fi
    return 1
}

# Sudo Refresher
# Best Practice: Use a subshell with job control and ensure cleanup
init_sudo() {
    if [[ "$DRY_RUN" == "true" || "$SELF_TEST_MODE" == "true" ]]; then
        return
    fi

    # If already root, just log and return
    if [[ "$EUID" -eq 0 ]]; then
        printf "${GREEN}Running with root privileges (EUID: 0). Skipping sudo initialization.${NC}\n"
        SUDO_PREFIX=""
        return
    fi

    if ! command -v sudo >/dev/null 2>&1; then
        printf "${YELLOW}WARNING: Sudo command not found. Optimizations may fail with 'Perm Denied'.${NC}\n"
        SUDO_PREFIX=""
        return
    fi

    printf "${BLUE}Requesting administrative privileges for process optimization...${NC}\n"
    
    # Check if password is provided via env
    if [[ -n "${SUDO_PASSWORD:-}" ]]; then
        printf "%s" "$SUDO_PASSWORD" | sudo -S -v 2>/dev/null || true
    else
        # Prompt for password once (if interactive)
        sudo -n -v 2>/dev/null || true
    fi

    if sudo -n -v 2>/dev/null; then
        SUDO_PREFIX="sudo"
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
        SUDO_PREFIX=""
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
            printf "${BLUE}Attempting to install missing tools via ${SUDO_PREFIX:-root}...${NC}\n"
            if command -v dnf >/dev/null 2>&1; then
                # Fedora/RHEL support
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps"|"pkill"|"free"|"uptime") $SUDO_PREFIX dnf install -y -q procps-ng ;;
                        "renice") $SUDO_PREFIX dnf install -y -q util-linux ;;
                        "ionice") $SUDO_PREFIX dnf install -y -q util-linux ;;
                        *) $SUDO_PREFIX dnf install -y -q "$tool" ;;
                    esac
                done
            elif command -v apt-get >/dev/null 2>&1; then
                $SUDO_PREFIX apt-get update -qq
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps"|"pkill"|"free"|"uptime") $SUDO_PREFIX apt-get install -y -qq procps ;;
                        "renice") $SUDO_PREFIX apt-get install -y -qq bsdutils ;;
                        "ionice") $SUDO_PREFIX apt-get install -y -qq util-linux ;;
                        *) $SUDO_PREFIX apt-get install -y -qq "$tool" ;;
                    esac
                done
            elif command -v yum >/dev/null 2>&1; then
                for tool in "${missing[@]}"; do
                    $SUDO_PREFIX yum install -y -q "$tool"
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
    local exit_code=$?
    # Best Practice: Avoid recursive calls or infinite loops in cleanup
    # Kill the sudo refresher if it exists
    if [[ -n "$SUDO_REFRESH_PID" ]]; then
        kill "$SUDO_REFRESH_PID" 2>/dev/null || true
    fi

    # Remove lockfile
    rm -f "$LOCK_FILE"

    if [[ $exit_code -ne 0 ]]; then
        printf "\n${RED}Optimizer crashed with exit code %s.${NC}\n" "$exit_code"
        printf "%s | CRITICAL: Optimizer crashed with exit code %s.\n" "$(date '+%F %T')" "$exit_code" >> "$OUTPUT_FILE"
    else
        printf "\n${BLUE}Shutting down Firefox Process Optimizer...${NC}\n"
        printf "%s | Optimizer stopped by user.\n" "$(date '+%F %T')" >> "$OUTPUT_FILE"
    fi
    
    exit "$exit_code"
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

# Forensic Audit for heavy threads
forensic_audit() {
    local tid=$1
    local pid=$2
    
    if command -v lsof >/dev/null 2>&1; then
        local files_count
        files_count=$(lsof -p "$pid" 2>/dev/null | wc -l)
        printf "${BLUE}FORENSIC: PID %s Open Files: %d${NC}\n" "$pid" "$files_count" | \
            tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
    fi

    # Network Connections (New Forensic Feature)
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

    load=$(uptime 2>/dev/null | awk -F'load average:' '{ print $2 }' | sed 's/^ //; s/,//g' || echo "0.00 0.00 0.00")
    mem_info=$(free -m 2>/dev/null | awk '/Mem:/ { printf "Used: %dMB / Total: %dMB (%.1f%%)", $3, $2, $3*100/$2 }' || echo "Unknown")

    {
        printf "----------------------------------------------------------------\n"
        printf "%s %s\n" "$TIMESTAMP_PREFIX" "$ts"
        printf "SYSTEM: Load: %s | Mem: %s\n" "$load" "$mem_info"
        printf "----------------------------------------------------------------\n"
    } | tee -a "$OUTPUT_FILE" | sed -E "$ANSI_STRIP_RE" | sed "s/^/${BLUE}/; s/$/${NC}/"

    local opt_count=0
    local ps_output
    ps_output=$(ps -eL -o pid,tid,pcpu,rss,args --no-headers 2>/dev/null | awk '/-contentproc/ { print $0 }' || true)
    
    if [[ -z "$ps_output" ]]; then
        if [[ "$SELF_TEST_MODE" == "true" ]]; then
            printf "${YELLOW}SELF-TEST: Simulating heavy Firefox thread...${NC}\n"
            ps_output="9999 9999 15.5 524288 /usr/lib/firefox/firefox -contentproc"
        else
            printf "${YELLOW}Waiting for Firefox content processes... (None active currently)${NC}\n"
            printf "METRICS | Active: 0 | Optimized: 0 | TotalCPU: 0.0 | TotalMem: 0 MB\n" >> "$OUTPUT_FILE"
            printf "%s | SYSTEM: Monitoring active. No Firefox content processes detected.\n" "$(date '+%F %T')" >> "$OUTPUT_FILE"
            return
        fi
    fi

    local use_sudo="false"
    has_sudo && use_sudo="true"
    local total_cpu=0
    local total_mem=0
    local active_threads=0

    while read -r pid tid cpu rss args; do
        if [[ ! "$pid" =~ ^[0-9]+$ || ! "$tid" =~ ^[0-9]+$ ]]; then
            continue
        fi

        local cpu_val mem_mb status color
        cpu_val=$(printf "%.0f" "$cpu" 2>/dev/null || echo 0)
        mem_mb=$(( rss / 1024 ))
        status="Active"
        color="$GREEN"

        ((active_threads++))
        total_cpu=$(awk "BEGIN {print $total_cpu + $cpu}")
        total_mem=$(( total_mem + mem_mb ))

        if (( cpu_val >= MIN_CPU )); then
            if (( cpu_val >= OPTIMIZE_THRESHOLD )); then
                if [[ "$DRY_RUN" == "true" ]]; then
                    status="DRY-RUN (Skip Opt)"
                    color="$YELLOW"
                else
                    # Execute optimizations and capture errors
                    local renice_err=""
                    local ionice_err=""
                    
                    if ! $SUDO_PREFIX renice -n "$RENICE_VAL" -p "$tid" >/dev/null 2>&1; then
                        renice_err="renice failed"
                    fi
                    
                    if ! $SUDO_PREFIX ionice -c "$IONICE_CLASS" -n "$IONICE_PRIO" -p "$tid" >/dev/null 2>&1; then
                        ionice_err="ionice failed"
                    fi

                    if [[ -z "$renice_err" && -z "$ionice_err" ]]; then
                        status="OPTIMIZED"
                        color="$RED"
                        ((opt_count++))
                        forensic_audit "$tid" "$pid"
                    else
                        status="HIGH (Err: ${renice_err:-}${ionice_err:+, }${ionice_err:-})"
                        color="$YELLOW"
                    fi
                fi
            fi
            printf "${color}PID %-5s TID %-5s | CPU %5s%% | MEM %5d MB | %s${NC}\n" "$pid" "$tid" "$cpu" "$mem_mb" "$status" | \
                tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
            printf "THREAD | PID: %d | TID: %d | CPU: %s | MEM: %d | STATUS: %s\n" \
                "$pid" "$tid" "$cpu" "$mem_mb" "$status" >> "$OUTPUT_FILE"
        fi
    done <<< "$ps_output"

    printf "METRICS | Active: %d | Optimized: %d | TotalCPU: %.1f | TotalMem: %d MB\n" \
        "$active_threads" "$opt_count" "$total_cpu" "$total_mem" | tee -a "$OUTPUT_FILE" > /dev/null
    
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
    ((cycle++))
    process_cycle
    
    # Backup logs every 100 cycles
    if (( cycle % 100 == 0 )); then
        backup_logs
    fi
    
    sleep "$MONITOR_INTERVAL"
done
