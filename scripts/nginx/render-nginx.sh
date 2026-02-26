#!/usr/bin/env sh
set -euo pipefail

envsubst '${DOMAIN} ${WWW_DOMAIN}' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
