#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BRANCH="main"
AUTO_COMMIT="0"
COMMIT_MESSAGE=""

usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh
  ./deploy.sh --commit "your commit message"
  ./deploy.sh --branch main --commit "your commit message"

What it does:
  1) (optional) commits current changes
  2) pushes to origin/<branch>
  3) rebuilds and restarts backend/frontend/nginx with Docker Compose
EOF
}

log() {
  printf '[deploy] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      AUTO_COMMIT="1"
      COMMIT_MESSAGE="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd git
require_cmd docker

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'Not a git repository: %s\n' "$ROOT_DIR" >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "$CURRENT_BRANCH" ]]; then
  printf 'Could not detect current git branch.\n' >&2
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  printf 'Current branch is "%s", expected "%s".\n' "$CURRENT_BRANCH" "$BRANCH" >&2
  printf 'Switch branch or run with: --branch %s\n' "$CURRENT_BRANCH" >&2
  exit 1
fi

if [[ "$AUTO_COMMIT" == "1" ]]; then
  if [[ -z "$COMMIT_MESSAGE" ]]; then
    COMMIT_MESSAGE="chore: deploy $(date -u +'%Y-%m-%d %H:%M UTC')"
  fi

  log "Preparing commit"
  git add -A

  # Never commit local environment secrets by accident.
  if [[ -f ".env" ]]; then
    git reset -- .env >/dev/null 2>&1 || true
  fi

  if ! git diff --cached --quiet; then
    git commit -m "$COMMIT_MESSAGE"
    log "Committed: $COMMIT_MESSAGE"
  else
    log "No staged changes to commit"
  fi
fi

log "Pushing branch $BRANCH to origin"
git push origin "$BRANCH"

log "Deploying containers (backend, frontend, nginx)"
docker compose -f docker-compose.yml up -d --build backend frontend nginx

log "Current container status"
docker compose -f docker-compose.yml ps

log "Deployment finished"
