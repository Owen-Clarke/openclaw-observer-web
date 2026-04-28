#!/bin/bash
# OpenClaw Observer Web - Quick server
# Usage: ./server.sh [port]
PORT=${1:-8080}
echo "OpenClaw Observer Web running at http://localhost:$PORT"
python3 -m http.server $PORT --bind 0.0.0.0
