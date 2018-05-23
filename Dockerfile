FROM node:10-alpine

RUN \
    mkdir /kubernetes-dashboard-proxy/

WORKDIR \
    /kubernetes-dashboard-proxy

COPY \
    package.json .

RUN \
    yarn install

COPY \
    libs libs

COPY \
    routes routes

COPY \
    public public

COPY \
    views views

COPY \
    "server.js" .

RUN \
	apk add --update \
		python2 \
		python2-dev \
		py2-pip \
		build-base \
	&& \
	pip install dumb-init && \
	apk del \
		python2 \
		python2-dev \
		py2-pip \
		build-base \
	&& \
	rm -rf /var/cache/apk/* && \
	:

# Runs "/usr/bin/dumb-init -- /my/script --with --args"
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "server.js"]

EXPOSE 3000
