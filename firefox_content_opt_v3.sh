#!/usr/bin/env bash
# firefox_content_opt_v3.sh
# PRF-compliant: Automatically captures Firefox threads, filters active ones (>0.0% CPU),
# preserves timestamps, prints to terminal with color, and applies renice/ionice optimizations.

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

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# -----------------------------
# FUNCTIONS
# -----------------------------

# Check for required tools
check_dependencies() {
    local tools=("ps" "awk" "grep" "uptime" "free" "renice" "ionice")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            echo -e "${RED}ERROR: Required tool '$tool' not found.${NC}"
            exit 1
        fi
    done
}

log_msg() {
    local msg="$1"
    local color="${2:-$NC}"
    # Print to terminal with color
    echo -e "${color}$(date '+%F %T') | $msg${NC}"
    # Log to file without color
    echo "$(date '+%F %T') | $msg" >> "$OUTPUT_FILE"
}

cleanup() {
    echo -e "\n${BLUE}Shutting down Firefox Process Optimizer...${NC}"
    log_msg "Optimizer stopped by user."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Fetch and optimize active threads
process_cycle() {
    local ts load mem_info
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    load=$(uptime | awk -F'load average:' '{ print $2 }' | sed 's/^ //')
    mem_info=$(free -m | awk '/Mem:/ { printf "Used: %dMB / Total: %dMB (%.1f%%)", $3, $2, $3*100/$2 }')

    # Terminal header
    echo -e "${BLUE}----------------------------------------------------------------${NC}"
    echo -e "${YELLOW}$TIMESTAMP_PREFIX $ts${NC}"
    echo -e "${YELLOW}SYSTEM: Load: $load | Mem: $mem_info${NC}"
    echo -e "${BLUE}----------------------------------------------------------------${NC}"

    # File header
    echo "----------------------------------------------------------------" >> "$OUTPUT_FILE"
    echo "$TIMESTAMP_PREFIX $ts" >> "$OUTPUT_FILE"
    echo "SYSTEM: Load: $load | Mem: $mem_info" >> "$OUTPUT_FILE"
    echo "----------------------------------------------------------------" >> "$OUTPUT_FILE"

    # Use ps -eL to get all threads. 
    # We grep for "-contentproc" to target only Firefox content processes specifically.
    
    # We'll use a temporary file to capture awk output to avoid double-running ps or complex piping
    local opt_count=0
    
    # Run ps and process with awk
    # Awk will print the formatted line and return a special string if it optimized
    ps -eL -o pid,tid,pcpu,rss,args --no-headers | grep "\-contentproc" | awk -v min_cpu="$MIN_CPU" -v opt_cpu="$OPTIMIZE_THRESHOLD" -v renice_v="$RENICE_VAL" -v ionice_c="$IONICE_CLASS" -v ionice_p="$IONICE_PRIO" -v red="$RED" -v green="$GREEN" -v yellow="$YELLOW" -v nc="$NC" '
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
                # Attempt optimization
                cmd1 = "renice -n " renice_v " -p " tid " >/dev/null 2>&1"
                cmd2 = "ionice -c " ionice_c " -n " ionice_p " -p " tid " >/dev/null 2>&1"
                
                res1 = system(cmd1)
                res2 = system(cmd2)
                
                if (res1 == 0) {
                    status = "OPTIMIZED"
                    color = red
                    print "OPTIMIZE_EVENT" # Signal to bash
                } else {
                    status = "HIGH (Perm Denied)"
                    color = yellow
                }
            }
            
            # Print to stdout (which goes to terminal via while loop)
            printf "%sPID %s TID %s | CPU %s%% | MEM %d MB | %s%s\n", color, pid, tid, cpu, mem_mb, status, nc
        }
    }
    ' | while read -r line; do
        if [[ "$line" == "OPTIMIZE_EVENT" ]]; then
            ((opt_count++))
        else
            echo -e "$line"
            # Strip ANSI colors for the log file
            echo "$line" | sed 's/\x1b\[[0-9;]*m//g' >> "$OUTPUT_FILE"
        fi
    done

    if [[ $opt_count -gt 0 ]]; then
        log_msg "Cycle complete: Optimized $opt_count heavy thread(s)." "$YELLOW"
    fi
}

# -----------------------------
# MAIN LOOP
# -----------------------------
check_dependencies

# Clear terminal for fresh start
clear
log_msg "Starting Firefox Content Optimizer v3 (Efficacy & Color Mode)" "$BLUE"
log_msg "Monitoring CPU > $MIN_CPU% | Optimizing CPU > $OPTIMIZE_THRESHOLD%" "$BLUE"

# Ensure output file exists
touch "$OUTPUT_FILE"

while true; do
    process_cycle
    sleep "$MONITOR_INTERVAL"
done
