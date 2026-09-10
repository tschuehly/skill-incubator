#!/usr/bin/env bash
# Poller launcher for the pi-workbench-grill Atelier surface (distinct poller identity).
# exec-chains so exactly one long-lived process carries this identity.
cd "$(dirname "$0")/.." || exit 1
PORT=4747 exec bash .review/pi-workbench-grill/poll.sh --stream
