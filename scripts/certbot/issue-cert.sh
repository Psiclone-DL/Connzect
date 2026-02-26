#!/usr/bin/env bash
set -euo pipefail

: "${DOMAIN:?DOMAIN must be set in the root .env file}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set in the root .env file}"

WWW_DOMAIN="${WWW_DOMAIN:-}"

domains=(-d "$DOMAIN")
if [ -n "$WWW_DOMAIN" ]; then
  domains+=(-d "$WWW_DOMAIN")
fi

docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  "${domains[@]}" \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --non-interactive

docker compose exec nginx nginx -s reload
