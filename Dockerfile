FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY data/.gitkeep ./data/.gitkeep

EXPOSE 4173

CMD ["node", "src/server.mjs"]
