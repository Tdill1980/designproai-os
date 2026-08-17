FROM node:22-slim

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.revision=${GIT_SHA}

WORKDIR /app

# Sharp needs libvips for deterministic high-resolution raster processing.
RUN apt-get update && apt-get install -y --no-install-recommends \
  libvips-dev \
  && rm -rf /var/lib/apt/lists/*

# The lockfile is part of the production identity. npm ci refuses drift instead
# of resolving a different transitive graph on each deploy.
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node worker/ .

# The browser and durable worker import the same platform-neutral protected
# panel ladder. worker/designpro-entice-workflow.cjs resolves ../shared from
# /app, so the deployment image must place it at /shared.
COPY --chown=node:node shared/ /shared/

# Keep the bleed helper beside panelWorker.cjs so its require("sharp") resolves
# the production dependency installed in /app/node_modules.
COPY scripts/build-bleed-panel.cjs /app/build-bleed-panel.cjs

USER node

EXPOSE 3001

CMD ["node", "index.js"]
