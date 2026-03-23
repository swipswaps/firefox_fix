#!/usr/bin/env bash
# firefox_content_opt.sh
# PRF-compliant: Automatically captures Firefox threads, filters active ones (>0.0% CPU),
# preserves timestamps, prints to terminal with color, and applies renice/ionice optimizations.
# Handles dependency management and uses tee for transparent live logging.
# Includes self-testing logic for every major code block.

set -euo pipefail

# -----------------------------
# CONFIGURATION
# -----------------------------
OUTPUT_FILE="./active_threads.log"
MIN_CPU=0.1                     # Threshold for "active" (0.1% CPU)
RENICE_VAL=5                    # Lower priority (higher nice value)
IONICE_CLASS=2                  # Best-effort
IONICE_PRIO=7                   # Lowest priority within class
MONITOR_INTERVAL=2              # Seconds between cycles
TIMESTAMP_PREFIX="Timestamp:"
OPTIMIZE_THRESHOLD=5.0          # CPU % to trigger renice/ionice
DRY_RUN=${DRY_RUN:-false}       # Set to true to skip actual renice/ionice
SELF_TEST_MODE=false            # Internal flag for self-test

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ANSI Strip Pattern
ANSI_STRIP="s/\x1b\[[0-9;]*m//g"

# -----------------------------
# FUNCTIONS
# -----------------------------

# Internal assertion helper
assert() {
    local condition=$1
    local msg=$2
    if ! eval "$condition"; then
        echo -e "${RED}ASSERTION FAILED: $msg${NC}"
        exit 1
    fi
}

# Check if sudo is available and functional
has_sudo() {
    command -v sudo &> /dev/null && sudo -n true &> /dev/null
}

# Dependency management: Check and install missing tools
check_dependencies() {
    local tools=("ps" "awk" "grep" "uptime" "free" "renice" "ionice" "sed" "tee")
    local missing=()

    # TEST: Verify tools list is not empty
    assert "[[ ${#tools[@]} -gt 0 ]]" "Tools list for dependency check is empty"

    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing+=("$tool")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Missing dependencies: ${missing[*]}${NC}"
        
        if has_sudo; then
            echo -e "${BLUE}Attempting to install missing tools via sudo...${NC}"
            if command -v apt-get &> /dev/null; then
                sudo apt-get update -qq
                for tool in "${missing[@]}"; do
                    case "$tool" in
                        "ps") sudo apt-get install -y -qq procps ;;
                        "renice") sudo apt-get install -y -qq bsdutils ;;
                        "ionice") sudo apt-get install -y -qq util-linux ;;
                        "free"|"uptime") sudo apt-get install -y -qq procps ;;
                        *) sudo apt-get install -y -qq "$tool" ;;
                    esac
                done
            elif command -v yum &> /dev/null; then
                for tool in "${missing[@]}"; do
                    sudo yum install -y -q "$tool"
                done
            fi
        else
            echo -e "${RED}ERROR: Missing tools and sudo not available. Please install manually: ${missing[*]}${NC}"
            exit 1
        fi
        
        # Re-verify
        for tool in "${missing[@]}"; do
            if ! command -v "$tool" &> /dev/null; then
                echo -e "${RED}ERROR: Failed to install '$tool'.${NC}"
                exit 1
            fi
        done
        echo -e "${GREEN}All dependencies installed successfully.${NC}"
    fi
}

log_msg() {
    local msg="$1"
    local color="${2:-$NC}"
    
    # TEST: Verify message is not empty
    [[ -z "$msg" ]] && return

    # Use tee for transparency
    echo -e "${color}$(date '+%F %T') | $msg${NC}" | sed "$ANSI_STRIP" >> "$OUTPUT_FILE"
    
    # TEST: Verify log file exists after writing
    assert "[[ -f '$OUTPUT_FILE' ]]" "Log file $OUTPUT_FILE was not created/updated"
}

cleanup() {
    echo -e "\n${BLUE}Shutting down Firefox Process Optimizer...${NC}"
    log_msg "Optimizer stopped by user."
    exit 0
}

trap cleanup SIGINT SIGTERM

