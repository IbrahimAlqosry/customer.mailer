# Customer Mailer API: the Node server that sends email/WhatsApp, checks addresses and reads bounces.
# Build:  docker build -t customer-mailer-api ./server
# Run:    docker run -p 3000:3000 --env-file server/.env -e HOST=0.0.0.0 customer-mailer-api
# Settings (SMTP, login, WhatsApp...) come from the environment at run time, never from the image:
# --env-file locally, a Kubernetes Secret in the cluster (see k8s/).

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY *.js ./

# Listen on all interfaces inside the container; one proxy (the nginx web container) in front.
ENV HOST=0.0.0.0 \
    PORT=3000 \
    TRUST_PROXY=1

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
