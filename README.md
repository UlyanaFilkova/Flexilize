# Context Translator — кроссбраузерное расширение

### Мгновенный перевод, прослушивание и сохранение фрагментов текста на любом языке

Расширение автоматически определяет язык выделенного текста на веб-странице, показывает перевод, транскрипцию, контекстный перевод всего предложения или абзаца и озвучку на исходном языке. Каждый выделенный фрагмент автоматически сохраняется в локальном хранилище расширения, откуда все переводы вместе с контекстом можно скачать в JSON, PDF, TXT, CSV, TSV, Anki CSV/TSV, XLSX, Markdown или HTML.

<img src="src/assets/Frame%202.jpg" width="500" alt="" />   <img src="src/assets/Frame%201.jpg" width="500" alt="" />

Вторая опция - мгновенный вызов переводчика горячими клавишами прямо на странице:

<img src="src/assets/Frame%202.jpg" width="600" alt="" />

## Для чего это нужно:
1) Когда вы читаете текст на иностранном языке, у вас нет времени заносить все слова в словарь, тем более записывая не только слово, но и контекст, в котором оно было использовано. Вы хотите быстро узнать перевод незнакомого слова и двигаться дальше.

2) Расширение позволяет автоматически сохранять все необходимые данные в файл, из которого вы сможете сделать словарь.

3) Мгновенный вызов переводчика позволяет быстро напечатать и перевести текст, не покидая текущую вкладку браузера.

## Разработка

Требуется Node.js 22.12+.

```bash
npx extension dev --browser=chrome     # запуск Chrome с горячей перезагрузкой
npx extension dev --browser=firefox    # запуск Firefox
```

## Сборка

```bash
npx extension build --zip              # готовые архивы для обоих браузеров
npx extension build --browser=firefox --zip
```

Результат сборки:

- `dist/chrome/` и `dist/firefox/` — распакованные сборки;
- `release/chrome/` — стабильная локальная Chrome-сборка, созданная командой `npm run release:chrome`;
- `dist/context-translator-1.1.2-chrome.zip` и `dist/context-translator-1.1.2-firefox.zip` — архивы для установки и публикации.

## Continuous Integration

Workflow `.github/workflows/ci.yml` запускается для каждого pull request, каждого push в `main` и вручную на вкладке Actions. Он устанавливает зависимости через `npm ci`, проверяет TypeScript, собирает версии для Chromium и Firefox и сохраняет обе сборки как артефакт на 14 дней. Firefox-сборка также проверяется `addons-linter` средствами Extension.js.

Тот же набор проверок можно запустить локально:

```bash
npm ci
npm run ci
```

## Continuous Delivery

Workflow `.github/workflows/cd.yml` запускается при отправке тега формата `v1.2.3`. Он проверяет совпадение версии тега с `package.json` и `src/manifest.json`, проверяет TypeScript, собирает ZIP для Chrome и Firefox, архив исходного кода для проверки Mozilla и публикует их в GitHub Release с автоматически сформированным описанием изменений.

Для выпуска новой версии обновите одинаковое значение `version` в `package.json` и `src/manifest.json`, влейте изменение в `main`, затем создайте и отправьте тег:

```bash
npm run release:check -- v1.2.3
git tag v1.2.3
git push origin v1.2.3
```

Публикация в Chrome Web Store и Firefox Add-ons в этот workflow не входит: для неё потребуются ключи разработчика соответствующих магазинов.

## Mozilla source-code review build instructions

The submitted Firefox extension is compiled from TypeScript and React source code with Extension.js. No environment variables, credentials, or external services are required during the build.

Build environment used for the submitted package:

- Ubuntu Linux 22.04 x86-64;
- Node.js 22.19.0, pinned in `.nvmrc`;
- npm 10.9.3, pinned in `package.json`;
- dependencies pinned in `package-lock.json` and downloaded from the official npm registry.

