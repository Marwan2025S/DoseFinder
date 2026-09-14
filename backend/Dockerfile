FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

# Use nodemon for development if docker-compose mounts volumes,
# otherwise use standard node command.
CMD ["npm", "run", "dev"]
