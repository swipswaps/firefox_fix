#!/usr/bin/env bash
# firefox_content_opt_v2.sh
# PRF-compliant: Automatically captures Firefox threads, filters active ones (>0.0% CPU),
# preserves timestamps, prints to terminal, and applies renice/ionice optimizations.

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

# -----------------------------
# FUNCTIONS
# -----------------------------

log_msg() {
    local msg="$1"
    echo "$(date '+%F %T') | $msg" | tee -a "$OUTPUT_FILE"
}

# Fetch and optimize active threads
process_cycle() {
    local ts load mem_info
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    load=$(uptime | awk -F'load average:' '{ print $2 }' | sed 's/^ //')
    mem_info=$(free -m | awk '/Mem:/ { printf "Used: %dMB / Total: %dMB (%.1f%%)", $3, $2, $3*100/$2 }')

    echo "----------------------------------------------------------------" | tee -a "$OUTPUT_FILE"
    echo "$TIMESTAMP_PREFIX $ts" | tee -a "$OUTPUT_FILE"
    echo "TROUBLESHOOTING: Load Avg: $load | Mem: $mem_info" | tee -a "$OUTPUT_FILE"
    echo "----------------------------------------------------------------" | tee -a "$OUTPUT_FILE"

    # Use ps -eL to get all threads. 
    # We grep for "-contentproc" to target only Firefox content processes specifically.
    
    ps -eL -o pid,tid,pcpu,rss,args --no-headers | grep "\-contentproc" | awk -v min_cpu="$MIN_CPU" -v renice_v="$RENICE_VAL" -v ionice_c="$IONICE_CLASS" -v ionice_p="$IONICE_PRIO" '
    {
        pid = $1
        tid = $2
        cpu = $3
        rss = $4
        
        # Convert CPU to numeric for comparison
        cpu_val = cpu + 0
        
        if (cpu_val >= min_cpu) {
            mem_mb = int(rss / 1024)
            printf "PID %s TID %s | CPU %s%% | MEM %d MB | Active Content Thread\n", pid, tid, cpu, mem_mb
            
            # Only optimize if CPU is significantly high (e.g. > 5%)
            if (cpu_val > 5.0) {
                system("renice -n " renice_v " -p " tid " >/dev/null 2>&1")
                system("ionice -c " ionice_c " -n " ionice_p " -p " tid " >/dev/null 2>&1")
            }
        }
    }
    ' | tee -a "$OUTPUT_FILE"
}

# -----------------------------
# MAIN LOOP
# -----------------------------
log_msg "Starting Firefox Content Optimizer v2 (Evidence & Optimization Mode)"
log_msg "Monitoring CPU > $MIN_CPU% | Optimizing CPU > 5.0%"

# Ensure output file exists
touch "$OUTPUT_FILE"

while true; do
    # Clear screen for live TUI feel (optional, but requested "display")
    # printf "\033[H\033[J" 
    
    process_cycle
    
    sleep "$MONITOR_INTERVAL"
done
