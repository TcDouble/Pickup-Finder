# The notifier: a small Node server that sends Pickup-Finder notifications.
# Build and run it with docker-compose.yaml in this folder (see README.md).
FROM node:22.19.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Only the runtime packages (firebase-admin and nodemailer), not the test tools.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src/ ./src/

USER node
CMD ["node", "src/index.js"]
