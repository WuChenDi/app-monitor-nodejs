FROM node:22-alpine AS base

RUN npm install -g pnpm

FROM base AS builder

RUN apk add --no-cache gcompat
WORKDIR /app

COPY package*json pnpm-lock.yaml tsconfig.json src ./

RUN pnpm install --frozen-lockfile && \
    pnpm run build && \
    pnpm prune --prod

FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hono

COPY --from=builder --chown=hono:nodejs /app/node_modules /app/node_modules
COPY --from=builder --chown=hono:nodejs /app/dist /app/dist
COPY --from=builder --chown=hono:nodejs /app/package.json /app/package.json

ENV NODE_ENV=production \
    PORT=3000 \
    CHECK_CRON="*/5 * * * *" \
    DINGTALK_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=your_access_token" \
    DINGTALK_SECRET="your_secret_here"

VOLUME ["/app/logs"]

USER hono
EXPOSE 3000

CMD ["node", "/app/dist/index.js"]
