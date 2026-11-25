#!/bin/bash
# Generates the molstem device PKI material (all outputs are git-ignored):
#
#   ca.key / ca.crt            local "molstem Device CA" (used by the simulator / local dev)
#   generic-device.key         private key of the shared ("generic") device client certificate
#   generic-device.csr         CSR with CN=MOLSTEM-THERMOCYCLER-0 -> have Cloudflare's managed CA sign it
#   generic-device.local.crt   same CSR signed by the local CA, for the simulator
#
# Production devices present the Cloudflare-signed certificate (mTLS on devices.molstem.com);
# the worker only checks that the CN equals MOLSTEM-THERMOCYCLER-0 and that Cloudflare verified it.
# Per-device identity comes from the per-device signing key, not from this certificate.
#
# Usage: ./generate.sh            (refuses to overwrite existing files)
#        ./generate.sh --force    (moves existing files to *.bak.<timestamp> first)

set -euo pipefail
# Git-for-Windows: stop MSYS from rewriting the -subj argument as a path
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
cd "$(dirname "$0")"

GENERIC_CN="MOLSTEM-THERMOCYCLER-0"
CA_SUBJ="/CN=molstem Device CA/O=molstem/C=US"

for f in ca.key ca.crt generic-device.key generic-device.csr generic-device.local.crt; do
  if [ -e "$f" ]; then
    if [ "${1:-}" = "--force" ]; then
      mv "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
    else
      echo "$f exists; re-run with --force to replace (old files are kept as *.bak.*)" >&2
      exit 1
    fi
  fi
done

echo "== local CA ($CA_SUBJ)"
openssl ecparam -genkey -name prime256v1 -noout -out ca.key
openssl req -new -x509 -key ca.key -out ca.crt -days 3650 -subj "$CA_SUBJ" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

echo "== generic device key + CSR (CN=$GENERIC_CN)"
openssl ecparam -genkey -name prime256v1 -noout -out generic-device.key
openssl req -new -key generic-device.key -out generic-device.csr -subj "/CN=$GENERIC_CN/O=molstem/OU=Device"

echo "== generic device cert signed by the local CA (simulator only)"
openssl x509 -req -in generic-device.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out generic-device.local.crt -days 3650

openssl x509 -in ca.crt -noout -subject -dates
openssl x509 -in generic-device.local.crt -noout -subject -issuer

cat <<EOF

Next, get the CSR signed by Cloudflare's managed CA for the molstem zone (15 years):

  ZONE=\$(curl -s -H "Authorization: Bearer \$CF_TOKEN" \\
    "https://api.cloudflare.com/client/v4/zones?name=molstem.com" | jq -r '.result[0].id')
  curl -s -X POST -H "Authorization: Bearer \$CF_TOKEN" -H "Content-Type: application/json" \\
    "https://api.cloudflare.com/client/v4/zones/\$ZONE/client_certificates" \\
    --data "\$(jq -n --arg csr "\$(cat generic-device.csr)" '{csr:\$csr, validity_days:5475}')" \\
    | jq -r '.result.certificate' > generic-device.crt

Then store generic-device.crt / generic-device.key as the admin worker secrets MTLS_CERT / MTLS_KEY
(cd cloud/admin-worker && wrangler secret put MTLS_CERT < ../ca/generic-device.crt, same for the key).
EOF
