# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage with Fastify
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built assets and server
COPY --from=builder /app/dist ./dist
COPY server.js ./

# Environment defaults
ENV NODE_ENV=production \
    PORT=80 \
    HOST=0.0.0.0 \
    API_URL=http://cqrcfg:3000 \
    UI_BASE_PATH=/

EXPOSE 80

CMD ["node", "server.js"]
