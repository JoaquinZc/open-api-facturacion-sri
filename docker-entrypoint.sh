#!/bin/sh
# =================================================
# Docker Entrypoint — Open API Facturación SRI
# =================================================
# Fixes bind-mount permissions then drops to appuser.
# Standard pattern for non-root containers with host volumes.
# =================================================
set -e

DATA_DIRS="/data/templates /data/pdfs /data/certs /data/xmls /data/pdfs/con_firma /data/pdfs/others /data/pdfs/documents /data/pdfs/images"

# Create directories if they don't exist (bind mounts may not create subdirs)
mkdir -p $DATA_DIRS 2>/dev/null || true

# Fix ownership of all data directories (bind mounts override Dockerfile chown)
for dir in $DATA_DIRS; do
  chown -R appuser:appgroup "$dir" 2>/dev/null || true
done

# Ensure writability even if chown fails (e.g., Windows Docker Desktop bind mounts)
chmod -R u+rwX,g+rwX,o+rwX /data 2>/dev/null || true

# Inicializa el esquema de la base la primera vez. Es idempotente: si ya se
# aplicó, solo verifica y sigue. Con `set -e`, si falla el arranque se aborta
# en vez de levantar la API contra una base vacía.
echo "==> Verificando esquema de base de datos..."
su-exec appuser node /app/dist/scripts/db-bootstrap.js

# Drop to appuser and execute the main command
exec su-exec appuser "$@"
