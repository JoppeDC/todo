#!/usr/bin/env bash
# Local runner for the ac-check agents against the repo in the current directory.
#
# Usage: run-local.sh [BASE_REF] [TICKET]
#   BASE_REF  diff base, e.g. origin/CLEARFACTS-9413 (default: origin/main)
#   TICKET    Jira key, e.g. CLEARFACTS-13165 (default: extracted from the
#             current branch name, same as CI)
#
# Requires JIRA_API_TOKEN in the environment and an authenticated copilot CLI.
# Writes ticket.md, diff.patch, files.txt, the agent analyses, the finalize
# response, ac-report.md, and ac-dropped.md into the current directory for
# inspection.
set -euo pipefail

BASE=${1:-origin/main}
branch=$(git rev-parse --abbrev-ref HEAD)
TICKET=${2:-$(printf '%s' "$branch" | tr '[:lower:]' '[:upper:]' | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1 || true)}
if [ -z "$TICKET" ]; then
  echo "No Jira ticket key found in branch name '$branch'; pass it explicitly: run-local.sh $BASE CLEARFACTS-123" >&2
  exit 1
fi
echo "Ticket $TICKET, diffing against $BASE" >&2

JIRA_BASE_URL=${JIRA_BASE_URL:-https://clearfacts.atlassian.net}
JIRA_EMAIL=${JIRA_EMAIL:-joppe.de-cuyper@wolterskluwer.com}
: "${JIRA_API_TOKEN:?JIRA_API_TOKEN must be set}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
agents_dir=$(cd "$script_dir/../agents" && pwd)

# --agent is name-based and only searches ./.github/agents and
# ~/.copilot/agents; the repo under test has no project-level copy, so keep
# user-level symlinks pointing at this repo's agent definitions. The finalize
# definition is a generated copy because the review rules are appended to it,
# exactly as CI's finalize step does.
mkdir -p ~/.copilot/agents
ln -sf "$agents_dir/ac-review.agent.md" ~/.copilot/agents/ac-review.agent.md
ln -sf "$agents_dir/bug-hunt.agent.md" ~/.copilot/agents/bug-hunt.agent.md
rm -f ~/.copilot/agents/finalize.agent.md
{
  cat "$agents_dir/finalize.agent.md"
  echo
  cat "$script_dir/rules.md"
} > ~/.copilot/agents/finalize.agent.md

status=$(curl -sS -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -o ticket.json -w "%{http_code}" \
  "$JIRA_BASE_URL/rest/api/2/issue/$TICKET?fields=summary,description,customfield_10038")
if [ "$status" != "200" ]; then
  echo "JIRA returned HTTP $status for $TICKET" >&2
  exit 1
fi
jq -r '"# \(.key) — \(.fields.summary)\n\n## Description\n\n\(.fields.description // "_empty_")\n\n## Technical Analysis\n\n\(.fields.customfield_10038 // "_empty_")"' \
  ticket.json > ticket.md
rm -f ticket.json

git fetch origin "${BASE#origin/}"
git diff "$BASE...HEAD" > diff.patch
git diff --name-status "$BASE...HEAD" > files.txt
if [ ! -s diff.patch ]; then
  echo "No diff against $BASE" >&2
  exit 1
fi

run_agent() {
  local agent=$1 prompt=$2 out=$3 log=$4
  echo "Running $agent..." >&2
  GITHUB_TOKEN=$(gh auth token) COPILOT_GITHUB_TOKEN=$(gh auth token) \
  copilot --agent "$agent" -p "$prompt" -s \
    --available-tools='view,grep,glob' --disable-builtin-mcps --no-ask-user \
    --no-auto-update --no-custom-instructions --no-remote --no-remote-export \
    > "$out" 2> "$log"
}

validate() {
  node "$script_dir/validate-report.mjs" finalize-response.txt ac-report.md files.txt "$script_dir/rules.md" ac-dropped.md
}

finalize_prompt="Verify the analyses in the current working directory and produce the final report for the PR."

run_agent ac-review "Run your acceptance-criteria analysis on the PR in the current working directory." ac-analysis.md ac-output.log
run_agent bug-hunt "Run your bug hunt on the PR in the current working directory." bugs-analysis.md bugs-output.log

run_agent finalize "$finalize_prompt" finalize-response.txt finalize-output.log
if ! validate; then
  echo "finalize response failed validation; retrying once" >&2
  run_agent finalize "$finalize_prompt" finalize-response.txt finalize-output.log
  validate
fi

cat ac-report.md
cat ac-dropped.md
