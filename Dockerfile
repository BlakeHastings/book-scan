# The image (#531), under epic #471.
#
#     docker build -t book-scan .
#     docker run --rm -e ConnectionStrings__bookscan=... -v covers:/data book-scan
#
# `docs/the-image.md` is the argument for every choice below and the transcript
# of what was proved by running it. This file carries the reasons that belong
# beside the line they explain.
#
# There is nothing about Cloudflare here, and that is deliberate. The owner has
# chosen Cloudflare and has not chosen between a tunnel pointing at an origin he
# runs and Containers running this image. An image is right under both; a
# `wrangler.toml` would be a guess at which.
#
# ## What this image is not allowed to contain
#
# No connection string, no session secret, no provider credential, no
# photographs. Configuration arrives as environment and the photographs arrive
# as a mount, so the same image runs on a homelab box and on somebody else's
# computer. `docs/deployment-survey.md` section 1 is the whole configuration
# surface and section 2 is the directory.

# One version for both stages, and that is the point of the ARG rather than
# tidiness: the native modules below are compiled against the C library of the
# image they were installed in, so a build stage and a runtime stage that
# disagree produce an image that builds and will not start.
ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# The build stage: the toolchain, which the runtime stage does not get.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build

WORKDIR /app/web

# The manifest before the sources, so an edit to a component does not reinstall
# onnxruntime. `npm ci` reads the lock file and nothing else.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

# `npm run build` rather than its halves, for the reason CI runs the whole
# script: the script a deployment runs is the script worth proving. It
# typechecks, builds the client to `dist/`, and bundles the server to
# `dist-server/index.js` with the migrations copied beside it.
RUN npm run build

# ---------------------------------------------------------------------------
# The production tree: the same stage with the toolchain taken back out.
# ---------------------------------------------------------------------------
#
# A stage of its own rather than two more `RUN` lines, so that `--target build`
# above stays a complete checkout with `tsx` and `vitest` still in it. That is
# worth having: it is how the suite was run for this change on a machine whose
# worktree had no `node_modules`, against a Postgres started beside it:
#
#     docker build --target build -t book-scan:build .
#     docker run --rm --network <net> \
#       -e BOOKSCAN_TEST_DATABASE_URL=postgres://...@<pg>:5432/postgres \
#       book-scan:build npm test
#
# That is the same arrangement CI uses, and it costs the final image nothing,
# because nothing is copied from that stage.
FROM build AS production-tree

# `docs/running-from-a-build.md` decision 2 records that the server bundle is
# built with `packages: 'external'`, so nothing from node_modules is inside it
# and everything in `dependencies` is still needed at runtime. This removes the
# devDependencies and keeps the rest, including the two compiled addons.
RUN npm prune --omit=dev

# The smoke check runs *after* the prune, which is the only order that proves
# anything. It loads the bundle, resolves every external against the tree that
# is about to be copied into the runtime stage, and requires the one refusal
# this app makes on purpose. A missing production dependency is a failed build
# here rather than a container that crash-loops somewhere else.
RUN node scripts/smoke-built-server.mjs

# ---------------------------------------------------------------------------
# The runtime stage: the bundle, the client, the installed tree, and Node.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# No `apt-get` line, and that is a measured result rather than an omission.
#
# The two compiled addons are the reason to expect one. Both were checked with
# `ldd` inside this image instead of guessed at, and every shared object either
# resolves against what `node:22-bookworm-slim` already carries or is a GPU
# execution provider that is never asked for:
#
#   sharp        -> libvips-cpp.so.8.18.3, all of libstdc++, libm, libgcc_s,
#                   libpthread, libc, libresolv, libdl. All present.
#   onnxruntime  -> libonnxruntime.so.1, the same set. All present.
#   the two that do not resolve are `libonnxruntime_providers_cuda.so` and
#   `..._tensorrt.so`, wanting libcuda, libcudnn and libnvinfer. They are
#   `dlopen`ed only by a session that asks for the CUDA provider, and nothing
#   here does.
#
# `docs/the-image.md` has the transcript. If a future dependency does need a
# library, this is where it goes, and the way to find out is that scan rather
# than a crash on somebody's first OCR.
ENV NODE_ENV=production

WORKDIR /app/web

# The four things a start needs, and nothing else: no TypeScript, no compiler,
# no test suite, no scripts directory.
#
# `dist-server/` must stay a sibling of `dist/` one directory below `web/`.
# `server/index.ts` finds the built client at `../dist/` relative to its entry
# module, so moving either of these breaks the arrangement that lets one gate
# cover the client and the API together. `web/scripts/build-server.mjs` says the
# same thing where it chooses the path.
COPY --from=production-tree /app/web/node_modules ./node_modules
COPY --from=production-tree /app/web/dist ./dist
COPY --from=production-tree /app/web/dist-server ./dist-server
COPY --from=production-tree /app/web/package.json ./package.json

# The photographs are a mount, not image content: 1541 files and about 1.4 GB,
# addressed by bare filename joined onto this directory at read time, written by
# six code paths and read by eight. A container that loses this loses every
# photograph, and there is no second copy in the app. The names are in Postgres
# and the bytes are not.
#
# The default is set rather than left absent because absent is the hazard:
# `docs/deployment-survey.md` section 1 measured that a server with no
# `BOOKSCAN_DATA` resolves `./data`, creates it, and comes up reporting success,
# serving a catalogue whose every photograph is a 404. Pointing it at the
# declared mount means forgetting the mount costs an empty directory rather than
# a silent one in the wrong place.
ENV BOOKSCAN_DATA=/data
ENV PORT=3001

# `os.homedir()` is where tesseract.js and ppu-paddle-ocr cache their models
# (`web/server/identify.ts`, `web/server/paddle.ts`), and `USER` does not set
# HOME. Unset, the first OCR of a container's life writes into whatever Node
# resolves instead.
ENV HOME=/home/node

RUN mkdir -p /data/covers && chown -R node:node /data

# Declared so the requirement is in the image's own metadata rather than only in
# a document somebody may not have read. It does not make a missing mount safe:
# an anonymous volume is still a volume nobody named and nobody will find again.
VOLUME ["/data"]

# Not root. The process reads a database, writes photographs into one mounted
# directory, and needs nothing else.
USER node

# Documentation rather than a promise, and worth reading with
# `docs/the-image.md`: the server binds `127.0.0.1` inside this container, which
# #520 left deliberately and this issue does not change. Publishing this port
# reaches nothing on its own. What a deployment puts in front of it has to be in
# the same network namespace: a tunnel daemon as a sidecar, or a proxy joined to
# it. That is exactly the decision that is still open.
EXPOSE 3001

# No HEALTHCHECK, and that is a decision. Since #521 `GET /api/health` answers
# 401 to anything without a session, so the only thing a container-level probe
# could assert is "something is answering", it would need a second Node process
# every interval to say it, and the two hosts under consideration ignore the
# instruction anyway. The deployment that wants a probe should write one that
# understands 401 is the healthy answer.

# Exec form, so Node is PID 1 and receives the signal directly rather than
# through a shell that would not forward it. `web/server/index.ts` installs a
# SIGTERM handler, which is what makes the signal deliverable at all: the kernel
# discards a default-disposition signal sent to PID 1.
CMD ["node", "--enable-source-maps", "dist-server/index.js"]
