FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .
# SQLite DB will live at /app/ohc_profiles.db (bind mount with compose or docker run -v)

ENV NODE_ENV=production
CMD ["node", "index.js"]
