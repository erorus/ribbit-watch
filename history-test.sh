#!/bin/bash

cd current

# Number of commits back to start from (e.g., 10 for 10 commits back)
N="${1:-10}"

# Get the last N+1 commits (so index 0 is HEAD~N, last one is HEAD)
COMMITS=($(git rev-list --reverse --max-count=$((N+1)) HEAD))

# Make sure we got enough commits
if [ "${#COMMITS[@]}" -lt $((N+1)) ]; then
    echo "Repository has fewer than $((N+1)) commits."
    exit 1
fi

# On exit or interrupt, reset to latest commit
cleanup() {
    echo
    echo "Resetting to latest commit..."
    git checkout "${COMMITS[-1]}" >/dev/null
    echo "Now at latest commit."
    exit
}
trap cleanup INT

echo "Starting at commit: ${COMMITS[0]}"
git checkout "${COMMITS[0]}" >/dev/null

# Step forward through the commits
for (( i=1; i<N; i++ )); do
    echo
    echo "Press any key to advance to next commit ($((i+1)) of $N)..."
    read -n 1 -s
    git checkout "${COMMITS[$i]}" >/dev/null
    echo "Now at: $(git log --oneline -1)"
done

cleanup
