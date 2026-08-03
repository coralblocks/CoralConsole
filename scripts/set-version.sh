#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

fail() {
  echo "$1" >&2
  exit 1
}

usage() {
  echo "Usage: ./scripts/set-version.sh [A.B.C]"
  echo "Omit A.B.C to choose an interactive patch, minor, major, or custom version."
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac
if [ "$#" -gt 1 ]; then
  usage >&2
  fail "Pass at most one version argument."
fi

if ! command -v git >/dev/null 2>&1; then
  fail "Git is not installed."
fi
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed."
fi
if [ "$(git branch --show-current)" != "main" ]; then
  fail "Version releases must be prepared from the main branch."
fi
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  fail "The worktree has pending modifications. Commit, remove, or stash them before setting a version."
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  fail "The Git remote 'origin' is not configured."
fi

echo "Checking that main is synchronized with origin/main..."
if ! git fetch origin main; then
  fail "Could not fetch origin/main. No version files were changed."
fi
local_commit=$(git rev-parse HEAD)
if ! remote_commit=$(git rev-parse --verify refs/remotes/origin/main); then
  fail "Could not resolve origin/main after fetching it. No version files were changed."
fi
if [ "$local_commit" != "$remote_commit" ]; then
  fail "Local main must exactly match origin/main. Push, pull, or reconcile pending commits before setting a version."
fi

if ! selected_version=$(node scripts/set-version.mjs --select-only "$@"); then
  exit 1
fi
tag_name="v$selected_version"

if git show-ref --verify --quiet "refs/tags/$tag_name"; then
  fail "Tag $tag_name already exists locally."
fi
if ! remote_tag=$(git ls-remote --tags origin "refs/tags/$tag_name"); then
  fail "Could not check whether tag $tag_name already exists on origin."
fi
if [ -n "$remote_tag" ]; then
  fail "Tag $tag_name already exists on origin."
fi

node scripts/set-version.mjs "$selected_version"

changed_files=$(git status --short --untracked-files=all)
expected_changes=' M package-lock.json
 M package.json'
if [ "$changed_files" != "$expected_changes" ]; then
  fail "Version selection changed unexpected files; review the worktree before continuing."
fi

git add package.json package-lock.json
git commit -m "Set version $selected_version"
git tag -a "$tag_name" -m "CoralConsole $selected_version"

echo "Pushing main and $tag_name to origin atomically..."
if ! git push --atomic origin main "$tag_name"; then
  echo "The atomic push failed; no partial ref update was sent to origin." >&2
  echo "The version commit and tag remain local for inspection or a manual retry." >&2
  exit 1
fi

echo "CoralConsole $selected_version committed, tagged as $tag_name, and pushed to origin."
