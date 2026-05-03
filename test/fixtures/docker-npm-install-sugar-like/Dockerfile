FROM node:22
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm -i --omit=dev
COPY . .
