FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

#Copy package files and install production dependencies
COPY src/Billing/package*.json ./
RUN npm install --omit=dev

#Copy the application source code
COPY src/Billing/ ./

#Define environment variables
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]