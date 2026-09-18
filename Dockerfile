# See `docs/the-image.md`.
#
# What this image is not allowed to contain: no connection string, no session
# secret, no provider credential, no photographs. Configuration arrives as
# environment and the photographs arrive as a mount, so the same image runs on a
# homelab box and on somebody else's computer.

# One version for both stages: the native modules below are compiled against the
# C library of the image they were installed in, so a build stage and a runtime
# stage that disagree produce an image that builds and will not start.
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS build

WORKDIR /app/web

# The manifest before the sources, so an edit to a component does not reinstall
# onnxruntime.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

RUN npm run build

# A stage of its own rather than two more `RUN` lines, so that `--target build`
# above stays a complete checkout with `tsx` and `vitest` still in it.
FROM build AS production-tree

# The server bundle is built with `packages: 'external'`, so nothing from
# node_modules is inside it and everything in `dependencies` is still needed at
# runtime. This removes the devDependencies and keeps the rest.
RUN npm prune --omit=dev

# The smoke check runs after the prune, which is the only order that proves
# anything: it resolves every external against the tree that is about to be
# copied into the runtime stage.
RUN node scripts/smoke-built-server.mjs

FROM node:${NODE_VERSION} AS runtime

# The version, the revision and the build time are not here: they are properties
# of a build rather than of the recipe, and `.github/workflows/publish.yml` adds
# them from the tag it is publishing.
LABEL org.opencontainers.image.title="book-scan"
LABEL org.opencontainers.image.description="Phone-first cataloguing for a physical book collection."
LABEL org.opencontainers.image.source="https://github.com/BlakeHastings/book-scan"
LABEL org.opencontainers.image.documentation="https://github.com/BlakeHastings/book-scan/blob/master/docs/publishing.md"
LABEL org.opencontainers.image.licenses="MIT"

# Where the contract lives inside this image, so a consumer can find it by
# asking rather than by knowing.
LABEL org.bookscan.contract="/app/deploy/contract.json"

# No `apt-get` line, and that is measured rather than an omission. Both compiled
# addons resolve entirely against what `node:22-bookworm-slim` already carries.
# The only shared objects that do not resolve are the CUDA and TensorRT
# execution providers, which are `dlopen`ed only by a session that asks for
# them. If a future dependency does need a library, this is where it goes.
ENV NODE_ENV=production

WORKDIR /app/web

# `dist-server/` must stay a sibling of `dist/` one directory below `web/`:
# `server/index.ts` finds the built client at `../dist/` relative to its entry
# module.
COPY --from=production-tree /app/web/node_modules ./node_modules
COPY --from=production-tree /app/web/dist ./dist
COPY --from=production-tree /app/web/dist-server ./dist-server
COPY --from=production-tree /app/web/package.json ./package.json

# The contract, carried by the image it describes, so the answer to what this
# exact image needs comes from the image. `deploy/check-config.mjs` has no
# dependencies and imports nothing from the app, so it runs in here.
# `.github/workflows/publish.yml` compares this copy against the repository's
# before it announces a release.
COPY deploy/ /app/deploy/

# The photographs are a mount, not image content. A container that loses this
# loses every photograph: the names are in Postgres and the bytes are not.
#
# The default is set rather than left absent because absent is the hazard. A
# server with no `BOOKSCAN_DATA` resolves `./data`, creates it, and comes up
# reporting success, serving a catalogue whose every photograph is a 404.
ENV BOOKSCAN_DATA=/data
ENV PORT=3001

# `os.homedir()` is where tesseract.js and ppu-paddle-ocr cache their models
# (`web/server/identify.ts`, `web/server/paddle.ts`), and `USER` does not set
# HOME. Unset, the first OCR of a container's life writes into whatever Node
# resolves instead.
ENV HOME=/home/node

RUN mkdir -p /data/covers && chown -R node:node /data

# Metadata, not a guarantee: an anonymous volume is still a volume nobody named.
VOLUME ["/data"]

USER node

# Documentation rather than a promise. See `docs/the-bind.md`: by default the
# server binds `127.0.0.1` inside this container, so publishing this port
# reaches nothing on its own, and whatever a deployment puts in front of it has
# to be in the same network namespace. `BOOKSCAN_BIND=all` is the other answer
# and is the deployment's to give, deliberately not set here.
EXPOSE 3001

# No HEALTHCHECK, and that is a decision. `GET /api/health` answers 401 to
# anything without a session, so a probe here would have to understand that 401
# is the healthy answer.

# Exec form, so Node is PID 1 and receives the signal directly rather than
# through a shell that would not forward it. `web/server/index.ts` installs a
# SIGTERM handler, which is what makes the signal deliverable at all: the kernel
# discards a default-disposition signal sent to PID 1.
CMD ["node", "--enable-source-maps", "dist-server/index.js"]
