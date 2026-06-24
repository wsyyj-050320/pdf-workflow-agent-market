# Build from repo root:
#   docker build -f coral-agents/seller-agent/Dockerfile -t seller-agent:0.1.0 .

FROM node:20-alpine AS builder
WORKDIR /app

# Mirror repo layout so "file:../../sdk/agent-core-ts" resolves correctly
COPY sdk/agent-core-ts/package.json sdk/agent-core-ts/package-lock.json* ./sdk/agent-core-ts/
RUN cd sdk/agent-core-ts && npm install --ignore-scripts
COPY sdk/agent-core-ts/tsconfig.json ./sdk/agent-core-ts/
COPY sdk/agent-core-ts/src/ ./sdk/agent-core-ts/src/
RUN cd sdk/agent-core-ts && npx tsc

# --install-links copies the SDK into node_modules instead of symlinking
COPY coral-agents/seller-agent/package.json coral-agents/seller-agent/package-lock.json* ./coral-agents/seller-agent/
RUN cd coral-agents/seller-agent && npm install --ignore-scripts --install-links
COPY coral-agents/seller-agent/tsconfig.json ./coral-agents/seller-agent/
COPY coral-agents/seller-agent/src/ ./coral-agents/seller-agent/src/
RUN cd coral-agents/seller-agent && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/coral-agents/seller-agent/dist ./dist
COPY --from=builder /app/coral-agents/seller-agent/node_modules ./node_modules

CMD ["node", "dist/index.js"]
