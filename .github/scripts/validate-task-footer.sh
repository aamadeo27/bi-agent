#!/usr/bin/env bash
# Committed CI copy of the Task/Notes footer validator (the canonical source lives
# in devteam's .claude/hooks, which is gitignored in targets — so CI uses this copy).
# Used by .github/workflows/validate-task-footer.yml on PRs into the integration branch.
# The local commit-msg git hook is a separate installed copy under .git/hooks/.
#
# Skips merge commits, fixup/squash WIPs, and non-merge feature-branch commits.
# Strict only when the commit/PR targets the integration branch.

set -u

msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
  # CI mode: read from HEAD
  msg="$(git log -1 --format=%B HEAD)"
else
  msg="$(cat "$msg_file")"
fi

# Skip WIP / fixup / merge commits.
first_line="$(printf '%s\n' "$msg" | head -1)"
case "$first_line" in
  "Merge "*|"fixup!"*|"squash!"*|"WIP"*|"wip"*) exit 0 ;;
esac

# Only enforce on the integration branch (or in CI when target ref is main).
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-main}"
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
target_branch="${GITHUB_BASE_REF:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-$current_branch}}"
if [ "$target_branch" != "$INTEGRATION_BRANCH" ]; then
  exit 0
fi

errors=0
# Task id is the task's T*.md stem, e.g. T1.2 (epic.task) or T01. NOT epic-prefixed
# or slashed (`005/T03`) — the post-merge hook resolves docs/epics/**/<id>.md by this id.
if ! printf '%s\n' "$msg" | grep -qE '^Task:[[:space:]]*T[0-9]+(\.[0-9]+)?[[:space:]]*$'; then
  printf 'Missing or malformed footer: "Task: <id>" — the task'\''s T*.md stem, e.g. T1.2 or T01 (no epic prefix or slash)\n' >&2
  errors=$((errors+1))
fi
if ! printf '%s\n' "$msg" | grep -qE '^Notes:[[:space:]]*.+'; then
  printf 'Missing footer: "Notes: <one line>"\n' >&2
  errors=$((errors+1))
fi

if [ "$errors" -gt 0 ]; then
  printf '\nSee .github/pull_request_template.md\n' >&2
  exit 1
fi
exit 0
