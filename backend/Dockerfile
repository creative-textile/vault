FROM node:20-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Moscow

WORKDIR /app

# package-lock.json закоммичен: npm ci ставит ровно зафиксированные версии.
# С npm install каждая сборка могла pull'ить свежие минорные версии — отсюда
# разные хэши бандла на разных машинах и невозможность сверить деплой.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8000

CMD ["npm", "start"]
