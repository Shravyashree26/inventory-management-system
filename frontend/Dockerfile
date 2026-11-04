# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# strict CSP in nginx forbids inline scripts
ENV INLINE_RUNTIME_CHUNK=false
RUN npm run build

# ---- runtime (non-root, listens on 8080) ----
FROM nginxinc/nginx-unprivileged:stable-alpine
ENV BACKEND_HOST=backend BACKEND_PORT=8080 DNS_RESOLVER=127.0.0.11
COPY .docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/build /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz >/dev/null || exit 1

