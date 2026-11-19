FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /source
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/http/package.json ./packages/http/
COPY packages/server/package.json ./packages/server/
COPY packages/react/package.json ./packages/react/
COPY packages/react-native/package.json ./packages/react-native/
COPY examples/web/package.json ./examples/web/
COPY examples/mobile/package.json ./examples/mobile/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build --workspace @won005/feedback-core && npm run build --workspace @won005/feedback-server
RUN npm pack --workspace @won005/feedback-core --pack-destination /tmp && npm pack --workspace @won005/feedback-server --pack-destination /tmp

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --from=build /tmp/won005-feedback-core-0.1.0.tgz /tmp/won005-feedback-server-0.1.0.tgz /tmp/
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund /tmp/won005-feedback-core-0.1.0.tgz /tmp/won005-feedback-server-0.1.0.tgz && mkdir /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["node", "/app/node_modules/@won005/feedback-server/dist/cli.js"]
CMD ["serve"]
