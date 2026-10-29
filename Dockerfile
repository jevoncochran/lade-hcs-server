# The API's container for Google Cloud Run. One image does two jobs:
#   - the API itself (default command), as service `lade-api`
#   - database updates before each deploy, as job `lade-db-migrate`, with the
#     command: sh -c "npx prisma migrate deploy && npx prisma db seed"
# See cloudbuild.yaml and docs/deploy.md.
#
# Settings and secrets (DATABASE_URL, encryption keys, Stripe, AWS…) come
# from Cloud Run at start-up, never from the image.

FROM node:22-alpine AS build
WORKDIR /app
# From the lockfile exactly (.npmrc sets legacy-peer-deps, the way the
# lockfile was made). The schema is copied first: installing runs
# `prisma generate` (postinstall), which needs it.
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=8080
# Everything the build had, including the dev tools the migration job uses
# (prisma CLI, tsx for the seed), minus the TypeScript sources.
COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src/generated ./src/generated
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
