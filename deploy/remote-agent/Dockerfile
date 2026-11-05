FROM node:22.22.1-bookworm-slim
WORKDIR /opt/dsh-agent
COPY remote-computer-agent/package.json remote-computer-agent/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY remote-computer-agent/build.mjs ./
COPY remote-computer-agent/src ./src
RUN npm run build && chown -R node:node /opt/dsh-agent
USER node
# Supply a root-scoped config and a persistent, node-owned /data. No host socket.
CMD ["node", "dist/cli.mjs", "serve", "/data/config.json"]
