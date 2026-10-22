# Agent API + built React simulator in one container.
# Build from the repo root:  docker build -f deploy/Dockerfile.app -t parcel-app .
# Run with MCP_SERVER_URL pointing at the deployed MCP server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/agent-api/package.json apps/agent-api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/domain packages/domain
COPY apps/agent-api apps/agent-api
COPY apps/web apps/web
RUN npm run build -w packages/domain && npm run build -w apps/agent-api && npm run build -w apps/web \
 && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/domain/package.json packages/domain/
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/agent-api/package.json apps/agent-api/
COPY --from=build /app/apps/agent-api/dist apps/agent-api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8080
USER node
CMD ["node", "apps/agent-api/dist/index.js"]
