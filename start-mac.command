#!/bin/bash
# Double-click to start Card Research Bot on a Mac.
# The download from GitHub Releases carries its own Node.js (Apple Silicon + Intel) in ./runtime,
# so nothing needs installing.
cd "$(dirname "$0")" || exit 1

# Files downloaded from the internet are "quarantined" by macOS; clear that for this folder only,
# so the bundled Node.js can start without extra security prompts.
xattr -dr com.apple.quarantine . 2>/dev/null

case "$(uname -m)" in
  arm64) NODE="./runtime/darwin-arm64/node" ;;
  *)     NODE="./runtime/darwin-x64/node" ;;
esac

if [ ! -x "$NODE" ]; then
  # No bundled runtime (e.g. a git clone): use an installed Node.js.
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Download the Mac release from GitHub (it includes everything),"
    echo "or install the LTS version from https://nodejs.org (the .pkg installer) and double-click this file again."
    open "https://nodejs.org/en/download"
    read -r -p "Press Enter to close…"
    exit 1
  fi
  NODE="node"
  MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
  if [ "$MAJOR" -lt 20 ]; then
    echo "Node.js $("$NODE" -v) is too old — install the LTS version from https://nodejs.org"
    open "https://nodejs.org/en/download"
    read -r -p "Press Enter to close…"
    exit 1
  fi
fi

if [ ! -d node_modules ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "This folder is missing its node_modules. Download the Mac release zip from GitHub Releases."
    read -r -p "Press Enter to close…"
    exit 1
  fi
  echo "First run: installing (about a minute)…"
  npm install --no-fund --no-audit --omit=dev || { read -r -p "Install failed. Press Enter to close…"; exit 1; }
fi

"$NODE" server.js
echo
read -r -p "The bot has stopped. Press Enter to close…"
