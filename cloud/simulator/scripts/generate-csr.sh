#!/bin/bash
# Generate ECC private key and CSR for device certificate
# Usage: ./generate-csr.sh <serial_number>
# Example: ./generate-csr.sh MOLSTEM-TEST12345678901234567890

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <serial_number>"
    echo "Example: $0 MOLSTEM-TEST12345678901234567890"
    exit 1
fi

SERIAL="$1"
CERTS_DIR="$(dirname "$0")/../certs"

mkdir -p "$CERTS_DIR"

KEY_FILE="$CERTS_DIR/device.key"
CSR_FILE="$CERTS_DIR/device.csr"

echo "Generating ECC P-256 private key..."
openssl ecparam -genkey -name prime256v1 -out "$KEY_FILE"

echo "Generating CSR with CN=$SERIAL..."
openssl req -new -key "$KEY_FILE" -out "$CSR_FILE" -subj "/CN=$SERIAL"

echo ""
echo "Files created:"
echo "  Private key: $KEY_FILE"
echo "  CSR:         $CSR_FILE"
echo ""
echo "CSR contents (submit this to Cloudflare API):"
echo "=============================================="
cat "$CSR_FILE"
echo "=============================================="
echo ""
echo "To sign via Cloudflare API, run:"
echo ""
echo "curl -X POST \"https://api.cloudflare.com/client/v4/zones/\$ZONE_ID/client_certificates\" \\"
echo "  -H \"Authorization: Bearer \$CF_API_TOKEN\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{"
echo "    \"csr\": \"'\$(cat $CSR_FILE | tr -d '\\n')'\","
echo "    \"validity_days\": 3650"
echo "  }'"
echo ""
echo "Then save the returned certificate to: $CERTS_DIR/device.crt"
