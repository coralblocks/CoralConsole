#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is not installed." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This script must be run from the CoralConsole Git repository." >&2
  exit 1
fi

source_branch=$(git branch --show-current)

if [ -z "$source_branch" ]; then
  echo "The repository is in detached HEAD state. Switch to the branch you want to merge first." >&2
  exit 1
fi

if [ "$source_branch" = "main" ]; then
  echo "You are already on main. Switch to the feature branch you want to merge first." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "The working tree is not clean. Commit, stash, or remove pending changes before merging." >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "The Git remote named 'origin' is not configured." >&2
  exit 1
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  echo "A local main branch does not exist. Create or check out main before using this script." >&2
  exit 1
fi

echo "Source branch: $source_branch"
echo "Target branch: main"
echo "Remote target: origin/main"
printf "Merge this branch into main and push it? [y/N] "
IFS= read -r confirmation

case "$confirmation" in
  y|Y|yes|YES)
    ;;
  *)
    echo "Merge cancelled. No branches were changed."
    exit 0
    ;;
esac

git fetch origin main

if ! git show-ref --verify --quiet refs/remotes/origin/main; then
  echo "The remote branch origin/main was not found." >&2
  exit 1
fi

if ! git merge-base --is-ancestor main origin/main; then
  echo "Local main contains commits that are not on origin/main." >&2
  echo "Review and reconcile main manually before running this script again." >&2
  exit 1
fi

git switch main
git merge --ff-only origin/main

if ! git merge --no-ff --no-edit "$source_branch"; then
  echo "The merge did not complete. Resolve the conflicts and commit, or run 'git merge --abort'." >&2
  exit 1
fi

if ! git push origin main; then
  echo "The merge completed locally, but the push failed. Review main and retry the push manually." >&2
  exit 1
fi

echo "Merged $source_branch into main and pushed origin/main."
echo "The repository is now on the main branch."
