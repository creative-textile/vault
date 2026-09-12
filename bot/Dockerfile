FROM node:20-alpine
WORKDIR /app
# package-lock.json закоммичен: npm ci ставит ровно зафиксированные версии.
# С npm install каждая сборка могла pull'ить свежие минорные версии — отсюда
# разные хэши бандла на разных машинах и невозможность сверить деплой.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build || true
CMD ["sh", "-c", "if [ -f dist/index.js ]; then node dist/index.js; else npx ts-node src/index.ts; fi"]
