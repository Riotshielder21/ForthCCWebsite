FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./server.js
COPY src ./src

ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
