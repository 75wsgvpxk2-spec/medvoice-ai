# better-sqlite3 is a native module, so it is built once here and the compiler
# left behind — the runtime image carries the binary, not the toolchain.
FROM node:24-slim AS build

WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# The database lives on a volume, not in the image. Owned by the node user so
# the process does not need root to write to it.
RUN mkdir -p /app/data && chown -R node:node /app

# The whole node_modules, dev dependencies included — the server runs through
# tsx, which is a devDependency. Pruning with `npm ci --omit=dev` produces an
# image that builds fine and then cannot start.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts ./scripts
# Parsed at startup: the reference file is not documentation here, it is the
# source of every clinical threshold, and the server will not boot without it.
COPY --chown=node:node docs/clinical-reference.md ./docs/clinical-reference.md

USER node
EXPOSE 5174
ENV API_PORT=5174 DB_PATH=/app/data/clinic.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||5174)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/src/index.ts"]
