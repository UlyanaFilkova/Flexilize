export const INTERFACE_LANGUAGES = ["ru", "en", "de", "fr", "es", "ja", "nl", "it", "pt", "id", "hi"] as const;
export type InterfaceLanguage = typeof INTERFACE_LANGUAGES[number];

let activeLanguage: InterfaceLanguage = "ru";
const loadedCatalogs: Partial<Record<InterfaceLanguage, Record<string, string>>> = {};

const en: Record<string, string> = {
  "Все настройки": "All settings",
  "Context Translator — настройки": "Context Translator — Settings",
  "Горячие клавиши": "Keyboard shortcuts",
  "Перевод": "Translation",
  "Звук": "Sound",
  "Сохранение": "Saving",
  "Настройки": "Settings",
  "Навигация": "Navigation",
  "Переводы": "Translations",
  "История": "History",
  "Экспорт": "Export",
  "Помощь": "Help",
  "Как пользоваться": "How to use",
  "Расширение активно": "Extension is active",
  "Настройте работу расширения под себя.": "Customize the extension to suit you.",
  "Отменить": "Undo",
  "Персональная настройка": "Personal setup",
  "Переводчик, который работает по вашим правилам": "A translator that works your way",
  "Настройте языки, горячие клавиши, звук и сохранение один раз — изменения применяются сразу на всех открытых страницах.": "Set up languages, shortcuts, sound, and saving once — changes apply to every open page immediately.",
  "Начать с горячих клавиш": "Start with shortcuts",
  "Перевод по выделению": "Selection translation",
  "Включено": "Enabled",
  "на русский": "to Russian",
  "Скорость речи": "Speech rate",
  "Разделы": "Sections",
  "Что хотите настроить?": "What would you like to configure?",
  "Каждый параметр сохраняется автоматически. Вы всегда можете вернуться и изменить его.": "Every setting is saved automatically. You can return and change it at any time.",
  "Разделы настроек": "Settings sections",
  "Управляйте переводом выделенного текста и быстрым вызовом переводчика.": "Control selection translation and quickly open the translator.",
  "2 комбинации": "2 shortcuts",
  "Выберите языки и решите, показывать ли окно перевода на странице.": "Choose languages and whether to show the translation window on the page.",
  "Языки и интерфейс": "Languages and interface",
  "Настройте транскрипцию, озвучивание и комфортную скорость речи.": "Configure transcription, speech, and a comfortable playback rate.",
  "От 0,3× до 2×": "From 0.3× to 2×",
  "Определите, какие переводы попадут в историю и как управлять лимитом.": "Choose which translations are saved and how the history limit is managed.",
  "До 5000 записей": "Up to 5,000 records",
  "Настройки хранятся только на этом устройстве": "Settings are stored only on this device",
  "Расширение не отправляет их разработчику. При удалении данных расширения параметры вернутся к значениям по умолчанию.": "The extension does not send them to the developer. If extension data is deleted, settings return to their defaults.",
  "Перевод выделенного текста": "Selected text translation",
  "Активация горячими клавишами": "Activate with a keyboard shortcut",
  "Перевод будет запускаться только после нажатия выбранной комбинации на выделенном тексте.": "Translation starts only after you press the selected shortcut with text selected.",
  "Включить активацию горячими клавишами": "Enable shortcut activation",
  "Комбинация клавиш": "Keyboard shortcut",
  "Нажмите кнопку и введите новую комбинацию.": "Click the button and press a new shortcut.",
  "Нажмите клавиши…": "Press keys…",
  "Переводчик": "Translator",
  "Горячая клавиша переводчика": "Translator shortcut",
  "Горячие клавиши перевода выделенного текста": "Selected text translation shortcuts",
  "Открывает отдельное окно для ввода и перевода текста.": "Opens a separate window for entering and translating text.",
  "Добавьте к клавише Ctrl, Alt, Shift или Meta": "Add Ctrl, Alt, Shift, or Meta to the key",
  "Не удалось загрузить настройки": "Could not load settings",
  "Не удалось сохранить настройку": "Could not save the setting",
  "Показывать окно перевода": "Show translation window",
  "Если выключено, перевод от Context Translator не будет появляться на странице, но продолжит сохраняться в истории.": "When disabled, Context Translator will not appear on the page, but translations will still be saved to history.",
  "Тогда вы сможете использовать другие расширения для мгновенного перевода, а Context Translator – для сохранения переводов.": "You can then use another extension for instant translation and Context Translator for saving translations.",
  "Язык перевода выделенного текста": "Selected text target language",
  "Все выделенные тексты будут переводиться на выбранный язык.": "All selected text will be translated into the chosen language.",
  "Язык перевода": "Target language",
  "Исходный язык переводчика": "Translator source language",
  "Язык текста при открытии отдельного окна переводчика.": "The source language used when the translator window opens.",
  "Язык перевода в переводчике": "Translator target language",
  "Язык результата при открытии отдельного окна переводчика.": "The result language used when the translator window opens.",
  "Язык интерфейса": "Interface language",
  "Язык кнопок, настроек и сообщений расширения.": "Language of the extension's buttons, settings, and messages.",
  "Русский": "Russian",
  "Английский": "English",
  "Немецкий": "German", "Французский": "French", "Испанский": "Spanish", "Итальянский": "Italian",
  "Португальский": "Portuguese", "Польский": "Polish", "Украинский": "Ukrainian", "Белорусский": "Belarusian",
  "Болгарский": "Bulgarian", "Чешский": "Czech", "Словацкий": "Slovak", "Словенский": "Slovenian",
  "Сербский": "Serbian", "Хорватский": "Croatian", "Нидерландский": "Dutch", "Шведский": "Swedish",
  "Норвежский": "Norwegian", "Датский": "Danish", "Финский": "Finnish", "Эстонский": "Estonian",
  "Латышский": "Latvian", "Литовский": "Lithuanian", "Греческий": "Greek", "Турецкий": "Turkish",
  "Румынский": "Romanian", "Венгерский": "Hungarian", "Арабский": "Arabic", "Иврит": "Hebrew",
  "Персидский": "Persian", "Хинди": "Hindi", "Китайский (упрощённый)": "Chinese (Simplified)",
  "Китайский (традиционный)": "Chinese (Traditional)", "Японский": "Japanese", "Корейский": "Korean",
  "Вьетнамский": "Vietnamese", "Индонезийский": "Indonesian", "Африкаанс": "Afrikaans", "Албанский": "Albanian",
  "Армянский": "Armenian", "Азербайджанский": "Azerbaijani", "Баскский": "Basque", "Бенгальский": "Bengali",
  "Каталанский": "Catalan", "Грузинский": "Georgian", "Исландский": "Icelandic", "Ирландский": "Irish",
  "Казахский": "Kazakh", "Македонский": "Macedonian", "Малайский": "Malay", "Мальтийский": "Maltese",
  "Суахили": "Swahili", "Тайский": "Thai", "Урду": "Urdu", "Узбекский": "Uzbek", "Валлийский": "Welsh",
  "Автоматическое сохранение": "Automatic saving",
  "Сохранять каждый выполненный перевод в истории автоматически.": "Automatically save every translation to history.",
  "Если выключено, то сохранение происходит только по нажатию кнопки \"Сохранить\".": "When disabled, translations are saved only when you click the Save button.",
  "Включить автоматическое сохранение": "Enable automatic saving",
  "Ротация истории": "History rotation",
  "Включить ротацию истории": "Enable history rotation",
  "Транскрипция": "Transcription",
  "Настройки звука": "Sound settings", "Настройки сохранения": "Saving settings", "Область настроек": "Settings area",
  "Показывать транскрипцию выделенного текста.": "Show transcription for selected text.",
  "Включить транскрипцию": "Enable transcription",
  "Озвучка": "Text to speech",
  "Показывать кнопку воспроизведения озвучки для выделенного текста.": "Show a speech playback button for selected text.",
  "Включить озвучку": "Enable text to speech",
  "Скорость озвучки": "Speech rate",
  "Скорость воспроизведения озвученного текста.": "Playback rate for spoken text.",
  "Уменьшить скорость озвучки": "Decrease speech rate",
  "Увеличить скорость озвучки": "Increase speech rate",
  "История переводов": "Translation history",
  "Загрузка…": "Loading…",
  "Очистить историю": "Clear history",
  "Пока пусто": "Nothing here yet",
  "Выделите текст на любой странице — перевод появится здесь.": "Select text on any page and its translation will appear here.",
  "Редактировать запись": "Edit record", "Удалить запись": "Delete record",
  "Оригинал": "Original", "Контекст": "Context", "Перевод контекста": "Context translation",
  "Другие варианты перевода — по одному на строке": "Other translations — one per line",
  "Название источника": "Source title", "Ссылка на источник": "Source URL",
  "Отмена": "Cancel", "Сохранение…": "Saving…", "Сохранить": "Save",
  "Выберите формат": "Choose a format", "Подготовка…": "Preparing…", "Скачать файл": "Download file",
  "Практическое руководство: от первого перевода до личного словаря и экспорта в Anki.": "A practical guide from your first translation to a personal vocabulary and Anki export.",
  "Быстрый старт": "Quick start", "Первый перевод — за несколько секунд": "Your first translation in seconds",
  "Откройте обычную веб-страницу": "Open a regular web page",
  "Статья, документация, письмо или учебный материал — подойдёт любой доступный сайт.": "An article, documentation, email, or learning material — any accessible website will do.",
  "Выделите нужный текст": "Select the text you need", "Можно выбрать одно слово, фразу или целый абзац.": "You can select a word, phrase, or entire paragraph.",
  "Изучите результат": "Review the result", "В окне появятся перевод, контекст, варианты значения, транскрипция и кнопка озвучивания.": "The window shows the translation, context, alternatives, transcription, and speech button.",
  "контекст имеет значение": "context matters", "Слушать": "Listen", "Сохранено": "Saved",
  "Содержание справки": "Help contents", "Чтение": "Reading", "Перевод выделения": "Selection translation",
  "Ввод своего текста": "Enter your own text", "Произношение": "Pronunciation", "Транскрипция и звук": "Transcription and sound",
  "Словарь": "Vocabulary", "История и экспорт": "History and export",
  "Задача 01": "Task 01", "Задача 02": "Task 02", "Задача 03": "Task 03", "Задача 04": "Task 04", "Задача 05": "Task 05",
  "Читаете текст на иностранном языке": "Reading text in another language",
  "Используйте перевод выделения, чтобы не переключаться между вкладками и не терять место в тексте.": "Translate selections without switching tabs or losing your place.",
  "Слово или короткая фраза": "A word or short phrase", "Выделите фрагмент мышью или клавиатурой.": "Select a fragment with the mouse or keyboard.",
  "Изучите основной и дополнительный перевод": "Review the primary and alternative translations", "Сверьте с переводом контекста.": "Compare it with the context translation.",
  "Совет:": "Tip:", "выделяйте слово прямо в предложении — расширение сохранит окружающий контекст вместе с переводом.": "select a word inside its sentence so the extension saves the surrounding context with the translation.",
  "Предложение или абзац": "A sentence or paragraph", "Выделите текст целиком.": "Select all of the text.",
  "Для длинного фрагмента основным результатом станет перевод всего выделения.": "For a long passage, the primary result is the translation of the whole selection.",
  "Проверьте границы выделения, если смысл кажется неполным.": "Check the selection boundaries if the meaning seems incomplete.",
  "Полезно для:": "Useful for:", "статей, документации, учебников и деловой переписки.": "articles, documentation, textbooks, and business correspondence.",
  "Не хотите открывать окно при каждом выделении?": "Don't want a window for every selection?",
  "Включите активацию горячими клавишами: тогда перевод запускается только после вашей комбинации. Это удобно при копировании и редактировании текста.": "Enable shortcut activation so translation starts only after your key combination. This is convenient when copying and editing text.",
  "Настроить клавиши": "Configure shortcuts",
  "Нужно перевести собственный текст": "Need to translate your own text",
  "Откройте отдельный переводчик поверх текущей страницы, напечатайте или вставьте текст и продолжайте работу в той же вкладке.": "Open the translator over the current page, type or paste text, and keep working in the same tab.",
  "Вызовите переводчик": "Open the translator", "Нажмите назначенную горячую клавишу. По умолчанию комбинацию можно посмотреть или изменить в настройках.": "Press the assigned shortcut. You can view or change it in settings.",
  "Выберите языки": "Choose languages", "Исходный язык и язык результата для переводчика настраиваются отдельно от перевода выделений.": "Translator source and target languages are configured separately from selection translation.",
  "Введите текст": "Enter text", "Напечатайте фразу или вставьте её из буфера обмена, затем используйте готовый перевод.": "Type a phrase or paste it from the clipboard, then use the finished translation.",
  "Открыть настройки языков": "Open language settings",
  "Тренируете произношение и восприятие на слух": "Practising pronunciation and listening",
  "Для поддерживаемых языков расширение показывает транскрипцию и озвучивает исходный фрагмент.": "For supported languages, the extension shows transcription and reads the source text aloud.",
  "Посмотрите транскрипцию": "View the transcription", "Она отображается рядом с исходным текстом, если доступна для выбранного языка и фрагмента.": "It appears next to the source text when available for that language and passage.",
  "Прослушайте оригинал": "Listen to the original", "Нажмите кнопку звука в окне перевода и повторите фразу вслух.": "Click the sound button in the translation window and repeat the phrase aloud.",
  "Подберите темп": "Choose a pace", "В разделе «Звук» установите скорость от 0,3× для разбора речи до 2× для тренировки.": "In Sound settings, choose from 0.3× for careful listening to 2× for practice.",
  "Настроить звук и транскрипцию": "Configure sound and transcription",
  "Собираете личный словарь": "Building a personal vocabulary",
  "Переводы сохраняются локально вместе с контекстом, источником и датой — их можно повторять, исправлять и выгружать.": "Translations are stored locally with context, source, and date, ready to review, edit, and export.",
  "Организуйте рабочий процесс": "Organize your workflow", "Автосохранение": "Automatic saving", "Ручное сохранение": "Manual saving", "Редактирование": "Editing", "Ротация": "Rotation",
  "— каждый перевод сразу попадает в историю.": "— every translation goes straight to history.", "— в словарь попадают только выбранные вами записи.": "— only records you choose are added to your vocabulary.",
  "— уточняйте перевод, контекст, транскрипцию и источник.": "— refine the translation, context, transcription, and source.", "— при лимите в 5000 записей старые переводы могут автоматически заменяться новыми.": "— at the 5,000-record limit, older translations can be replaced automatically.",
  "Открыть историю": "Open history", "Просмотреть и отредактировать записи": "View and edit records", "Настроить сохранение": "Configure saving", "Автосохранение и ротация истории": "Automatic saving and history rotation",
  "Переносите переводы в другие приложения": "Move translations to other apps", "Экспортируйте всю историю в подходящем формате. Файл создаётся по вашему запросу и сохраняется через браузер.": "Export your whole history in a suitable format. The file is created on request and saved by your browser.",
  "Для интервального повторения": "For spaced repetition", "Anki CSV или Anki TSV — готовая основа для импорта карточек.": "Anki CSV or Anki TSV is ready for card import.",
  "Для таблиц и анализа": "For spreadsheets and analysis", "Подойдут для Excel, Google Таблиц, сортировки и собственной обработки.": "Suitable for Excel, Google Sheets, sorting, and custom processing.",
  "Для чтения и печати": "For reading and printing", "Удобны для архива, заметок, печати и повторения без расширения.": "Convenient for archives, notes, printing, and review without the extension.",
  "Для резервной копии": "For backups", "Сохраняет структурированные данные записей для технических сценариев.": "Preserves structured record data for technical workflows.",
  "Перейти к экспорту": "Go to export", "Если что-то не работает": "If something isn't working", "Частые вопросы": "Frequently asked questions",
  "Окно перевода не появляется после выделения": "The translation window does not appear after selecting text",
  "Проверьте настройку «Показывать окно перевода». Если включена активация горячими клавишами, после выделения нужно нажать назначенную комбинацию. Обновите вкладку после установки или обновления расширения. На служебных страницах браузера вида": "Check “Show translation window”. If shortcut activation is enabled, press the assigned shortcut after selecting text. Reload the tab after installing or updating the extension. Extensions do not run on browser pages such as",
  "расширения не запускаются.": ".",
  "Перевод или озвучивание не загружается": "Translation or speech does not load", "Новая запись не появилась в истории": "A new record did not appear in history",
  "Этим функциям нужен интернет. Проверьте соединение и повторите попытку. Некоторые сайты также могут ограничивать работу встроенных элементов; в таком случае откройте другой сайт и сравните результат.": "These features require an internet connection. Check your connection and try again. Some sites may restrict embedded elements; compare the result on another site.",
  "Проверьте режим сохранения. При ручном режиме нажмите кнопку сохранения в окне перевода. Если ротация выключена и достигнут лимит 5000 записей, удалите ненужные записи или включите автоматическую ротацию.": "Check the saving mode. In manual mode, click Save in the translation window. If rotation is disabled and the 5,000-record limit has been reached, delete unneeded records or enable automatic rotation.",
  "Горячая клавиша конфликтует с сайтом или браузером": "The shortcut conflicts with the website or browser", "Где хранятся мои данные?": "Where is my data stored?",
  "Откройте «Горячие клавиши», нажмите кнопку с текущей комбинацией и задайте другую с Ctrl, Alt, Shift или Meta. Выбирайте сочетание, которое не используется браузером и текущим сайтом.": "Open Keyboard shortcuts, click the current combination, and enter another one using Ctrl, Alt, Shift, or Meta. Choose a shortcut not used by the browser or current website.",
  "История, настройки и кэш хранятся локально на вашем устройстве. Удаляйте отдельные записи в истории, очищайте весь список одной кнопкой или удалите данные расширения средствами браузера.": "History, settings, and cache are stored locally on your device. Delete individual records, clear the list, or remove extension data using your browser.",
  "Готовы попробовать?": "Ready to try it?", "Откройте любую статью и выделите незнакомую фразу.": "Open any article and select an unfamiliar phrase.", "Проверить горячие клавиши": "Check keyboard shortcuts",
  "Мои переводы": "My translations", "Сохранённые переводы": "Saved translations", "Открыть историю переводов": "Open translation history", "Открыть настройки": "Open settings", "Очистить список": "Clear list", "Формат экспорта": "Export format", "Скачать JSON": "Download JSON",
  "Закрыть": "Close", "Исходный язык": "Source language", "Поменять языки местами": "Swap languages", "Текст для перевода": "Text to translate", "Копировать весь исходный текст": "Copy all source text", "Копировать весь перевод": "Copy the full translation", "Копировать всё": "Copy all",
  "Переводим…": "Translating…", "Не удалось получить перевод": "Could not get a translation", "API расширения недоступно на этой странице": "The extension API is unavailable on this page",
  "Не удалось выполнить перевод": "Could not translate", "Не удалось выполнить контекстный перевод": "Could not translate the context", "Ошибка перевода": "Translation error",
  "Ошибка фонового перевода": "Background translation error",
  "Озвучить выделенный текст": "Speak selected text", "Озвучить": "Speak", "Позиция озвучки": "Speech position", "Определяется…": "Detecting…", "Язык оригинала": "Source language", "Перевод с:": "Translated from:", "Очистить язык": "Clear language", "Очистить": "Clear", "Показать все языки": "Show all languages",
  "✓ Сохранено": "✓ Saved", "Не удалось сохранить перевод": "Could not save translation", "Ошибка сохранения": "Save error", "Позже": "Later", "Скачать и очистить": "Download and clear",
  "Не удалось загрузить записи": "Could not load records", "Не удалось очистить хранилище": "Could not clear storage", "Хранилище очищено, текущий перевод сохранён": "Storage cleared and current translation saved", "Переводы скачаны, хранилище очищено": "Translations downloaded and storage cleared", "Ошибка экспорта": "Export error", "Не удалось скачать переводы": "Could not download translations",
  "Транскрипция недоступна": "Transcription unavailable", "Озвучка не поддерживается этим браузером": "Speech is not supported by this browser", "Остановить озвучку": "Stop speaking", "Не удалось загрузить озвучку": "Could not load speech",
  "Запись удалена": "Record deleted", "Запись восстановлена": "Record restored", "Изменения сохранены": "Changes saved", "Список очищен": "List cleared", "Ошибка загрузки": "Load error", "Ошибка удаления": "Delete error", "Ошибка восстановления": "Restore error", "Ошибка очистки": "Clear error", "Не удалось подготовить файл": "Could not prepare the file", "Не удалось сохранить запись": "Could not save the record",
  "Удалить все сохранённые переводы?": "Delete all saved translations?", "Источник": "Source", "Варианты": "Alternatives", "Экспортировано записей": "Exported records", "Записей": "Records",
  "Не удалось удалить запись": "Could not delete the record", "Не удалось восстановить запись": "Could not restore the record", "Не удалось очистить список": "Could not clear the list",
  "Не удалось прочитать выделенный текст": "Could not read the selected text", "Не удалось прочитать текст для озвучки": "Could not read the text for speech",
  "Сервис перевода временно недоступен": "The translation service is temporarily unavailable", "Перевод может быть неточным": "The translation may be inaccurate",
  "Неизвестная ошибка": "Unknown error", "Перевод временно недоступен. Попробуйте ещё раз немного позже.": "Translation is temporarily unavailable. Please try again shortly.",
  "Сейчас не удалось получить перевод. Проверьте интернет-соединение или попробуйте ещё раз позже.": "Could not get a translation right now. Check your internet connection or try again later.",
  "Локальное хранилище недоступно": "Local storage is unavailable", "Не удалось прочитать перевод": "Could not read the translation", "Перевод повреждён": "The translation is corrupted",
  "Не удалось определить запись": "Could not identify the record", "Запись уже удалена": "The record has already been deleted", "Не удалось прочитать запись": "Could not read the record", "Запись не найдена": "Record not found",
  "Оригинал и перевод не могут быть пустыми": "Original text and translation cannot be empty", "Запись повреждена": "The record is corrupted",
  "Не удалось сохранить текущий перевод": "Could not save the current translation", "Текущая запись повреждена": "The current record is corrupted", "Не удалось загрузить шрифт PDF": "Could not load the PDF font",
  "{records} доступно для скачивания.": "{records} available to download.", "Скачать {format}": "Download {format}", "Файл {format} подготовлен": "{format} file is ready",
  "Удалить перевод «{term}»": "Delete translation “{term}”", "Редактировать перевод «{term}»": "Edit translation “{term}”", "Текущая скорость {rate}": "Current rate {rate}",
  "Код языка: {code}": "Language code: {code}", "Озвучить ({code})": "Speak ({code})", "Ошибка озвучки: {error}": "Speech error: {error}",
  "Достигнут лимит в {count} переводов. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые.": "The limit of {count} translations has been reached. Download the saved records and clear storage to save new ones.",
  "При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в {count}.": "When rotation is disabled, new records will not be saved while the {count}-record limit has been reached.",
  "При добавлении новых переводов сверх лимита в {count} самые старые записи будут автоматически удалены из истории. Таким образом, общее количество записей в истории будет остается равным {count}.": "When new translations exceed the {count}-record limit, the oldest records are removed automatically, keeping history at {count} records."
};

