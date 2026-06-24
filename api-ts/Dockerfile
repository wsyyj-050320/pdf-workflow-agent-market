# Build from repo root:
#   docker build -f api-ts/Dockerfile -t api-ts:latest .

FROM node:20-slim
WORKDIR /build

# SDK
COPY sdk/agent-core-ts/package*.json ./sdk/agent-core-ts/
RUN cd sdk/agent-core-ts && npm install
COPY sdk/agent-core-ts/src ./sdk/agent-core-ts/src

# api-ts — runs with tsx so TypeScript imports from SDK src work at runtime
COPY api-ts/package*.json ./api-ts/
RUN cd api-ts && npm install
COPY api-ts/src ./api-ts/src
COPY api-ts/tsconfig.json ./api-ts/

EXPOSE 8081
WORKDIR /build/api-ts
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts"]
