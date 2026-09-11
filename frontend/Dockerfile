# Стадия 1: сборка
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Стадия 2: раздача через Nginx (с reverse-proxy для API и WebSocket)
FROM nginx:alpine

# Копируем собранные статические файлы
COPY --from=build /app/dist /usr/share/nginx/html

# Копируем конфиг Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