export function normalizeInterfaceLanguage(value: unknown, fallback: InterfaceLanguage = "ru"): InterfaceLanguage {
  return INTERFACE_LANGUAGES.includes(value as InterfaceLanguage) ? value as InterfaceLanguage : fallback;
}

export async function loadInterfaceLanguage(language: InterfaceLanguage) {
  if (language === "ru" || language === "en" || loadedCatalogs[language]) return;
  const loaders: Record<Exclude<InterfaceLanguage, "ru" | "en">, () => Promise<{default: Record<string, string>}>> = {
    de: () => import("./locales/de.json"), fr: () => import("./locales/fr.json"), es: () => import("./locales/es.json"),
    ja: () => import("./locales/ja.json"), nl: () => import("./locales/nl.json"), it: () => import("./locales/it.json"),
    pt: () => import("./locales/pt.json"), id: () => import("./locales/id.json"), hi: () => import("./locales/hi.json")
  };
  loadedCatalogs[language] = (await loaders[language]()).default;
}

export function setActiveLanguage(language: InterfaceLanguage) {
  activeLanguage = language;
}

export function getActiveLanguage() {
  return activeLanguage;
}

export function translate(value: string, language: InterfaceLanguage = activeLanguage): string {
  if (language === "ru" || !value) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const text = value.trim();
  const exact = (language === "en" ? en[text] : loadedCatalogs[language]?.[text]) || en[text];
  if (exact) return `${leading}${exact}${trailing}`;
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^(\d+) (?:запись|записи|записей)$/, (count) => formatRecordCount(Number(count), language)],
    [/^(\d+ (?:запись|записи|записей)) доступно для скачивания\.$/, (records) => formatMessage("{records} доступно для скачивания.", {records: translate(records, language)}, language)],
    [/^Скачать (.+)$/, (format) => formatMessage("Скачать {format}", {format}, language)],
    [/^Файл (.+) подготовлен$/, (format) => formatMessage("Файл {format} подготовлен", {format}, language)],
    [/^Удалить перевод «(.+)»$/, (term) => formatMessage("Удалить перевод «{term}»", {term}, language)],
    [/^Редактировать перевод «(.+)»$/, (term) => formatMessage("Редактировать перевод «{term}»", {term}, language)],
    [/^Текущая скорость (.+)$/, (rate) => formatMessage("Текущая скорость {rate}", {rate}, language)],
    [/^Код языка: (.+)$/, (code) => formatMessage("Код языка: {code}", {code}, language)],
    [/^Озвучить \((.+)\)$/, (code) => formatMessage("Озвучить ({code})", {code}, language)],
    [/^Ошибка озвучки: (.+)$/, (error) => formatMessage("Ошибка озвучки: {error}", {error}, language)],
    [/^Достигнут лимит в (\d+) переводов\. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые\.$/, (count) => formatMessage("Достигнут лимит в {count} переводов. Скачайте сохранённые записи и очистите хранилище, чтобы сохранять новые.", {count}, language)],
    [/^При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в (\d+)\.$/, (count) => formatMessage("При выключенной ротации новые записи не будут сохраняться в историю, пока достигнут лимит в {count}.", {count}, language)],
    [/^При добавлении новых переводов сверх лимита в (\d+) самые старые записи будут автоматически удалены из истории\. Таким образом, общее количество записей в истории будет остается равным (\d+)\.$/, (count) => formatMessage("При добавлении новых переводов сверх лимита в {count} самые старые записи будут автоматически удалены из истории. Таким образом, общее количество записей в истории будет остается равным {count}.", {count}, language)]
  ];
  for (const [pattern, replacement] of patterns) {
    const match = text.match(pattern);
    if (match) return `${leading}${replacement(...match.slice(1))}${trailing}`;
  }
  return value;
}

