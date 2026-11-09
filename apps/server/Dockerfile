# Romslig API: esbuild bundles the server (and @romslig/shared) into one ES module, which runs on
# distroless Node without node_modules. Build from the repo root:
#   docker build -f apps/server/Dockerfile .

# Only the manifests first, so a source change keeps the npm ci layer cached. Every workspace's
# package.json must be here, or npm ci fails on the lock file: add new workspaces to this list.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
RUN npm run build -w apps/server && mkdir -p /out/data/projects

# Pinned to the digest so Dependabot (docker, weekly) opens a PR when Google rebuilds the image with
# Debian security fixes. The nonroot variant runs as uid 65532 by itself.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3
WORKDIR /app
COPY --from=build /app/apps/server/dist/ /app/
# Writable data directory for the file store (local runs without PostgreSQL).
COPY --from=build --chown=65532:65532 /out/data /data
# Passed by the reusable docker-container workflow; reported in /api/config for the footer.
ARG APP_VERSION=
ARG GIT_SHA=
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    PORT=8080 \
    ROMSLIG_DATA_DIR=/data/projects
EXPOSE 8080
# The image's entrypoint is node itself.
CMD ["--enable-source-maps", "server.mjs"]
