FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY certs ./certs
COPY src ./src
RUN mkdir -p /data/uploads && chown -R node:node /app /data/uploads
USER node
EXPOSE 3001
CMD ["sh", "-c", "node src/init.cjs && exec node src/index.cjs"]
