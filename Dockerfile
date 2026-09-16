FROM node:22-slim AS base
WORKDIR /app

# better-sqlite3 is a native addon (node-gyp) -- typically needs build
# tools + python3 to compile from a slim base image. Included
# preemptively; verify by actually building the image before trusting
# this, per this project's own discipline of not asserting untested
# things.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
