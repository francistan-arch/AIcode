#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=================================================="
echo "🚀 Starting 2C2P PACO Demo (AirAsia Rewards)"
echo "=================================================="

# Check dependencies
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Clean up any previous instance on port 3000
echo "🧹 Checking port 3000..."
PID=$(lsof -ti :3000 || true)
if [ -n "$PID" ]; then
  echo "Stopping existing process on port 3000 (PID: $PID)..."
  kill -9 $PID 2>/dev/null || true
  sleep 1
fi

echo "✨ Starting Node.js PACO Server..."
npm start