function formatMessage(template: string, values: Record<string, string>, language: InterfaceLanguage) {
  const translated = language === "en" ? en[template] : loadedCatalogs[language]?.[template] || en[template] || template;
  return translated.replace(/\{(\w+)}/g, (_, key) => values[key] ?? `{${key}}`);
}

export function formatRecordCount(count: number, language: InterfaceLanguage = activeLanguage) {
  const labels: Record<InterfaceLanguage, [string, string]> = {
    ru: ["запись", "записей"], en: ["record", "records"], de: ["Eintrag", "Einträge"], fr: ["entrée", "entrées"],
    es: ["registro", "registros"], ja: ["件", "件"], nl: ["item", "items"], it: ["voce", "voci"],
    pt: ["registro", "registros"], id: ["catatan", "catatan"], hi: ["रिकॉर्ड", "रिकॉर्ड"]
  };
  const [one, many] = labels[language];
  return `${count} ${count === 1 ? one : many}`;
}

const excludedTextSelector = [
  ".record-original", ".record-translation", ".record-transcription", ".record-sentence", ".record-alternatives", ".record-meta a", ".original", ".translated",
  ".translation-alternatives", ".translation-option", ".sentence", ".original-text", ".translation", ".context-translation",
  ".translator-output", ".source", ".source-link", "time"
].join(",");

