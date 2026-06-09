# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including optional)
RUN npm ci

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install git (required for git storage backend)
RUN apk add --no-cache git openssh-client

# Create non-root user and data directory
RUN addgroup -g 1001 -S cqrcfg && \
    adduser -S cqrcfg -u 1001 -G cqrcfg && \
    mkdir -p /data/git && \
    chown -R cqrcfg:cqrcfg /data

# Copy package files
COPY package*.json ./

# Install production dependencies only
# Use --ignore-scripts to avoid potential issues with native modules
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy source code
COPY src/ ./src/

# Set ownership
RUN chown -R cqrcfg:cqrcfg /app

# Switch to non-root user
USER cqrcfg

# Environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the service
CMD ["node", "src/index.js"]
