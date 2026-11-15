# Медиа-инструменты Vault

Вырезание фона (хромакей) для референсов и текстур. Раньше для этого был
`setup.sh` с одноразовым venv в `/tmp` песочницы Arena; он удалён (D-125) — на
локальном ПК достаточно системного Python.

## Установка (Windows)

```powershell
py -3 -m pip install pillow numpy
npm run py:check
```

## Использование

```powershell
node tools/local/py.mjs --script tools/media/cutout-chromakey.py -- in.png out.png --mode auto --crop
```

Скрипт рассчитан на фон `#00FF00` с строгим ключом: бирюзу палитры не ест,
есть `--heal` и зачистка полостей. Подробности и самотест:

```powershell
node tools/local/py.mjs --script tools/media/test_media_tools.py
```

Правило из арт-контракта: **иконки/пиктограммы — SVG, объём — Blender,
атмосфера/фоны — генерация изображения**; сгенерированную картинку открыть
глазами до сдачи (силуэт читается в 128 px, фон пригоден для вырезания).
Лицензии: своё — без атрибуции, скачанное — строка в `CREDITS.md`.
