#!/usr/bin/env bash
#
# kill-dev-server.sh
#
# Stops all running ioBroker dev-server processes for this adapter:
#   - the dev-server / js-controller process
#   - any adapter child processes (io.admin.0, io.sehybrid.0, ...)
#
# Tries a graceful SIGTERM first, then force-kills anything that survives
# (adapters get re-parented when the controller dies and can outlive it).
#
# Usage:
#   ./scripts/kill-dev-server.sh          # kill dev-server processes
#   ./scripts/kill-dev-server.sh -n       # dry run, just list what would be killed
#   ./scripts/kill-dev-server.sh -h       # help

set -euo pipefail

DRY_RUN=0

usage() {
    grep '^#' "$0" | sed 's/^#\s\{0,1\}//'
    exit 0
}

while getopts ":nh" opt; do
    case "$opt" in
        n) DRY_RUN=1 ;;
        h) usage ;;
        *) echo "Unknown option: -$OPTARG" >&2; exit 1 ;;
    esac
done

# Patterns that identify dev-server related processes.
# -f matches against the full command line.
#
# Note: patterns are intentionally specific so this script does not match
# itself or the npm/sh wrapper that launched it (e.g. "npm run dev-server:kill").
PATTERNS=(
    "@iobroker/dev-server"      # the dev-server CLI itself
    "iobroker\.js-controller"   # controller started by dev-server
    "io\.[a-z0-9_-]+\.[0-9]+"   # adapter instance processes, e.g. io.admin.0
)

# Build the set of PIDs to always exclude: this script, its parent shell,
# and the npm/node wrapper above it (walk the ppid chain to PID 1).
build_exclude() {
    local pid=$$
    local excl=""
    while [ "$pid" -gt 1 ]; do
        excl+=" $pid"
        pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
        [ -z "$pid" ] && break
    done
    echo "$excl"
}

EXCLUDE="$(build_exclude)"

# Collect matching PIDs, excluding this script's own process chain.
find_pids() {
    local pids=""
    for pat in "${PATTERNS[@]}"; do
        pids+=" $(pgrep -f "$pat" 2>/dev/null || true)"
    done
    local excl_pat
    excl_pat="$(echo "$EXCLUDE" | tr ' ' '\n' | grep -E '^[0-9]+$' | paste -sd '|' -)"
    echo "$pids" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u \
        | { [ -n "$excl_pat" ] && grep -vxE "$excl_pat" || cat; } || true
}

show() {
    local pids="$1"
    echo "Matching dev-server processes:"
    # shellcheck disable=SC2086
    ps -o pid,ppid,cmd -p $pids 2>/dev/null || true
}

PIDS="$(find_pids | tr '\n' ' ' | sed 's/ *$//')"

if [ -z "$PIDS" ]; then
    echo "No running dev-server processes found."
    exit 0
fi

show "$PIDS"

if [ "$DRY_RUN" -eq 1 ]; then
    echo "(dry run) Nothing killed."
    exit 0
fi

# Graceful stop first.
echo "Sending SIGTERM..."
# shellcheck disable=SC2086
kill $PIDS 2>/dev/null || true
sleep 3

# Anything still alive gets force-killed.
REMAINING="$(find_pids | tr '\n' ' ' | sed 's/ *$//')"
if [ -n "$REMAINING" ]; then
    echo "Force killing survivors: $REMAINING"
    # shellcheck disable=SC2086
    kill -9 $REMAINING 2>/dev/null || true
    sleep 1
fi

# Final verification.
LEFT="$(find_pids | tr '\n' ' ' | sed 's/ *$//')"
if [ -n "$LEFT" ]; then
    echo "Warning: some processes could not be killed: $LEFT" >&2
    show "$LEFT"
    exit 1
fi

echo "All dev-server processes stopped."
