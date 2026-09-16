#!/usr/bin/env bash
# Восстановление headless-окружения для сборки моделей (после рестарта песочницы).
# Песочница держит только /home/user — системные установки (pip bpy, X11-стабы)
# ставятся заново этим скриптом. Debian bookworm, apt-зеркала недоступны,
# поэтому bpy берётся с PyPI, а недостающие X11/GL-библиотеки заменяются
# стабами (headless-режиму они не нужны — окно/GL не создаётся).
set -e
SUDO="sudo -n"
pip3 install --break-system-packages --quiet "bpy==4.2.0" numpy pillow || \
  pip3 install --quiet "bpy==4.2.0" numpy pillow

mkdir -p /tmp/stubs && cd /tmp/stubs
BPY_DIR=$(python3 -c "import os; os.makedirs('/usr/local/lib/python3.11/dist-packages', exist_ok=True); print('/usr/local/lib/python3.11/dist-packages/bpy')")
# Собрать недостающие символы и сделать стабы
python3 - <<'PYEOF'
import subprocess, re, os
targets = ['libGL.so.1','libGLX.so.0','libOpenGL.so.0','libICE.so.6','libSM.so.6',
           'libXfixes.so.3','libXi.so.6','libXrender.so.1','libXxf86vm.so.1',
           'libxkbcommon.so.0','libXt.so.6','libze_loader.so.1']
def missing():
    out = set()
    for root, _, files in os.walk('/usr/local/lib/python3.11/dist-packages/bpy'):
        for fn in files:
            if fn.endswith('.so'):
                r = subprocess.run(['nm','-D','--undefined-only',os.path.join(root,fn)],
                                   capture_output=True, text=True)
                for line in r.stdout.splitlines():
                    p = line.split()
                    if p: out.add(p[-1].split('@')[0])
    return out
def provided():
    out = set()
    for d in ('/usr/lib/x86_64-linux-gnu','/lib/x86_64-linux-gnu',
              '/usr/local/lib/python3.11/dist-packages/bpy/lib'):
        if not os.path.isdir(d): continue
        for fn in os.listdir(d):
            if '.so' in fn:
                r = subprocess.run(['nm','-D','--defined-only',os.path.join(d,fn)],
                                   capture_output=True, text=True)
                for line in r.stdout.splitlines():
                    p = line.split()
                    if p: out.add(p[-1].split('@')[0])
    return out
need = sorted(missing() - provided())
PREFIX = re.compile(r'^(gl[A-Z_]|glX|glu|egl|EGL|Ice|Sm[A-Z]|XRender|XF86Vid|XFixes|Xfixes|xkb|Xt[A-Z]|XtApp|ze[A-Z]|XGrab|XUngrab|XAllow|XI[A-Z]|XSelect|XOpen|glut)')
need = [s for s in need if PREFIX.match(s)]
with open('stubs.c','w') as f:
    f.write('void *__arena_data = 0;\n')
    for s in need:
        if not re.match(r'^[A-Za-z_]\w*$', s): continue
        if s in ('glXGetProcAddress','glXGetProcAddressARB'):
            f.write(f'void *{s}(void *n) {{ return n; }}\n')
        else:
            f.write(f'void {s}(void) {{ }}\n')
print('stub symbols:', len(need))
PYEOF
gcc -shared -fPIC -o stubs.so stubs.c
for L in libGL.so.1 libGLX.so.0 libOpenGL.so.0 libICE.so.6 libSM.so.6 libXfixes.so.3 \
         libXi.so.6 libXrender.so.1 libXxf86vm.so.1 libxkbcommon.so.0 libXt.so.6 libze_loader.so.1; do
  $SUDO cp stubs.so /usr/lib/x86_64-linux-gnu/$L
done
$SUDO ldconfig
# Итеративно добить единичные недостающие символы (могут всплыть при импорте)
for i in $(seq 1 60); do
  if python3 -c "import bpy" 2>/dev/null; then echo "bpy OK"; break; fi
  SYM=$(python3 -c "import bpy" 2>&1 | grep -o 'undefined symbol: \w*' | head -1 | awk '{print $3}')
  [ -z "$SYM" ] && { echo "bpy import error other than symbols:"; python3 -c "import bpy" 2>&1 | tail -3; exit 1; }
  echo "stubbing $SYM"
  echo "void $SYM(void) { }" >> stubs.c
  gcc -shared -fPIC -o stubs.so stubs.c
  for L in libGL.so.1 libGLX.so.0 libOpenGL.so.0 libICE.so.6 libSM.so.6 libXfixes.so.3 \
           libXi.so.6 libXrender.so.1 libXxf86vm.so.1 libxkbcommon.so.0 libXt.so.6 libze_loader.so.1; do
    $SUDO cp stubs.so /usr/lib/x86_64-linux-gnu/$L
  done
done
python3 -c "import bpy; print('bpy', bpy.app.version_string)"
