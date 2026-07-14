const PRILIB_TILE_SIZE = 256;
const GITHUB_MANIFEST_URL = 'https://afterliferus.github.io/webarchivist/manifest.json';
const GITHUB_REPO_URL = 'https://github.com/AfterLifeRUS/webarchivist/';

const SITES = {
    YANDEX_ARCHIVE: {
        regex: /^https:\/\/(ya\.ru|yandex\.ru)\/archive/,
        name: "Яндекс.Архив",
        elements: ['downloadBtn', 'downloadAllBtn', 'downloadRangeBtn', 'startPage', 'endPage', 'zipModeContainer', 'rangeInputContainer']
    },
    GOSKATALOG: {
        regex: /^https:\/\/goskatalog\.ru\/portal/,
        name: "Госкаталог.рф",
        elements: ['downloadLotBtn']
    },
    PRLIB: {
        regex: /^https:\/\/www\.prlib\.ru\/item/,
        name: "Президентская библиотека",
        elements: ['downloadPageBtn', 'startPage', 'endPage', 'rangeInputContainer', 'zipModeContainer']
    }
};

const MESSAGES = {
    INIT: "Инициализация...",
    INIT_ERROR: "Ошибка инициализации",
    UNSUPPORTED_SITE: "Неподдерживаемый сайт",
    SUPPORTED_SITES_INFO: "SUPPORTED_SITES", // Специальный ключ для setStatus для отображения списка сайтов
    PAGE_DATA_REQUEST: "Получение данных страницы...",
    PAGE_DATA_SUCCESS: "Данные страницы получены.",
    DOC_DATA_REQUEST: "Получение данных документа...",
    DOC_DATA_SUCCESS: "Данные документа получены.",
    LOT_DATA_REQUEST: "Получаем данные лота…",
    LOT_IMAGES_FOUND: (count) => `Найдено изображений: ${count}. Скачиваем…`,
    LOT_DOWNLOAD_PROGRESS: (downloaded, total) => `Скачано ${downloaded} из ${total} изображений.`,
    LOT_DOWNLOAD_SUCCESS: "Все изображения лота успешно скачаны!",
    LOT_DOWNLOAD_PARTIAL: (downloaded, total, failed) => `Скачано ${downloaded} из ${total} изображений. Ошибок: ${failed}.`,
    CURRENT_PAGE_IMAGE_SEARCH: "Поиск изображения...",
    DOWNLOADING: "Скачиваю...",
    DOWNLOAD_COMPLETE: "Готово.",
    ZIP_PREPARING: (range) => `Подготовка ZIP ${range && range.start ? `(стр. ${range.start}-${range.end})` : 'всего документа'}…`,
    ZIP_REQUEST_SENT: (start, end) => `Отправка запроса на скачивание стр. ${start}-${end} по отдельности...`,
    ZIP_REQUEST_CONFIRMED: "Запрос на скачивание отправлен.",
    ZIP_PAGE_OPENING: (current, total) => `Стр. ${current}/${total}: Открываю...`,
    ZIP_PAGE_IMAGE_URL_WAIT: (current, total) => `Стр. ${current}/${total}: Ожидаю URL изображения...`,
    ZIP_PAGE_IMAGE_DOWNLOADING: (current, total) => `Стр. ${current}/${total}: Скачиваю картинку...`,
    ZIP_PAGE_EMPTY_IMAGE: (current, total) => `Стр. ${current}/${total}: Изображение пустое, пропускаю`,
    ZIP_PAGE_DUPLICATE_URL: (current, total) => `Стр. ${current}/${total}: Дубликат URL, пропускаю`,
    ZIP_PAGE_ADDED: (current, total) => `Стр. ${current}/${total}: Добавлено в ZIP.`,
    ZIP_GENERATING: "Формирую ZIP-файл...",
    ZIP_GENERATING_PROGRESS: (percent) => `Формирую ZIP: ${percent}%`,
    ZIP_DOWNLOADING: "Скачиваю ZIP…",
    ZIP_DOWNLOAD_SUCCESS: "ZIP скачан успешно!",
    PRLIB_GETTING_SIZES: "Получение размеров изображения...",
    PRLIB_FINDING_JTL: "Поиск оптимального JTL‑уровня...",
    PRLIB_FIRST_TILE: "Загрузка первого тайла для определения размеров...",
    PRLIB_OTHER_TILES: (count) => `Загрузка остальных ${count} тайлов...`,
    PRLIB_TILE_PROGRESS: (current, total) => `Тайлы: ${current}/${total}`,
    PRLIB_JPEG_GENERATING: "Формирование итогового JPEG...",
    PRLIB_COLLECTING_ZIP: (start, end) => `Собираем ZIP для страниц ${start}–${end}…`,
    PRLIB_PAGE_PROCESSING_ZIP: (current, total) => `Страница ${current}/${total}: формируем изображение…`,
    PRLIB_PAGE_ADDED_ZIP: (current, total) => `Страница ${current}/${total}: добавлена в ZIP.`,
    PRLIB_DOWNLOADING_PAGES: (start, end) => `Скачиваем страницы ${start}–${end}…`,
    PRLIB_PAGE_DOWNLOADING: (current, total) => `Страница ${current}/${total}: скачиваем…`,
    VERSION_CHECK_ERROR: "Не удалось проверить обновления.",
    VERSION_LATEST: (version) => `Версия актуальна: ${version}`,
    VERSION_NEW_AVAILABLE: (latest, current) => `Доступна новая версия: ${latest} (у вас ${current})`,
    UNKNOWN_ERROR: "Неизвестная ошибка.",
    PRLIB_DOC_DATA_REQUEST: "Получение данных документа (Президентская библиотека)...",
    PRLIB_DOC_DATA_SUCCESS: "Данные получены, готово к скачиванию (Президентская библиотека).",
    PRLIB_DOC_DATA_ERROR: "Не удалось извлечь информацию о документе (Президентская библиотека).",
    PRLIB_WAIT_TAB_LOAD: "Ожидание полной загрузки страницы (Президентская библиотека)...",
};


window.WebArchivistPopupConfig = {
  PRILIB_TILE_SIZE,
  GITHUB_MANIFEST_URL,
  GITHUB_REPO_URL,
  SITES,
  MESSAGES
};
