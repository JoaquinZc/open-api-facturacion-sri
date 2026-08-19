# =================================================
# Multi-stage Dockerfile for Open API Facturación SRI (NestJS)
# =================================================

# -----------------------------
# Stage 1: Build
# -----------------------------
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# -----------------------------
# Stage 2: Production
# -----------------------------
FROM node:22-alpine AS production

# Set environment to production
ENV NODE_ENV=production
ENV TZ=America/Guayaquil

# Install tzdata for timezone support and su-exec for privilege dropping
RUN apk add --no-cache tzdata su-exec

# Set working directory
WORKDIR /app

# Copy package files
COPY --from=builder /app/package*.json ./

# Copy production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy DB schema — lo lee dist/scripts/db-bootstrap.js en el arranque
COPY --from=builder /app/database ./database

# Utilidades que se ejecutan a mano contra el contenedor en marcha
# (`railway run node scripts/…`). Son JavaScript plano, no pasan por `tsc`, así
# que no aparecen en `dist/` — y sin esta línea existen en el repositorio pero
# **no dentro de la imagen**, que es justo donde hacen falta: la de migrar los
# XML tiene que leer el volumen montado.
COPY --from=builder /app/scripts ./scripts

# Plantillas del RIDE. **Van en la imagen, no en el volumen**: son código, se
# versionan con la aplicación y deben actualizarse al desplegar.
#
# Estaban solo en el repositorio y nunca se copiaban aquí, así que el servicio
# arrancaba con `TEMPLATES_DIR` apuntando a un `/data/templates` vacío y todo
# RIDE moría con «No se encontró ningún template con ID: ride». Copiarlas al
# volumen tampoco valdría: Railway lo monta encima al arrancar y las taparía.
COPY --from=builder /app/templates ./templates

# Dónde buscarlas. Se fija aquí para que un despliegue nuevo funcione sin
# depender de que alguien acierte la variable en el panel.
ENV TEMPLATES_DIR=/app/templates

# Create directories for volumes
RUN mkdir -p /data/templates /data/pdfs /data/certs /data/xmls \
    /data/pdfs/con_firma /data/pdfs/others /data/pdfs/documents /data/pdfs/images

# Create non-root user for least privilege (CWE-250, OWASP A05:2021)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app /data

# Copy entrypoint script (fixes bind-mount permissions then drops to appuser)
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Expose the application port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/status || exit 1

# Entrypoint fixes volume permissions as root, then drops to appuser via su-exec
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
