FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

COPY prisma ./prisma

RUN npm install

RUN npx prisma generate

COPY . .

EXPOSE 5002

CMD sh -c "npx prisma db push --accept-data-loss && node src/index.js"