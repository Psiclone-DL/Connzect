#!/usr/bin/env bash
set -euo pipefail

docker compose run --rm certbot renew \
  --webroot -w /var/www/certbot \
  --deploy-hook "docker compose exec nginx nginx -s reload"
