#!/usr/bin/env bash
# Vault media toolbox: Pillow for cutout-chromakey.py in a throwaway venv.
#
#   tools/media/setup.sh            # install into $VAULT_MEDIA_HOME (default /tmp/vault-media)
#   tools/media/setup.sh --check    # install + run the self-test
#   export PATH="/tmp/vault-media/bin:$PATH"
#
# After that the following command is on PATH:
#   cutout-chromakey in.png out.png [--mode auto|color|flood|points] [--heal] ...
#
# Only pypi.org / files.pythonhosted.org are needed (no apt, no root).
# Источник: Creative36711/synapse tools/media/setup.sh (переименовано под Vault).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${VAULT_MEDIA_HOME:-/tmp/vault-media}"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PREFIX/bin/python" ]; then
  echo "[media] creating venv $PREFIX"
  python3 -m venv "$PREFIX"
fi
if ! "$PREFIX/bin/python" -c "import PIL" 2>/dev/null; then
  echo "[media] pip install pillow"
  "$PREFIX/bin/pip" install -q --disable-pip-version-check --progress-bar off pillow
fi

cat > "$PREFIX/bin/cutout-chromakey" <<EOF
#!/usr/bin/env bash
exec "$PREFIX/bin/python" "$HERE/cutout-chromakey.py" "\$@"
EOF
chmod +x "$PREFIX/bin/cutout-chromakey"

echo "[media] ready: $PREFIX/bin/cutout-chromakey"
echo "[media]   export PATH=\"$PREFIX/bin:\$PATH\""

if [ "$CHECK" = 1 ]; then
  "$PREFIX/bin/python" "$HERE/test_media_tools.py"
fi
