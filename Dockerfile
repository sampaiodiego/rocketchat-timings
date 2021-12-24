FROM node:17-alpine

ADD . /app

WORKDIR /app

ENV NODE_ENV=production

RUN npm install

CMD [ "npm", "start" ]
