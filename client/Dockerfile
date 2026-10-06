# Customer Mailer web: compile the Angular SPA, then serve it with nginx, which also forwards
# /api/ to the API container (same pattern as atlas-console / Ultimate Pay).
# Build:  docker build -t customer-mailer-web ./client
# Run:    docker run -p 8080:80 -e API_BACKEND=http://<api-host>:3000 customer-mailer-web

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Served at the site root; the app finds the API at "api" relative to it (see src/config.js).
RUN npx ng build --configuration production --base-href /

FROM nginx:1.27-alpine AS serve
# nginx's entrypoint envsubst's this into /etc/nginx/conf.d/default.conf at container start,
# substituting ${API_BACKEND} (where the API container is reachable).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/client/browser /usr/share/nginx/html

ENV API_BACKEND=http://customer-mailer-api:3000
EXPOSE 80
