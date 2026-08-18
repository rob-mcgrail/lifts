# syntax=docker/dockerfile:1
FROM oven/bun:alpine AS base
WORKDIR /app

# Inject Cloudflare WARP cert before any network requests
RUN --mount=type=secret,id=cloudflare_cert,target=/tmp/cloudflare.pem \
    if [ -f /tmp/cloudflare.pem ]; then \
      cat /tmp/cloudflare.pem >> /etc/ssl/certs/ca-certificates.crt && \
      cp /tmp/cloudflare.pem /etc/ssl/cloudflare.pem; \
    fi

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

# Prebuild the SPA so production serves minified, compressed, cacheable assets
# through Hono. In dev the compose command overrides CMD and Bun's HTML route
# bundles live with HMR instead, so this output is simply unused.
RUN bun build ./web/index.html --outdir=dist/web --minify --production --public-path=/

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "src/index.ts"]
