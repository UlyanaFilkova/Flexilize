# Context Translator

### Translate, listen to, and save text without leaving your browser tab

Context Translator is a cross-browser extension that detects the language of selected text and shows its translation, transcription where available, a translation of the surrounding sentence or paragraph, and a button to read the original aloud. Save translations locally with their context and export your vocabulary to other applications.

<img src="src/assets/global%2022.jpg" width="600" alt="Translation window for text selected on a web page" />

You can also open a standalone translator with a keyboard shortcut, type or paste your own text, and copy the result directly on the current page.

<img src="src/assets/global%203.jpg" width="600" alt="Standalone translator opened over the current web page" />

## Why use it?

- Look up unfamiliar words while reading an article, documentation, or an email, then continue where you left off.
- Build a vocabulary with the original text, translation, transcription, and context, without copying each field manually.
- Translate your own text while writing, without switching tabs.
- Download saved entries for review in Anki, work in spreadsheets, or reading and printing.

## Features

- Automatic language detection for selected text.
- Translation of words, phrases, sentences, and paragraphs.
- A standalone translator for typed or pasted text.
- Context translation for the sentence or paragraph containing the selection.
- Transcription where available and alternative translations.
- Text-to-speech playback of the original text.
- Automatic or manual saving of translations with context, transcription, the source URL, and the page title.
- Local history with a configurable limit of 1–5000 entries.
- Editing, deletion, undoing deletion, and clearing the entire history.
- Export to JSON, PDF, TXT, CSV, TSV, Anki CSV/TSV, XLSX, Markdown, or HTML.
- History, settings, and translation cache stored locally on your device.

## Settings

- Choose automatic translation on selection, a keyboard shortcut, a button next to the selection, or the browser context menu.
- Customize shortcuts for selection translation, the standalone translator, and switching translation direction.
- Configure the standalone translator's source and target languages separately from the target language for selection translation.
- Keep the previous text and translation when reopening the standalone translator.
- Enable or disable transcription and text-to-speech controls.
- Adjust playback speed from 0.3× to 2×.
- Choose automatic saving or save individual translations manually.
- Set the history limit and enable or disable rotation. With rotation enabled, new entries replace the oldest ones when the limit is reached. With rotation disabled, saving pauses until space is freed.

## Browser support

- Google Chrome
- Yandex Browser
- Mozilla Firefox
- Microsoft Edge
- Chromium
- Opera

The project produces Chromium Manifest V3 and Firefox Manifest V2 builds.

## Interface and translation languages

The interface supports **36 languages**: Russian, English, German, French, Spanish, Japanese, Dutch, Italian, Portuguese, Indonesian, Hindi, Polish, Chinese (Simplified and Traditional), Korean, Turkish, Vietnamese, Czech, Romanian, Swedish, Danish, Norwegian, Finnish, Hungarian, Greek, Malay, Filipino, Arabic, Persian, Hebrew, Georgian, Croatian, Slovenian, Slovak, Albanian, and Serbian.

The initial interface language follows your browser's language and can be changed in settings. Arabic, Persian, and Hebrew use a right-to-left layout.

There are **58 translation languages**. The interface language and translation languages are configured independently. Illustrations use English as the foreign language, except in the English interface, where they use Spanish.

Interface strings live in `src/locales/*.json` under stable English keys. Keep the Russian and English source catalogs up to date. To generate missing entries in the other locale catalogs, run:

```bash
node scripts/generate-interface-locales.mjs
```

The generator fills missing entries; it does not refresh existing translations automatically. Store listing descriptions are in [`store-listings/`](store-listings/).

## Build from source

Node.js 22.12 or newer is required. The recommended version is specified in [`.nvmrc`](.nvmrc).

Clone the repository, install dependencies, and build both browser versions:

```bash
git clone https://github.com/UlyanaFilkova/Flexilize.git
cd Flexilize
nvm install
npm ci
npm run build:chrome
npm run build:firefox
```

