FROM ghcr.io/puppeteer/puppeteer:25.12.0@sha256:60ad89b1d8ca14877120250b9c96694dd19a4eda5890fdbad64f4740c6a27361

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=2305
ENV GOOGLE_CLOUD_LOGGING=false

WORKDIR /service

COPY package.json /service/package.json
COPY yarn.lock /service/yarn.lock

RUN yarn install --frozen-lockfile --production=true;

# Copy app source
COPY . .

# set your port
# expose the port to outside world
EXPOSE 2305

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2305/check-status').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# start command as per package.json
CMD ["node", "src/index"]
