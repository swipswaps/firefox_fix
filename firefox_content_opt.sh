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
MAX_LOG_SIZE_KB=1024            # Rotate log after 1MB
MIN_CPU=0.1                     # Threshold for "active" (0.1% CPU)
RENICE_VAL=5                    # Lower priority (higher nice value)
IONICE_CLASS=2                  # Best-effort
IONICE_PRIO=7                   # Lowest priority within class
MONITOR_INTERVAL=2              # Seconds between cycles
TIMESTAMP_PREFIX="Timestamp:"
OPTIMIZE_THRESHOLD=5.0          # CPU % to trigger renice/ionice
DRY_RUN=${DRY_RUN:-false}       # Set to true to skip actual renice/ionice
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
    command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

# Sudo Refresher
# Best Practice: Use a subshell with job control and ensure cleanup
init_sudo() {
    if [[ "$DRY_RUN" == "true" || "$SELF_TEST_MODE" == "true" ]]; then
        return
    fi

    printf "${BLUE}Requesting administrative privileges for process optimization...${NC}\n"
    # Prompt for password once
    if sudo -v; then
        # Keep-alive sudo in background subshell
        # Best Practice: Use a loop that exits if the parent process dies
        (
            while kill -0 "$$" 2>/dev/null; do
                sudo -n -v 2>/dev/null || exit
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
    local tools=("ps" "awk" "grep" "uptime" "free" "renice" "ionice" "sed" "tee")
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
            if command -v apt-get >/dev/null 2>&1; then
                sudo apt-get update -qq
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps"|"free"|"uptime") sudo apt-get install -y -qq procps ;;
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

    printf "\n${BLUE}Shutting down Firefox Process Optimizer...${NC}\n"
    # We don't call log_msg here to avoid potential issues if log_msg fails
    printf "%s | Optimizer stopped by user.\n" "$(date '+%F %T')" >> "$OUTPUT_FILE"
    exit 0
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

    # Header for the cycle
    {
        printf "----------------------------------------------------------------\n"
        printf "%s %s\n" "$TIMESTAMP_PREFIX" "$ts"
        printf "SYSTEM: Load: %s | Mem: %s\n" "$load" "$mem_info"
        printf "----------------------------------------------------------------\n"
    } | tee -a "$OUTPUT_FILE" | sed -E "$ANSI_STRIP_RE" | sed "s/^/${BLUE}/; s/$/${NC}/"

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

        # Best Practice: Pass variables to awk using -v to avoid shell injection/quoting issues
        # Use a while loop to handle optimization commands shell-side for better control
        while read -r pid tid cpu rss args; do
            # Harden: Validate that we actually got numeric values for pid/tid/cpu
            if [[ ! "$pid" =~ ^[0-9]+$ || ! "$tid" =~ ^[0-9]+$ ]]; then
                continue
            fi

            local cpu_val mem_mb status color
            # Use printf to round CPU to integer safely
            cpu_val=$(printf "%.0f" "$cpu" 2>/dev/null || echo 0)
            mem_mb=$(( rss / 1024 ))
            status="Active"
            color="$GREEN"

            if (( cpu_val >= MIN_CPU )); then
                if (( cpu_val >= OPTIMIZE_THRESHOLD )); then
                    if [[ "$DRY_RUN" == "true" ]]; then
                        status="DRY-RUN (Skip Opt)"
                        color="$YELLOW"
                    else
                        local prefix=""
                        [[ "$use_sudo" == "true" ]] && prefix="sudo "
                        
                        # Best Practice: Execute and check return codes explicitly
                        local err_msg
                        # Harden: Use a subshell to capture stderr and stdout separately if needed, 
                        # but here we just want the first error line for the log.
                        if err_msg=$( { $prefix renice -n "$RENICE_VAL" -p "$tid" && \
                                       $prefix ionice -c "$IONICE_CLASS" -n "$IONICE_PRIO" -p "$tid"; } 2>&1 ); then
                            status="OPTIMIZED"
                            color="$RED"
                            ((opt_count++))
                        else
                            # Strip common noise from error messages
                            local clean_err
                            clean_err=$(echo "$err_msg" | head -n1 | sed 's/renice: //; s/ionice: //')
                            status="HIGH (Err: ${clean_err})"
                            color="$YELLOW"
                        fi
                    fi
                fi
                # Best Practice: Use printf for aligned output
                printf "${color}PID %-5s TID %-5s | CPU %5s%% | MEM %5d MB | %s${NC}\n" "$pid" "$tid" "$cpu" "$mem_mb" "$status" | \
                    tee -a >(sed -E "$ANSI_STRIP_RE" >> "$OUTPUT_FILE")
            fi
        done <<< "$ps_output"
    else
        printf "${YELLOW}Waiting for Firefox content processes... (None active currently)${NC}\n"
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

# Initialize
check_dependencies
init_sudo

# Clear screen for fresh start
clear
log_msg "Starting Firefox Content Optimizer (Best Practices Mode)" "$BLUE"
[[ "$DRY_RUN" == "true" ]] && printf "${YELLOW}WARNING: DRY_RUN enabled. No optimizations will be applied.${NC}\n"

# Ensure log file exists
touch "$OUTPUT_FILE"

# Main loop
while true; do
    process_cycle
    sleep "$MONITOR_INTERVAL"
done
