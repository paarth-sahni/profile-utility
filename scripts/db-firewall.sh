#!/usr/bin/env bash
# Purpose: block LAN access to the local Supabase stack (and any extra local database ports you name).
# Docker publishes ports on 0.0.0.0 and bypasses ufw; DOCKER-USER is the chain Docker leaves for
# user rules. Traffic arriving on the external NIC to these ports is dropped; localhost still works.
# Run with sudo. Rules are not persistent (re-run after reboot or Docker restart).
# Usage:  sudo ./scripts/db-firewall.sh [--remove] [EXTRA_PORT ...]
#   e.g.  sudo ./scripts/db-firewall.sh 5433 5435      # also protect two other local databases
#         sudo ./scripts/db-firewall.sh --remove 5433  # undo (pass the same extra ports)
# The network interface is auto-detected from the default route; override with IFACE=<name>.
set -euo pipefail

# Supabase: 54321 api, 54322 db, 54323 studio, 54324 mail (+ neighbouring local-stack ports).
PORTS=(54320 54321 54322 54323 54324 54329)
ACTION=-I; DONE=applied
if [[ "${1:-}" == "--remove" ]]; then
  ACTION=-D; DONE=removed
  shift
fi
for extra in "$@"; do
  [[ "$extra" =~ ^[0-9]+$ && "$extra" -ge 1 && "$extra" -le 65535 ]] || { echo "Invalid port: $extra" >&2; exit 1; }
  PORTS+=("$extra")
done
IFACE="${IFACE:-$(ip route show default | awk '/default/ {print $5; exit}')}"

for tool in iptables ip6tables; do
  for port in "${PORTS[@]}"; do
    rule=(DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j DROP)
    if [[ "$ACTION" == "-D" ]]; then "$tool" -D "${rule[@]}" 2>/dev/null || true
    elif ! "$tool" -C "${rule[@]}" 2>/dev/null; then "$tool" -I "${rule[@]}"; fi
  done
done
echo "Firewall rules $DONE on interface $IFACE for ports: ${PORTS[*]}"
