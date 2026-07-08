FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js questions.js .
COPY public/ ./public/
EXPOSE 7860
CMD ["node", "server.js"]
