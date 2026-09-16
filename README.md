# Hikari

Десктопное приложение для Windows: поиск аниме, карточка тайтла, выбор озвучки и просмотр HLS. Личное использование.

Метаданные — [Shikimori API](https://shikimori.one/api/doc). Бесплатные студии без ключа: AniLiberty, AnimeVost, SameBand, Dreamerscast и каталог YummyAnime (AniDUB, AniStar, ТО Дубляжная и др.). Если озвучек нет — японский оригинал с субтитрами. Дополнительно — [Kodik API](https://kodikapi.com) (токен). Списки и оценки — вход в Shikimori.

Токен Kodik хранится только в `%APPDATA%\Hikari\config.json` и читается в main-процессе Electron. В интерфейс он не попадает.

## Требования

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) 20 или новее
- OAuth-приложение Shikimori (имя для User-Agent). Токен Kodik — по желанию

## Установка для разработки

```bat
cd Hikari
npm install
npm run dev
```

При первом запуске откройте **Настройки** и вставьте токен Kodik и User-Agent Shikimori.

## Сборка инсталлятора

```bat
cd Hikari
build.bat
```

или:

```bat
npm install
npm run dist
```

Готовый файл: `dist\Hikari Setup <версия>.exe`.

Установленная копия сама проверяет [релизы GitHub](https://github.com/denloper/Hikari/releases) и предлагает обновиться. Для публикации: поднять `version` в `package.json`, собрать `build.bat`, затем `gh release create vX.Y.Z` с установщиком, `.blockmap` и `latest.yml`.

Если `Hikari.exe` занят и сборка не перезаписывает файлы:

```bat
taskkill /IM Hikari.exe /F
build.bat
```

Не создавайте второй onefile и не переименовывайте установщик в `Hikari-new.exe`.

## Ключи

### Shikimori (User-Agent)

Публичный каталог работает без OAuth, но **каждый** запрос должен содержать `User-Agent` с именем зарегистрированного приложения. Иначе Shikimori может забанить IP.

1. Войдите на [shikimori.one/oauth/applications](https://shikimori.one/oauth/applications).
2. Создайте приложение. Redirect URI можно указать `urn:ietf:wg:oauth:2.0:oob`.
3. Скопируйте **имя приложения** в User-Agent Hikari.
4. Для списков и оценок вставьте Client ID и Secret, Redirect URI: `http://127.0.0.1:36511/oauth`, scope `user_rates`. Затем «Войти через браузер».

### Kodik

Официальный API отдаёт список озвучек и embed-ссылки. Прямой m3u8 приложение пытается получить так же, как штатный плеер Kodik. Если не вышло — открывается официальный embed.

1. Зарегистрируйтесь в кабинете [kodikapi.com](https://kodikapi.com).
2. Скопируйте токен.
3. Вставьте в Настройки Hikari. Файл: `%APPDATA%\Hikari\config.json`.

Публичный токен из скрипта плеера приложение не добывает.

### AniLiberty (AniLibria)

Ключ не нужен. Поиск: `GET https://anilibria.top/api/v1/app/search/releases`. Серии: `GET /api/v1/anime/releases/{id}` (поля `hls_720` / `hls_1080`). В списке озвучек пункт «AniLibria».

Старый `api.anilibria.tv/v3` не используется.

### AnimeVost

Ключ не нужен. Поиск и плейлист: `https://api.animevost.org/v1`. Видео — mp4 с `video.animetop.info`.

### SameBand

Ключ не нужен. Поиск по русскому названию на [sameband.studio](https://sameband.studio), серии из их Playerjs-плейлиста (HLS до 1080p).

### Dreamerscast

Ключ не нужен. Поиск JSON на [dreamerscast.com](https://dreamerscast.com), серии из плейлиста их плеера (HLS).

### YummyAnime

Ключ не нужен. Поиск и плейлист: `https://api.yani.tv`. Берутся Kodik-плееры студий, которых нет у AniLibria / AnimeVost / SameBand / Dreamerscast. Таймкоды опенинга приходят вместе с серией.

### Оригинал (если нет озвучек)

Ключ не нужен. Если AniLibria / AnimeVost / SameBand / Dreamerscast (и Kodik, если задан токен) не дали озвучку, Hikari ищет японский оригинал с субтитрами в каталоге [AnimeLib](https://anilib.me): SHIZA, Crunchyroll.Subtitles и похожие команды. Поток — их публичный Kodik-embed, тот же разбор HLS, что у Kodik.

## Горячие клавиши

- `Пробел` — пауза / воспроизведение
- `←` / `→` — перемотка на 10 секунд
- `F` — полноэкранный режим
- `P` — картинка в картинке
- `Esc` — выход из полноэкранного режима
- В плеере: качество 480/720/1080 чипами, «Пропустить опенинг», «Скачать»
- «К тайтлу» сворачивает плеер в угол — серия играет, пока листаешь каталог

## Данные на диске

| Путь | Содержимое |
| --- | --- |
| `%APPDATA%\Hikari\config.json` | токен Kodik, User-Agent, Client ID/Secret Шикимори, папка субтитров, adblock |
| `%APPDATA%\Hikari\adblock.bin` | кэш списков блокировки рекламы |
| `%APPDATA%\Hikari\shiki-oauth.json` | токены входа в Shikimori |
| `%APPDATA%\Hikari\hikari.db` | прогресс, избранное, история, кэш метаданных |
| `%APPDATA%\Hikari\posters\` | кэш обложек |

Прогресс серии пишется каждые 5 секунд и на паузе. Если до конца меньше 15 секунд, при следующем открытии серия начинается сначала (удобно перейти к следующей).

Субтитры: кнопка «Субтитры» в плеере (ASS через libass/JASSUB, SRT — overlay) или автопоиск файла в выбранной папке по шаблону `{id}_{номер}`.

Реклама во встроенном плеере Kodik режется сразу: сети вроде Яндекс.Директ/AdFox и скрипт в кадре плеера. EasyList подгружается в фоне. Выключается в Настройках → Плеер.
