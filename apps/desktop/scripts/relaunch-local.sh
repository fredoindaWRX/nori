#!/bin/zsh
# Relaunch the local N.O.R.I. (bridge + face) with the same env it was started
# with: workspace mode, writes on, and the Fish Audio key lifted off the
# running process so it never has to be typed. Local convenience only.
set -u
DIR=/Users/user/Desktop/Development-Charlie-2/Charlieautomates/apps/nori
cd "$DIR"
B=$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null | head -1)
FISH=""
if [ -n "$B" ]; then
  FISH=$(ps eww -o command -p "$B" | grep -o "FISH_AUDIO_API_KEY=[^ ]*" | head -1)
  P=$(ps -o ppid= -p "$B" | tr -d ' ')
  kill $P $B $(lsof -tiTCP:5173 -sTCP:LISTEN 2>/dev/null) 2>/dev/null
  sleep 2
fi
: > nori-run.log
if [ -n "$FISH" ]; then
  env NORI_WORKSPACE=/Users/user/Desktop/Development-Charlie-2/Charlieautomates NORI_MODEL=claude-sonnet-5 NORI_EFFORT=low "$FISH" nohup node scripts/start.mjs --writes >> nori-run.log 2>&1 &
else
  env NORI_WORKSPACE=/Users/user/Desktop/Development-Charlie-2/Charlieautomates NORI_MODEL=claude-sonnet-5 NORI_EFFORT=low nohup node scripts/start.mjs --writes >> nori-run.log 2>&1 &
fi
sleep 8
curl -s http://localhost:8787/health; echo