process_cycle() {
    local ts load mem_info
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    
    # TEST: Verify date command worked
    assert "[[ -n '$ts' ]]" "Failed to generate timestamp"

    load=$(uptime | awk -F'load average:' '{ print $2 }' | sed 's/^ //')
    mem_info=$(free -m | awk '/Mem:/ { printf "Used: %dMB / Total: %dMB (%.1f%%)", $3, $2, $3*100/$2 }')

    # TEST: Verify system metrics are captured
    assert "[[ -n '$load' ]]" "Failed to capture system load"
    assert "[[ -n '$mem_info' ]]" "Failed to capture memory info"

    # Transparent live logging using tee
    {
        echo "----------------------------------------------------------------"
        echo "$TIMESTAMP_PREFIX $ts"
        echo "SYSTEM: Load: $load | Mem: $mem_info"
        echo "----------------------------------------------------------------"
    } | tee -a "$OUTPUT_FILE" | sed "s/^/${BLUE}/; s/$/${NC}/"

    local opt_count=0
    
    # Capture thread data
    local ps_output
    ps_output=$(ps -eL -o pid,tid,pcpu,rss,args --no-headers | grep "\-contentproc" || true)

    # TEST: If we are in self-test mode, we simulate a heavy process if none exist
    if [[ "$SELF_TEST_MODE" == "true" && -z "$ps_output" ]]; then
        echo -e "${YELLOW}SELF-TEST: Simulating heavy Firefox thread...${NC}"
        ps_output="9999 9999 15.5 524288 /usr/lib/firefox/firefox -contentproc"
    fi

    if [[ -n "$ps_output" ]]; then
        # Determine if we should use sudo for optimizations
        local use_sudo="false"
        has_sudo && use_sudo="true"

        echo "$ps_output" | awk -v dry="$DRY_RUN" -v sudo_v="$use_sudo" -v min_cpu="$MIN_CPU" -v opt_cpu="$OPTIMIZE_THRESHOLD" -v renice_v="$RENICE_VAL" -v ionice_c="$IONICE_CLASS" -v ionice_p="$IONICE_PRIO" -v red="$RED" -v green="$GREEN" -v yellow="$YELLOW" -v nc="$NC" '
        {
            pid = $1
            tid = $2
            cpu = $3
            rss = $4
            
            cpu_val = cpu + 0
            
            if (cpu_val >= min_cpu) {
                mem_mb = int(rss / 1024)
                status = "Active"
                color = green
                
                if (cpu_val >= opt_cpu) {
                    if (dry == "true") {
                        status = "DRY-RUN (Skip Opt)"
                        color = yellow
                    } else {
                        prefix = (sudo_v == "true") ? "sudo " : ""
                        cmd1 = prefix "renice -n " renice_v " -p " tid " >/dev/null 2>&1"
                        cmd2 = prefix "ionice -c " ionice_c " -n " ionice_p " -p " tid " >/dev/null 2>&1"
                        
                        res1 = system(cmd1)
                        res2 = system(cmd2)
                        
                        if (res1 == 0) {
                            status = "OPTIMIZED"
                            color = red
                            print "OPTIMIZE_EVENT"
                        } else {
                            status = "HIGH (Perm Denied)"
                            color = yellow
                        }
                    }
                }
                printf "%sPID %s TID %s | CPU %s%% | MEM %d MB | %s%s\n", color, pid, tid, cpu, mem_mb, status, nc
            }
        }
        ' | while read -r line; do
            if [[ "$line" == "OPTIMIZE_EVENT" ]]; then
                ((opt_count++))
            else
                echo -e "$line" | tee -a >(sed "$ANSI_STRIP" >> "$OUTPUT_FILE")
            fi
        done
    else
        echo -e "${YELLOW}No active Firefox content processes found.${NC}"
    fi

    if [[ $opt_count -gt 0 ]]; then
        log_msg "Cycle complete: Optimized $opt_count heavy thread(s)." "$YELLOW"
    fi
}

# -----------------------------
# SELF-TEST SUITE
# -----------------------------
run_self_test() {
    echo -e "${BLUE}Starting Internal Self-Test Suite...${NC}"
    
    # 1. Test Dependency Check
    echo -n "Testing check_dependencies... "
    check_dependencies
    echo -e "${GREEN}PASS${NC}"

    # 2. Test Logging
    echo -n "Testing log_msg... "
    local test_msg="Self-test log message"
    log_msg "$test_msg"
    grep -q "$test_msg" "$OUTPUT_FILE"
    echo -e "${GREEN}PASS${NC}"

    # 3. Test Process Cycle (Simulation)
    echo -n "Testing process_cycle (Simulation)... "
    SELF_TEST_MODE=true
    DRY_RUN=true
    process_cycle > /dev/null
    echo -e "${GREEN}PASS${NC}"

    echo -e "${GREEN}All self-tests passed successfully.${NC}"
    exit 0
}

# -----------------------------
# MAIN LOOP
# -----------------------------
# Parse arguments
for arg in "$@"; do
    case $arg in
        --test)
            echo -e "${GREEN}Running in TEST mode (Dry Run)...${NC}"
            DRY_RUN=true
            ;;
        --self-test)
            run_self_test
            ;;
    esac
done

check_dependencies

clear
log_msg "Starting Firefox Content Optimizer (Self-Testing Enabled)" "$BLUE"
[[ "$DRY_RUN" == "true" ]] && echo -e "${YELLOW}WARNING: DRY_RUN enabled. No optimizations will be applied.${NC}"

touch "$OUTPUT_FILE"

while true; do
    process_cycle
    sleep "$MONITOR_INTERVAL"
done
