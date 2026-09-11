FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build || true
CMD ["sh", "-c", "if [ -f dist/index.js ]; then node dist/index.js; else npx ts-node src/index.ts; fi"]
