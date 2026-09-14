# syntax=docker/dockerfile:1.7
# Build context: repository root. Static build served by unprivileged nginx (port 8080), /api proxied to the API.
ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.17.1

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter "@georeminder/admin..."
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN pnpm --filter @georeminder/shared build && pnpm --filter @georeminder/admin build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
