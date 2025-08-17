## FreeSteam — поиск бесплатных игр и скидок в Steam

Агрегатор бесплатных и со скидкой игр из Steam с фронтендом на статике и серверлесс API. Данные автоматически обновляются по расписанию через GitHub Actions.

- Демо: https://<ваш-домен-на-vercel>/
- Чекер профиля Steam: https://<ваш-домен-на-vercel>/checker
- API здоровье: https://<ваш-домен-на-vercel>/api/health

### Возможности
- Сбор данных о бесплатных предложениях из Steam (парсинг HTML выдачи магазина).
- Периодическое автообновление JSON-файлов (каждый час) и автодеплой на Vercel.
- Утилиты для работы с SteamID (STEAM2/3/64, invite code) и публичные эндпоинты API.
- Чистые URL на фронте: без .html (/, /checker).

### Стек
- Python 3.11, Flask, requests, BeautifulSoup4
- Vercel (Serverless Python + статика)
- GitHub Actions (cron, автокоммит данных)

---

## Быстрый старт локально

Требования: Python 3.11+

```bash
# 1) Установить зависимости
pip install -r requirements.txt

# 2) Запустить сервер API локально
python server.py  # http://127.0.0.1:5000

# 3) Одноразово собрать данные (англ/US)
python NeedFree.py --cc us --lang english --once
```

Полезные URL локально:
- http://127.0.0.1:5000/api/health
- Откройте index.html или запустите через статический сервер IDE.

---

## Автообновление данных (GitHub Actions)
Workflow: `.github/workflows/update-free.yml`
- Расписание: каждый час (`cron: 0 * * * *`)
- Действия: устанавливает зависимости → запускает `NeedFree.py --once` → коммитит изменённые файлы:
  - `free_goods_detail.json`, `free_goods_detail_part1.json`, `free_goods_detail_part2.json`
  - `data/<lang>/free_goods_detail*.json`
- После пуша Vercel автоматически деплоит обновления.

Запуск вручную: GitHub → Actions → “Update FreeSteam data” → Run workflow.

Изменить регион/язык:
```yaml
# в шаге запуска:
python NeedFree.py --cc ru --lang russian --once
```

Изменить частоту (UTC):
```yaml
on:
  schedule:
    - cron: "*/30 * * * *"  # каждые 30 минут
```

---

## Деплой на Vercel
Файл `vercel.json` уже настроен:
- `cleanUrls: true` — страницы без .html
- redirects `/index(.html)` → `/`
- маршрутизация API: `/api/(.*)` → `api/index.py`

Шаги:
```bash
# Авторизация и линк
vercel login
vercel link

# Прод-деплой
vercel --prod --yes
```

После деплоя:
- Главная: `https://<ваш-домен>/`
- Чекер: `https://<ваш-домен>/checker`
- API: `https://<ваш-домен>/api/health`

---

## API (из `server.py`)
- `GET /api/health` — ping
- `GET /api/open_profile?input=...` — публичные данные профиля из XML SteamCommunity
- `GET /api/steamid_info?input=...` — конвертации SteamID (2/3/64, invite)
- `GET /api/inventory?steamid=...&appids=730,570&contextid=2` — инвентарь (публичный) для популярных игр
- `GET /api/screenshots?steamid=...` — последние скриншоты профиля

Пример:
```
GET /api/open_profile?input=76561198000000000
```

---

## Структура
```
FreeSteam/
├─ api/
│  └─ index.py        # WSGI-энтрипоинт (экспортирует Flask app)
├─ .github/workflows/
│  └─ update-free.yml # cron: сбор данных и автокоммит
├─ data/              # языкоспецифичные JSON (создаётся скриптом)
├─ index.html         # главная
├─ checker.html       # чекер профиля
├─ server.py          # Flask API (роуты /api/*)
├─ NeedFree.py        # краулер (флаги: --cc, --lang, --once)
├─ requirements.txt   # зависимости Python
└─ vercel.json        # конфиг Vercel (cleanUrls, redirects, routes)
```

---

## Лицензия
MIT — используйте и дорабатывайте по своему усмотрению. Буду рад PR и вопросам.
