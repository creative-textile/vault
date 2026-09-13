FROM postgres:16-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Moscow

# Схема БД живёт в ОДНОМ файле рядом с кодом (backend/src/db/init.sql).
# Раньше здесь лежала вторая копия, которая разошлась с основной: в ней не было
# platform_cashbox, но было ограничение на неё — psql запускается с
# ON_ERROR_STOP=1, поэтому инициализация свежего тома обрывалась на середине,
# и объекты после этой строки не создавались вовсе.
# Контекст сборки — корень репозитория (см. docker-compose.yml).
COPY backend/src/db/init.sql /docker-entrypoint-initdb.d/init.sql
