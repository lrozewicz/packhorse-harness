# Harness router: a small Node service with no runtime dependencies other than `yaml`.
# The same image also serves as the `harness-init` service (config generator).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY bin ./bin

ENV HARNESS_MODELS_FILE=/harness/models.yaml \
    HARNESS_OUT_DIR=/harness/generated \
    HARNESS_LITELLM_BASE=/harness/litellm/config.base.yaml \
    NODE_ENV=production

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HARNESS_ROUTER_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bin/router.js"]
