FROM node:22-alpine AS build

WORKDIR /app

# Install pnpm directly. Dokploy's Nixpacks image currently enables an older
# Corepack shim that fails while launching this repo's pnpm 11.
RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM nginx:stable-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
