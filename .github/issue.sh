#!/usr/bin/env bash
# Usage: issue.sh TITLE BODY_FILE
# Opens an issue assigned to the repo owner, or, if an open issue with exactly
# this title exists (an earlier check the same day), adds the body as a comment,
# so hourly checks don't open a new issue every hour.
set -euo pipefail
title="$1"; body="$2"
num=$(gh issue list --state open --search "in:title $title" --json number,title --limit 50 |
      T="$title" python3 -c 'import json,os,sys; print(next((str(i["number"]) for i in json.load(sys.stdin) if i["title"] == os.environ["T"]), ""))')
if [ -n "$num" ]; then
  gh issue comment "$num" --body-file "$body"
else
  gh issue create --title "$title" --body-file "$body" --assignee "$GITHUB_REPOSITORY_OWNER"
fi
