# syntax=docker/dockerfile:1.7
# Build context: repository root (monorepo). Multi-arch (amd64 + arm64).
ARG NODE_IMAGE=node:22-alpine
ARG PNPM_VERSION=10.17.1

# ---------- build ----------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@georeminder/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @georeminder/shared build && pnpm --filter @georeminder/api build \
 && pnpm install --frozen-lockfile --prod --filter "@georeminder/api..." \
 && rm -rf apps/api/src packages/shared/src

# ---------- runtime ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=3000
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/packages/shared /app/packages/shared
COPY --from=build --chown=node:node /app/apps/api /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
