#!/usr/bin/env bash
# scripts/gen-dashboard-cert.sh
#
# Generate a long-lived self-signed cert for the dashboard's in-app HTTPS.
# Usage:
#   scripts/gen-dashboard-cert.sh [server-ip-or-hostname]
# Example:
#   scripts/gen-dashboard-cert.sh 192.168.1.10
#   scripts/gen-dashboard-cert.sh dashboard.local

set -euo pipefail

SAN_HOST="${1:-localhost}"
DEST_DIR="data/dashboard-tls"
KEY="${DEST_DIR}/key.pem"
CERT="${DEST_DIR}/cert.pem"

mkdir -p "${DEST_DIR}"

if [[ -f "${KEY}" || -f "${CERT}" ]]; then
  echo "Cert already exists at ${DEST_DIR}/. Refusing to overwrite."
  echo "Remove the files first if you want to regenerate."
  exit 1
fi

# Build subjectAltName: include the user-provided host as both DNS and IP if numeric.
SAN="DNS:localhost,IP:127.0.0.1"
if [[ "${SAN_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="${SAN},IP:${SAN_HOST}"
elif [[ "${SAN_HOST}" != "localhost" ]]; then
  SAN="${SAN},DNS:${SAN_HOST}"
fi

openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "${KEY}" \
  -out   "${CERT}" \
  -days  3650 \
  -subj  "/CN=pai-dashboard" \
  -addext "subjectAltName=${SAN}"

chmod 600 "${KEY}"
echo ""
echo "Cert generated:"
echo "  ${CERT}"
echo "  ${KEY}"
echo ""
echo "Add to your environment (.env or shell):"
echo "  DASHBOARD_TOKEN=$(openssl rand -hex 32)"
echo "  DASHBOARD_TLS_CERT=${CERT}"
echo "  DASHBOARD_TLS_KEY=${KEY}"
