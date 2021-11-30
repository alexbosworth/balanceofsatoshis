FROM node:alpine

# UID / GID 1000 is default for user `node` in the `node:latest` image, this
# way the process will run as a non-root user
ARG USER_ID=1000
ARG GROUP_ID=1000
ENV USER_ID=$USER_ID
ENV GROUP_ID=$GROUP_ID

WORKDIR /app/

RUN chown -R $USER_ID:$GROUP_ID /app/

USER $USER_ID:$GROUP_ID

COPY . /app/

RUN npm ci --production

ENTRYPOINT [ "/app/bos" ]
