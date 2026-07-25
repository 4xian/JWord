FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm --filter @4xian/jword-license build \
  && pnpm --filter @4xian/jword-persistence build \
  && pnpm --filter @4xian/jword-collab-server build

ENV JWORD_COLLAB_HOST=0.0.0.0
ENV JWORD_COLLAB_PORT=4188
ENV JWORD_COLLAB_ALLOWED_ORIGINS=
ENV JWORD_COLLAB_MINIMUM_CLIENT_VERSION=0.0.0
ENV JWORD_COLLAB_MINIMUM_SERVER_VERSION=0.0.0

EXPOSE 4188

CMD ["node", "--input-type=module", "-e", "import { startJWordCollabServer } from '@4xian/jword-collab-server'; import { createVolatileHistoryStorage } from '@4xian/jword-persistence'; const origins = (process.env.JWORD_COLLAB_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean); const server = await startJWordCollabServer({ address: process.env.JWORD_COLLAB_HOST ?? '0.0.0.0', port: Number(process.env.JWORD_COLLAB_PORT ?? 4188), allowedOrigins: origins, minimumClientVersion: process.env.JWORD_COLLAB_MINIMUM_CLIENT_VERSION ?? '0.0.0', minimumServerVersion: process.env.JWORD_COLLAB_MINIMUM_SERVER_VERSION ?? '0.0.0', historyStorage: createVolatileHistoryStorage(), licenseHook: () => ({ ok: true }) }); console.log(JSON.stringify(server.readState()));"]
