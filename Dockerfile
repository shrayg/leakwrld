FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY styles.css ./
COPY sw.js ./
COPY robots.txt ./
COPY manifest.json ./
COPY client/public ./client/public
COPY --from=build /app/client/dist ./client/dist

EXPOSE 8080
CMD ["node", "server.js"]
