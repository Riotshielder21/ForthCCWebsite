# Install production dependencies in a full Node image, then run on distroless.
# The runtime image has no npm, shell, package manager or Perl, which removes
# most OS and bundled-npm CVEs from container scans.
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM gcr.io/distroless/nodejs22-debian13:nonroot

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY server.js ./server.js
COPY src ./src

ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["server.js"]
