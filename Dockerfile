#Stage 1: Build environment
FROM node:20-alpine AS build
WORKDIR /usr/src/app

#Install dependencies utilizing Docker layer caching
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

#Generate the Prisma client
RUN npm run prepare

#Copy the application source code
COPY src ./src

#Stage 2: Production environment
FROM node:20-alpine AS final
WORKDIR /usr/src/app

ENV NODE_ENV=production

#Copy package manifests and the Prisma schema
COPY package*.json ./
COPY prisma ./prisma/

#Install only production dependencies
RUN npm ci --omit=dev

#Install the Prisma CLI to enable `npx prisma db push` during application startup
RUN npm install prisma

#Generate the Prisma client for the final environment
RUN npx prisma generate

#Copy the application source code from the build stage
COPY --from=build /usr/src/app/src ./src

#Switch to the non-root 'node' user provided by the alpine image for security compliance
USER node

#Expose the defined application port
EXPOSE 5002

ENTRYPOINT ["npm", "start"]