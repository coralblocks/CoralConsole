FROM node:22-trixie-slim AS dependencies
WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-trixie-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/coralconsole.db

RUN groupadd --system --gid 1001 coral && \
    useradd --system --uid 1001 --gid coral coral && \
    mkdir -p /data && chown coral:coral /data

COPY --from=builder --chown=coral:coral /app/public ./public
COPY --from=builder --chown=coral:coral /app/.next/standalone ./
COPY --from=builder --chown=coral:coral /app/.next/static ./.next/static
COPY --from=builder --chown=coral:coral /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=coral:coral /app/drizzle ./drizzle
COPY --from=builder --chown=coral:coral /app/scripts ./scripts

USER coral
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
