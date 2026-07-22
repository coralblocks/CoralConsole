FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
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
COPY --from=builder --chown=coral:coral /app/drizzle ./drizzle
COPY --from=builder --chown=coral:coral /app/scripts ./scripts

USER coral
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
