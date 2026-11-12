# Аудио: источники и лицензии

Файлы в `audio/music/` и `audio/sfx/` — не синтез, а записи из открытых библиотек.
Правило репозитория: **файл без строки в этом документе в `audio/` не попадает**.

## audio/music/ — FreePD (public domain / CC0)

Источник: [freepd.com](https://freepd.com) — публичное достояние (CC0 1.0).
Авторы указаны для истории, по CC0 указание не требуется.

| Файл | Трек | Автор (из FreePD) |
|---|---|---|
| `lobby-heist.ogg` | A Good Bass for Gambling | FreePD (см. примечание) |
| `duel-tension.ogg` | Patron Saint of Heists | FreePD |
| `vault-creep.ogg` | Dark Hallway | FreePD |
| `rocket-race.ogg` | Night Attack | FreePD |
| `result-win.ogg` | Action Strike | FreePD |
| `risk-loop.ogg` | Satin Danger | FreePD |

**Примечание об авторах.** FreePD публикует треки как public domain, но конкретные авторы в
метаданных каталога не указаны единообразно; имена не выдумываются. Если Мастер захочет
юридически безупречную атрибуцию каждого трека — это делается запросом к каталогу FreePD
(страница трека), а не догадкой.

## audio/sfx/ — Oculus Audio Pack 1 (CC BY 4.0)

Точная формулировка, требуемая лицензией (из `ATTRIBUTION.md` библиотеки):

> «Oculus Audio Pack 01» by Oculus VR, LLC
> (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/),
> licensed under CC BY 4.0. Files renamed to the UCS naming convention;
> OGG previews transcoded from the original WAVs.

Источник: [facebookincubator/Meta-open-sound](https://github.com/facebookincubator/Meta-open-sound),
каталог `corpora/oculus-audio-pack/ogg/`. Оригиналы — WAV 48 кГц/16 бит; здесь перекодированы в
OGG Vorbis `-q:a 1`, метаданные удалены, стерео.

### Соответствие файлов (переименовано под игру)

| Файл в игре | Исходное имя в наборе |
|---|---|
| `ui-open.ogg` | `UIClick_ScifiHightechOpen_OS_01` |
| `ui-close.ogg` | `UIClick_ScifiHightechClose_OS_01` |
| `ui-confirm.ogg` | `UIClick_ScifiHightechConfirm_OS_01` |
| `ui-back.ogg` | `UIClick_ScifiHightechBack_OS_01` |
| `ui-error.ogg` | `UIAlert_ScifiHightechError_OS_01` |
| `ui-notify.ogg` | `UIAlert_Notification_OS_01` |
| `coin-count.ogg` | `UIData_ScifiCountup_LOOP_01` |
| `coins-pour.ogg` | `OBJCoin_CoinsUI_LOOP_01` |
| `vault-unlock.ogg` | `MECHLock_DoorUnlockKey_OS_01` |
| `vault-lever.ogg` | `MECHLvr_LeverPull_OS_01` |
| `vault-servo.ogg` | `MOTRSrvo_Servo_OS_01` |
| `vault-door-open.ogg` | `DOORMetl_GarageDoorOpen_OS_01` |
| `vault-door-close.ogg` | `DOORMetl_GarageDoorClose_OS_01` |
| `sting-win.ogg` | `MUSCStngr_VictoryElectronic_OS_01` |
| `sting-lose.ogg` | `MUSCStngr_LossOrchestral_OS_01` |
| `sting-levelup.ogg` | `MUSCStngr_LevelUpOrchestral_OS_01` |
| `sting-risk.ogg` | `MUSCStngr_LossElectronic_OS_01` |
| `laser-shot.ogg` | `LASRGun_LaserShootUI_OS_01` |
| `soft-error.ogg` | `UIAlert_CasualPopsError_OS_01` |

## Обязательства продукта

1. Экран «О проекте / Лицензии» показывает блок Oculus выше **дословно**.
2. CC0-треки FreePD указывать не обязательно, но экран лицензий их тоже перечисляет.
3. Удаление файла из `audio/` требует удаления строки здесь — иначе аудит покажет расхождение.
