# ---------- Build stage (glibc; compilers available) ----------
FROM node:20-bullseye AS build
WORKDIR /app

# Tools for native modules like better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy manifests first (better layer caching)
COPY package.json package-lock.json* ./

# Install deps (lock-aware if lock exists)
RUN npm ci --omit=dev || npm install --production

# Force native build so we don't grab a wrong prebuilt binary
ENV npm_config_build_from_source=true

# Copy the rest of the app
COPY . .

# Rebuild better-sqlite3 explicitly (good hygiene in cross-builds)
RUN npm rebuild better-sqlite3 --build-from-source

# ---------- Runtime stage (small glibc image) ----------
FROM node:20-bullseye-slim
WORKDIR /app

# Copy built app + node_modules
COPY --from=build /app /app

# Ensure a writable data dir for SQLite DB
RUN mkdir -p /app/data

# If your index.js uses __dirname/data/ohc_profiles.db you're good.
# Otherwise you can set: ENV DB_PATH=/app/data/ohc_profiles.db

ENV NODE_ENV=production
ENTRYPOINT ["node", "index.js"]