Install Node.js with [nvm](https://github.com/nvm-sh/nvm), then install the exact version required by the project:

```bash
nvm install 22.19.0
nvm use 22.19.0
node --version
npm --version
```

From the root of the extracted source archive, install the locked dependencies and build the Firefox submission package:

```bash
npm ci
npm run zip:firefox
```

The complete build is performed by the `zip:firefox` script in `package.json`. The resulting extension package is:

```text
dist/context-translator-1.1.2-firefox.zip
```

## Установка

Chrome / Edge:

1. Остановите запущенный dev-сервер и создайте стабильную production-сборку командой `npm run release:chrome`.
2. Откройте `chrome://extensions`.
3. Включите **Режим разработчика**.
4. Нажмите **Загрузить распакованное расширение** и выберите папку `release/chrome`.

`release/chrome` больше не изменяется при последующем запуске `npm run dev:chrome`. Команда `npm run release:chrome` также проверяет, что в стабильную копию не попали HMR-файлы, `dev-stub` или dev-манифест. После каждой новой production-сборки нажмите **Обновить** на карточке уже установленного расширения или установите его заново.

При первом переходе с `dist/chrome` на `release/chrome` Chrome установит её как отдельную локальную копию расширения, потому что идентификатор распакованного расширения зависит от пути. Её настройки и история будут храниться отдельно от dev-версии; в дальнейшем путь `release/chrome` остаётся постоянным и данные сохраняются между обновлениями.

Firefox:

1. Откройте `about:debugging#/runtime/this-firefox`.
2. Нажмите **Загрузить временное дополнение** и выберите `dist/firefox/manifest.json`.

После установки выделите слово или фразу на иностранном языке на любой веб-странице. Появится модальное окно с переводом на русский, и перевод сразу сохранится в локальное хранилище расширения.

Модальное окно закрывается кликом вне него, при прокрутке или потере фокуса вкладки.

## Тесты

```bash
npm test
npm run test:watch
npm run test:coverage
```

Покрытие сохраняется в `coverage/`. Команда с покрытием проверяет минимальный порог 65% для строк, ветвей, функций и выражений. В CI автоматически выполняются проверка типов, тесты с покрытием и сборки для Chrome и Firefox.

## Сохранение и экспорт

Записи сохраняются немедленно через `storage.local` и остаются после перезапуска браузера. Нажмите значок расширения, чтобы просмотреть список, выбрать формат и скачать историю. Это надёжнее автоматического скачивания нового файла при каждом выделении: браузеры не разрешают веб-расширению без постоянного пользовательского разрешения произвольно дописывать данные в файл на диске.

Хранится не более 5000 последних записей. По умолчанию история ротируется автоматически; это можно отключить в разделе настроек «Сохранение». Список можно очистить из popup-окна.

## Используемые возможности

- Web Speech API — озвучка наиболее естественным доступным голосом нужного языка;
- API определения языка браузера и резервное определение по письменности — выбор исходного языка для каждого выделенного фрагмента;
- MyMemory API — контекстный перевод с автоматически определённого языка на русский; для английских слов варианты очищаются от нерелевантных данных, а изменённые формы дополнительно ищутся по базовой форме;
- Datamuse API — основная IPA-транскрипция английских слов и фраз (до 30 слов); ответы ARPAbet автоматически преобразуются в IPA;
- Free Dictionary API — резервный источник IPA-транскрипции;
- English Wiktionary — словарные варианты перевода по частям речи; порядок вариантов уточняется по контексту;
- стандартные API `runtime` и `storage` с `async/await`, совместимые с Chrome/Edge (MV3) и Firefox (MV2).

Для перевода и словарной транскрипции требуется интернет. На системных страницах вида `chrome://…` content script не запускается — это ограничение браузера.

Словарные данные English Wiktionary доступны по лицензиям проекта Wikimedia; источник: https://en.wiktionary.org/.

## Конфиденциальность

Порядок обработки, хранения и передачи данных описан в [политике конфиденциальности](PRIVACY.md).
