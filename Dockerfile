FROM node:22-slim

# Install build tools required to compile native addons (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# HW3 v2.1 — fix BASE_URL replacement in protocol files
ENV APP_VERSION=2.1.0

CMD ["node", "src/server.js"]
