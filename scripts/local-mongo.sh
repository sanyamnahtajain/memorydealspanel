#!/usr/bin/env bash
# Project-local MongoDB replica set for development.
# Runs a separate mongod on port 27018 with data in .localdb/ —
# does not touch the system/Homebrew MongoDB service on 27017.
#
# Usage:
#   ./scripts/local-mongo.sh start
#   ./scripts/local-mongo.sh stop
#   ./scripts/local-mongo.sh status
set -euo pipefail

PORT=27018
REPLSET=rs0local
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DBPATH="$DIR/.localdb"
LOGPATH="$DBPATH/mongod.log"
PIDFILE="$DBPATH/mongod.pid"
MONGOD="${MONGOD_BIN:-/opt/homebrew/bin/mongod}"
MONGOSH="${MONGOSH_BIN:-/opt/homebrew/bin/mongosh}"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running (pid $(cat "$PIDFILE")) on port $PORT"
    exit 0
  fi
  mkdir -p "$DBPATH"
  "$MONGOD" --port "$PORT" --dbpath "$DBPATH" --replSet "$REPLSET" \
    --bind_ip 127.0.0.1 --fork --logpath "$LOGPATH" --pidfilepath "$PIDFILE" >/dev/null
  # initiate replica set (idempotent — errors if already initiated, which is fine)
  "$MONGOSH" --quiet --port "$PORT" --eval "
    try { rs.status() } catch (e) {
      rs.initiate({_id: '$REPLSET', members: [{_id: 0, host: '127.0.0.1:$PORT'}]})
    }" >/dev/null
  # wait for PRIMARY
  for i in $(seq 1 30); do
    STATE=$("$MONGOSH" --quiet --port "$PORT" --eval "try { rs.isMaster().ismaster } catch(e) { false }")
    [ "$STATE" = "true" ] && break
    sleep 0.5
  done
  echo "mongod running on 127.0.0.1:$PORT (replica set $REPLSET, data in .localdb/)"
  echo "DATABASE_URL=\"mongodb://127.0.0.1:$PORT/memorydeals?replicaSet=$REPLSET&directConnection=true\""
}

stop() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && echo "stopped"
  else
    echo "not running"
  fi
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running (pid $(cat "$PIDFILE")) on port $PORT"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|status}"; exit 1 ;;
esac
