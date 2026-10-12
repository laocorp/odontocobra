#!/bin/sh
set -eu

if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  echo "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in the Dokploy runtime environment." >&2
  exit 1
fi

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__ODONTOCUENTA_CONFIG__ = {
  supabaseUrl: "${VITE_SUPABASE_URL:-}",
  supabasePublishableKey: "${VITE_SUPABASE_PUBLISHABLE_KEY:-}",
};
EOF