export function localizeDom(root: Document | ShadowRoot, language: InterfaceLanguage) {
  const isDocument = root.nodeType === 9;
  const documentNode = isDocument ? root as Document : root.ownerDocument;
  const walker = documentNode.createTreeWalker(root, 4);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest(excludedTextSelector)) node.nodeValue = translate(node.nodeValue || "", language);
    node = walker.nextNode();
  }
  const elements = root.querySelectorAll<HTMLElement>("[aria-label], [title], [placeholder], [data-placeholder]");
  elements.forEach((element) => {
    ["aria-label", "title", "placeholder", "data-placeholder"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value, language));
    });
  });
  if (isDocument) {
    const documentRoot = root as Document;
    documentRoot.documentElement.lang = language;
    documentRoot.title = translate(documentRoot.title, language);
  }
}

export function observeLocalizedDom(root: Document | ShadowRoot, language: InterfaceLanguage) {
  localizeDom(root, language);
  if (language === "ru") return () => undefined;
  const observer = new MutationObserver(() => {
    observer.disconnect();
    localizeDom(root, language);
    observer.observe(root, {attributes: true, attributeFilter: ["aria-label", "title", "placeholder", "data-placeholder"], childList: true, characterData: true, subtree: true});
  });
  observer.observe(root, {attributes: true, attributeFilter: ["aria-label", "title", "placeholder", "data-placeholder"], childList: true, characterData: true, subtree: true});
  return () => observer.disconnect();
}
