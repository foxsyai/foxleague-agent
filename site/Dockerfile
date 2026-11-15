# ---- Build stage ---------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies first for better cache
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy source + build
COPY . .
RUN npm run build

# ---- Serve stage ---------------------------------------------------------
FROM nginxinc/nginx-unprivileged:alpine

# Replace default config with our minimal one
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static build output
COPY --from=builder /app/dist /usr/share/nginx/html

# Healthcheck — nginx listens on IPv4 0.0.0.0:8080. Use 127.0.0.1 explicitly
# because glibc resolves `localhost` → `::1` first (ip6-localhost in
# /etc/hosts), but nginx is not configured for IPv6 → "Connection refused".
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