For an existing checkout, run `git pull`, then repeat `npm ci` and the build commands.

Unpacked builds are written to `dist/chrome/` and `dist/firefox/`. To create release archives:

```bash
npm run zip:chrome
npm run zip:firefox
```

## Continuous integration

The [CI workflow](.github/workflows/ci.yml) runs on every pull request, every push to `main`, and manual runs from the Actions tab. It installs dependencies with `npm ci`, checks TypeScript, runs tests with coverage, builds both browser versions, and retains the builds as artifacts for 14 days.

Run the same checks locally with:

```bash
npm ci
npm run ci
```

## Releases

The [CD workflow](.github/workflows/cd.yml) runs when a version tag such as `v1.2.3` is pushed. It verifies that the tag matches the versions in `package.json` and `src/manifest.json`, checks TypeScript, builds Chrome and Firefox ZIP archives, creates a source archive for Mozilla review, and publishes the archives in a GitHub Release with automatically generated release notes.

To release a version, update `version` to the same value in `package.json` and `src/manifest.json`, merge the change into `main`, then create and push the tag:

```bash
npm run release:check -- v1.2.3
git tag v1.2.3
git push origin v1.2.3
```

The workflow does not publish to the Chrome Web Store or Firefox Add-ons. Store submission requires the respective developer credentials.

## Tests

```bash
npm test
npm run test:watch
npm run test:coverage
```

Coverage reports are written to `coverage/`. The coverage command enforces a minimum of 65% for lines, branches, functions, and statements. CI runs the type check, coverage tests, and both browser builds.

## Saving and exporting

By default, translations are saved immediately in `storage.local` and remain available after a browser restart. You can turn off automatic saving and save selected translations with the Save button instead.

Click the extension icon to open your history, then use the export section to choose a format and download all entries. Export is initiated by you; the extension does not continuously append data to a file on disk.

The default history limit is 5000 entries. You can change it and control automatic rotation in the Saving settings. Individual entries can be deleted, or the entire history can be cleared through the extension interface.

## Services and browser APIs

- **Google Translate and the browser's language detection API**, with a writing-system fallback, detect the source language.
- **Google's translation service and the MyMemory fallback API** translate text and context. For English-to-Russian translations, inflected English words can also be looked up by their base form.
- **Datamuse API** supplies IPA transcription for English words and phrases of up to 30 words. ARPAbet responses are converted to IPA.
- **Free Dictionary API** provides fallback IPA transcription.
- **English Wiktionary** supplies English-to-Russian translation alternatives grouped by part of speech. Context helps determine their order.
- **Google Translate TTS and Web Speech API** read the source text aloud, with a fallback to a browser voice.
- Standard **`runtime` and `storage` APIs**, used with `async`/`await`, support Chromium and Firefox builds.

Translation and dictionary transcription require an internet connection. Content scripts cannot run on internal browser pages such as `chrome://…` because of browser restrictions.

English Wiktionary data is available under the Wikimedia project's licenses. Source: [English Wiktionary](https://en.wiktionary.org/).

## Privacy

Context Translator processes the selected or entered text, surrounding context, selected languages, translation results, and transcription needed for its features. History entries also contain the source page's URL and title. History, settings, and translation cache remain on your device; this locally stored data is not automatically uploaded to the developer's server.

For translation, language detection, transcription, and speech, text is sent over HTTPS to the relevant services: MyMemory, Google Translate, Datamuse, Free Dictionary, and English Wiktionary. The source page's URL and title are not included in these requests. Service providers may receive your IP address and process it according to their own privacy policies.

If you submit feedback through the extension, the message, optional contact information, and any screenshots you attach are sent to the feedback service.

The extension does not sell user data or use it for advertising, credit decisions, or purposes unrelated to its core features. You can delete individual entries or clear your history in the extension. To remove all history, settings, and local cache, uninstall the extension or clear its data through your browser.
