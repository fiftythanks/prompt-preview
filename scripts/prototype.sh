#!/usr/bin/env bash
# THROWAWAY prototype: use the existing installed omp SDK, never replace global extensions.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI=$(realpath "$(command -v omp)")
MODULES=$(dirname "$(dirname "$(dirname "$(dirname "$CLI")")")")
if [ ! -e "$ROOT/node_modules" ]; then
  test -d "$MODULES/@oh-my-pi/pi-ai"
  ln -s "$MODULES" "$ROOT/node_modules"
fi
cd "$ROOT"
exec omp --session-dir "$ROOT/.prototype-sessions" --no-extensions -e "$ROOT/src/index.ts" "$@"
