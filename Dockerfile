# todouz — local-first life OS. Node + Express + better-sqlite3.
# Debian-slim (not alpine): better-sqlite3 ships prebuilt glibc binaries, so
# no compiler toolchain is needed in the image.
FROM node:22-slim

WORKDIR /app

# Install deps. Two things here are load-bearing for the in-app agent chat:
#
#  1. --include=optional — the agent SDK ships its native CLI as
#     platform-specific optional dependencies. Without them the chat dies with
#     "Native CLI binary for linux-x64 not found".
#
#  2. The musl purge + explicit glibc install. The SDK probes
#     `claude-agent-sdk-linux-<arch>-musl` BEFORE `claude-agent-sdk-linux-<arch>`,
#     which misfires on this glibc image (it resolves the musl package, then
#     can't run/find the binary inside it). We remove the musl packages so the
#     probe falls through to glibc, and force-install the glibc binary matching
#     the SDK's own version so it's always present regardless of how npm's libc
#     detection behaves in the build sandbox.
COPY package.json package-lock.json ./
# NOTE: the SDK's package.json must be read with fs, NOT require() — the package
# ships an `exports` map that doesn't expose ./package.json, so require() dies
# with ERR_PACKAGE_PATH_NOT_EXPORTED. (Its platform sub-packages DO allow
# subpath resolution, which is why the final assert below can use require.resolve.)
RUN npm ci --omit=dev --include=optional \
 && SDK_V="$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@anthropic-ai/claude-agent-sdk/package.json','utf8')).version")" \
 && ARCH="$(node -p "process.arch")" \
 && echo "agent SDK ${SDK_V} on linux-${ARCH}" \
 && npm install --no-save --force --omit=dev "@anthropic-ai/claude-agent-sdk-linux-${ARCH}@${SDK_V}" \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl \
           node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl \
 && chmod +x "node_modules/@anthropic-ai/claude-agent-sdk-linux-${ARCH}/claude" \
 && node -e "const fs=require('fs');const p=require.resolve('@anthropic-ai/claude-agent-sdk-linux-'+process.arch+'/claude');fs.accessSync(p,fs.constants.X_OK);console.log('✓ agent SDK native binary executable:',p)"

# App code + docs + the repo's data snapshot (used to seed the volume on
# first boot — see entrypoint.sh).
COPY mcp-server ./mcp-server
COPY dashboard ./dashboard
COPY scripts ./scripts
COPY data ./data-seed
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# data/ is a volume in compose — the entrypoint seeds it from data-seed when empty.
ENV NODE_ENV=production
ENV PORT=8765
ENV HOST=0.0.0.0
EXPOSE 8765

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "mcp-server/http-server.mjs"]
