FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && npm ci --omit=dev \
    && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY data/.gitkeep ./data/.gitkeep

EXPOSE 4173

CMD ["node", "src/server.mjs"]
