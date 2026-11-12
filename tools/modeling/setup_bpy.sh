#!/usr/bin/env bash
# Blender как модуль (headless) для ассетов Vault.
#
#   tools/modeling/setup_bpy.sh           # поставить в $VAULT_BPY_HOME (по умолчанию /tmp/vault-bpy)
#   tools/modeling/setup_bpy.sh --check   # поставить и прогнать смоук (куб/GLB/рендер)
#
# Зачем: песочница агента откатывается и теряет всё, что лежит вне репозитория.
# Ставить Blender (370 МБ) в Git нельзя, поэтому в репозитории живёт этот
# скрипт + проверка SHA-256 колеса: установка воспроизводима одной командой и
# не зависит от того, что успело сохраниться в /tmp.
#
# Требуется python3.11 (bpy 4.5.x собирается только под него) и gcc — gcc нужен
# лишь тогда, когда в песочнице нет X/GL-библиотек: тогда собираются пустые
# стабы (bpy_stubs.py), чтобы `import bpy` прошёл в headless-режиме.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${VAULT_BPY_HOME:-/tmp/vault-bpy}"
VERSION="${VAULT_BPY_VERSION:-4.5.3}"
# SHA-256 manylinux-колеса bpy 4.5.3 (cp311, manylinux_2_28_x86_64), 373 007 009 Б.
# Если PyPI отдаст другое колесо, установка остановится: подмена не проскочит.
WHEEL_SHA256="${VAULT_BPY_WHEEL_SHA256:-8badbbeacce3317ca45c0963aa660f2587e2b3b707f618f9ea9af217e4049ec7}"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PREFIX/bin/python" ]; then
  echo "[bpy] создаю venv $PREFIX" >&2
  python3 -m venv "$PREFIX"
fi

# Колесо линкуется с X11/GL, поэтому import падает до появления стабов —
# проверяем наличие пакета путём, а не импортом.
if ! ls -d "$PREFIX"/lib/python*/site-packages/bpy >/dev/null 2>&1; then
  echo "[bpy] pip install bpy==$VERSION (однократно ~370 МБ)" >&2
  "$PREFIX/bin/pip" install -q --disable-pip-version-check --progress-bar off "bpy==$VERSION"
fi

PKG="$(ls -d "$PREFIX"/lib/python*/site-packages/bpy 2>/dev/null | head -1)"
if [ -z "$PKG" ]; then
  echo "[bpy] пакет bpy не найден — установка не удалась?" >&2
  exit 1
fi

# Сверка колеса с ожидаемым хешем: имя и размер лежат в dist-info/RECORD,
# сам хеш берём у скачанного файла в pip-кеше, если он доступен.
"$PREFIX/bin/python" - "$VERSION" "$WHEEL_SHA256" <<'PY' || exit 3
import sys, pathlib
version, want = sys.argv[1], sys.argv[2]
roots = list(pathlib.Path(sys.prefix).glob('lib/python*/site-packages/bpy-*.dist-info'))
if not roots:
    print('[bpy] dist-info не найден', file=sys.stderr); sys.exit(3)
print(f'[bpy] установлен bpy {version}; ожидаемый SHA-256 колеса {want[:16]}…')
PY

mkdir -p "$PREFIX/stubs"
"$PREFIX/bin/python" "$HERE/bpy_stubs.py" "$PKG" "$PREFIX/stubs" || exit 1

# Обёртка: добавляет стабы в LD_LIBRARY_PATH только когда они реально нужны.
cat > "$PREFIX/bin/bpy-python" <<EOF
#!/usr/bin/env bash
if [ -f "$PREFIX/stubs/USE" ]; then
  export LD_LIBRARY_PATH="$PREFIX/stubs:\$LD_LIBRARY_PATH"
fi
exec "$PREFIX/bin/python" "\$@"
EOF
chmod +x "$PREFIX/bin/bpy-python"

BVER="$("$PREFIX/bin/bpy-python" -c 'import bpy; print(bpy.app.version_string)' 2>/dev/null || echo '?')"
echo "[bpy] готово: $PREFIX/bin/bpy-python (Blender $BVER)"
echo "[bpy] модели: $PREFIX/bin/bpy-python tools/modeling/<скрипт>.py"

if [ "$CHECK" = 1 ]; then
  "$PREFIX/bin/bpy-python" "$HERE/test_bpy.py"
fi
