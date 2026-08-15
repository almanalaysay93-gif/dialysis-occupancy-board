# Base image with pnpm enabled
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Build stage: full dependency install (vite/esbuild are devDependencies and the
# project uses pnpm patchedDependencies, so the patches/ folder must be present
# before any pnpm install) then compile the Vite client and esbuild server.
FROM base AS build
WORKDIR /app
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm run build

# Runner stage: esbuild --packages=external keeps dependencies unbundled, so
# node_modules must be shipped whole from the build stage.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/index.js"]
