#!/bin/bash
# Double-click to start Card Research Bot on a Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org (the .pkg installer), then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close…"
  exit 1
fi

MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) is too old — install the LTS version from https://nodejs.org"
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing (about a minute)…"
  npm install --no-fund --no-audit || { read -r -p "Install failed. Press Enter to close…"; exit 1; }
fi

npm start
