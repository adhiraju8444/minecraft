#!/bin/sh
# Blockforge: start the game server and put it online with a free public link.
# Double-click this file in Finder (the first time: right-click it and choose Open).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to run the server."
  echo "Install the LTS version from https://nodejs.org and then open this file again."
  open https://nodejs.org 2>/dev/null
  printf "Press Enter to close. "; read -r _
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Installing the server (one time only)..."
  npm install --omit=dev || { printf "Press Enter to close. "; read -r _; exit 1; }
fi
node server/online.js
