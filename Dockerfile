# Nexo InOuty API — production image
#   docker build -t nexo-api .
#   docker run -p 3001:3001 --env-file .env nexo-api

# 1. Build: install everything, compile TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# 2. Run: production dependencies and the compiled code only
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
# Never run as root
USER node
EXPOSE 3001
# The platform (or Docker itself) restarts the container when this fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "dist/main"]
