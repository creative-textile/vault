FROM node:20-alpine
WORKDIR /app
# package-lock.json закоммичен: npm ci ставит ровно зафиксированные версии.
# С npm install каждая сборка могла pull'ить свежие минорные версии — отсюда
# разные хэши бандла на разных машинах и невозможность сверить деплой.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Сборка больше НЕ «|| true»: раньше ошибка компиляции молча проглатывалась,
# а CMD падал в ветку `npx ts-node src/index.ts` — ts-node в зависимостях бота
# нет (только ts-node-dev), поэтому контейнер либо уходил в сеть за пакетом,
# либо не запускался вовсе. Провалилась сборка — образ не собирается.
RUN npm run build
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
