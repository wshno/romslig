# Romslig web: the Vite SPA, served by wshno/static-server (stdlib-only Go server on distroless,
# nonroot, no shell). Build from the repo root:
#   docker build -f apps/web/Dockerfile .

# Only the manifests first, so a source change keeps the npm ci layer cached. Every workspace's
# package.json must be here, or npm ci fails on the lock file: add new workspaces to this list.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN npm run build -w apps/web

# Tag and digest pinned, so Dependabot (docker, weekly) opens a PR for each static-server release.
FROM ghcr.io/wshno/static-server/server:0.1.0@sha256:9036422e3de9c774cc26a0f7ecf05e04bef2fea162653ec248691ee8c90abb94
COPY --from=build /app/apps/web/dist/ /public/
# Identical but for the CSP header name; CSP_MODE in deploy/ picks one through STATIC_SERVER_CONFIG.
COPY apps/web/static-server.report-only.json apps/web/static-server.enforce.json /etc/static-server/
ENV STATIC_SERVER_CONFIG=/etc/static-server/static-server.report-only.json
