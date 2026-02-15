#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <max_attempts> <sleep_seconds> <command> [args...]"
  exit 2
fi

max_attempts="$1"
sleep_seconds="$2"
shift 2

attempt=1
while true; do
  echo "::group::Attempt ${attempt}/${max_attempts}: $*"
  if "$@"; then
    echo "::endgroup::"
    exit 0
  fi
  exit_code="$?"
  echo "::endgroup::"

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Command failed after ${max_attempts} attempts (exit ${exit_code}): $*"
    exit "$exit_code"
  fi

  echo "Attempt ${attempt} failed (exit ${exit_code}). Retrying in ${sleep_seconds}s..."
  sleep "$sleep_seconds"
  attempt=$((attempt + 1))
done
