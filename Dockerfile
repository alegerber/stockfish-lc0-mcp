# ── Stage 1: Build Lc0 from source ─────────────────────────────────────────
FROM node:24-slim AS lc0-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    g++ \
    python3 \
    python3-pip \
    ninja-build \
    libopenblas-dev \
    zlib1g-dev \
    pkg-config \
    && pip3 install --break-system-packages meson \
    && rm -rf /var/lib/apt/lists/*

# Pinned to a release tag for reproducible builds (was the moving release/0.32 branch).
RUN git clone -b v0.32.1 --recurse-submodules \
      https://github.com/LeelaChessZero/lc0.git /tmp/lc0 \
    && cd /tmp/lc0 \
    && ./build.sh release \
    && cp /tmp/lc0/build/release/lc0 /usr/local/bin/lc0 \
    && rm -rf /tmp/lc0

# ── Stage 2: Final image ──────────────────────────────────────────────────
FROM node:24-slim

# Install Stockfish + Lc0 runtime deps (OpenBLAS for blas backend, curl for weights)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      stockfish \
      libopenblas0 \
      curl \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy Lc0 binary from builder stage
COPY --from=lc0-builder /usr/local/bin/lc0 /usr/local/bin/lc0

# Download Maia-1900 neural network weights (~25MB)
RUN mkdir -p /usr/share/lc0 && \
    curl -fsSL -o /usr/share/lc0/maia-1900.pb.gz \
      https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1900.pb.gz && \
    echo "e2f565f42d7cd9f122557e6dc4eb84e5bbaedceda1d404dc485d3611c7c97a12  /usr/share/lc0/maia-1900.pb.gz" \
      | sha256sum -c -

WORKDIR /app

# Install dependencies (npm ci = reproducible, lockfile-exact)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stockfish environment
ENV STOCKFISH_PATH=/usr/games/stockfish
ENV STOCKFISH_THREADS=2
ENV STOCKFISH_HASH=128

# Lc0 environment (enabled by default with Maia-1900 network)
ENV LC0_PATH=/usr/local/bin/lc0
ENV LC0_WEIGHTS_PATH=/usr/share/lc0/maia-1900.pb.gz
ENV LC0_THREADS=2
ENV LC0_HASH=128

# Drop root for the runtime. The server only reads its build output and the
# engine binaries/weights (no writes — it speaks MCP over stdio), so the
# unprivileged `node` user (uid 1000, shipped in the base image) is sufficient.
USER node

# MCP uses stdio transport
CMD ["node", "dist/index.js"]
