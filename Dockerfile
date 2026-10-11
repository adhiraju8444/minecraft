# Blockforge multiplayer server: serves the game and runs one shared world.
#   docker build -t blockforge .
#   docker run -p 8080:8080 -v blockforge-world:/data blockforge
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.html ./
COPY css ./css
COPY js ./js
COPY vendor ./vendor
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server/server.js"]
