// background.js
importScripts("src/shared.js");

// Динамическая загрузка JSZip через ES6 module import
let JSZip;

async function loadJSZip() {
  try {
    // В Manifest V3 используем динамический import с полным URL расширения
    const jszipUrl = chrome.runtime.getURL('jszip.min.js');
    
    // Создаем модуль через eval в контексте service worker
    const response = await fetch(jszipUrl);
    const code = await response.text();
    
    // Выполняем код и получаем экспортируемый объект
    eval(code);
    
    // JSZip экспортируется как глобальная переменная или через module.exports
    JSZip = (typeof self.JSZip !== 'undefined') ? self.JSZip : 
            (typeof globalThis.JSZip !== 'undefined') ? globalThis.JSZip : null;
    
    if (typeof JSZip !== 'function') throw new Error('JSZip не загружен');
    console.log('JSZip успешно загружен');
  } catch (err) {
    console.error('Ошибка загрузки JSZip:', err);
    throw new Error('Не удалось загрузить JSZip');
  }
}

// Инициализация JSZip при старте service worker
loadJSZip().catch(err => console.error('Критическая ошибка инициализации:', err));

const imageUrls = new Map();



chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of imageUrls.keys()) {
    if (key.startsWith(`${tabId}-`)) imageUrls.delete(key);
  }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'fetchTile') {
        // Используем URL API для безопасной конкатенации и валидации URL
        let safeUrl;
        try {
            safeUrl = new URL(message.url);
        } catch (e) {
            sendResponse({ status: 'error', error: `Некорректный URL: ${e.message}` });
            return false;
        }
        
        fetch(safeUrl, { 
            mode: 'cors',
            credentials: 'omit'
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ошибка: ${response.status}`);
                }
                const contentType = response.headers.get('Content-Type') || '';
                return response.blob().then(blob => ({ blob, contentType }));
            })
            .then(({ blob, contentType }) => {
                const reader = new FileReader();
                reader.onload = () => {
                    sendResponse({ status: 'success', data: reader.result, contentType });
                };
                reader.onerror = () => {
                    sendResponse({ status: 'error', error: 'Ошибка чтения Blob' });
                };
                reader.readAsDataURL(blob);
            })
            .catch(error => {
                sendResponse({ status: 'error', error: error.message });
            });
        return true; // Асинхронный ответ
    } else if (message.type === 'fetchJson') {
        // Используем URL API для безопасной конкатенации и валидации URL
        let safeUrl;
        try {
            safeUrl = new URL(message.url);
        } catch (e) {
            sendResponse({ status: 'error', error: `Некорректный URL: ${e.message}` });
            return false;
        }
        
        fetch(safeUrl, { 
            mode: 'cors',
            credentials: 'omit'
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ошибка: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ status: 'success', data });
            })
            .catch(error => {
                sendResponse({ status: 'error', error: error.message });
            });
        return true; // Асинхронный ответ
    }
});


chrome.webRequest.onCompleted.addListener(
  details => {
    // Проверяем, что URL соответствует API изображений Яндекс.Архива
    if (!details.url.includes("/archive/api/image")) return;
    
    // Проверяем наличие type=original
    let hasOriginalType = false;
    let page = "last";
    try {
      const u = new URL(details.url);
      page = u.searchParams.get("page") || "last";
      hasOriginalType = u.searchParams.get("type") === "original";
      console.log(`[Yandex Archive] Перехвачен URL для вкладки ${details.tabId}, страница ${page}, type=original: ${hasOriginalType}: ${details.url}`);
    } catch (e) {
      console.error(`[Yandex Archive] Ошибка разбора URL: ${e.message}`);
      return;
    }
    
    // Сохраняем только если есть type=original
    if (hasOriginalType) {
      imageUrls.set(`${details.tabId}-${page}`, details.url);
      imageUrls.set(`${details.tabId}-last`, details.url);
      console.log(`[Yandex Archive] URL сохранен (type=original найден)`);
    } else {
      console.warn(`[Yandex Archive] URL пропущен: отсутствует type=original. Пользователю нужно приблизить изображение.`);
    }
  },
  {
    urls: [
      "*://ya.ru/archive/api/image*",
      "*://yandex.ru/archive/api/image*"
    ]
  }
);

// Функция для получения следующего изображения
function fetchNextImage(tabId, pageNumber, timeoutMs = 10000) {
  console.log(`[Yandex Archive] Ожидаю URL для вкладки ${tabId}, страница ${pageNumber}`);
  
  // Проверяем наличие запасного URL с type=original
  const fallbackKey = `${tabId}-last`;
  const fallbackUrl = imageUrls.get(fallbackKey);
  if (fallbackUrl) {
    try {
      const u = new URL(fallbackUrl);
      if (u.searchParams.get("type") === "original") {
        console.log(`[Yandex Archive] Использую запасной URL (type=original): ${fallbackUrl}`);
        return Promise.resolve(fallbackUrl);
      } else {
        console.warn(`[Yandex Archive] Запасной URL без type=original, ожидаю перехват: ${fallbackUrl}`);
      }
    } catch (e) {
      console.error(`[Yandex Archive] Ошибка разбора запасного URL: ${e.message}`);
    }
  }
  
  // Если запасного URL нет, ждем перехвата
  return new Promise(resolve => {
    let done = false;
    const listener = details => {
      if (done || details.tabId !== tabId || !details.url.includes("/archive/api/image")) return;
      try {
        const u = new URL(details.url);
        const urlPage = u.searchParams.get("page") || "last";
        const hasOriginal = u.searchParams.get("type") === "original";
        console.log(`[Yandex Archive] Получен URL: ${details.url}, страница ${urlPage}, type=original: ${hasOriginal}`);
        
        if (!hasOriginal) {
          console.warn(`[Yandex Archive] URL без type=original, пропускаем`);
          return;
        }
        
        if (String(urlPage) === String(pageNumber) || urlPage === "last") {
          done = true;
          chrome.webRequest.onCompleted.removeListener(listener);
          resolve(details.url);
        }
      } catch (e) {
        console.error(`[Yandex Archive] Ошибка разбора URL в fetchNextImage: ${e.message}`);
      }
    };
    chrome.webRequest.onCompleted.addListener(
      listener,
      {
        urls: [
          "*://ya.ru/archive/api/image*",
          "*://yandex.ru/archive/api/image*"
        ]
      }
    );
    setTimeout(() => {
      if (!done) {
        done = true;
        chrome.webRequest.onCompleted.removeListener(listener);
        console.warn(`[Yandex Archive] Тайм-аут: URL для вкладки ${tabId}, страница ${pageNumber} не найден`);
        resolve(null);
      }
    }, timeoutMs);
  });
}

async function navigateToPage(tabId, url) {
  console.log(`[Yandex Archive] Открываю вкладку с URL: ${url}`);
  const downloadTab = await chrome.tabs.create({ url, active: false });
  await new Promise(r => {
    const onUpd = (id, info) => {
      if (id === downloadTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpd);
        console.log(`[Yandex Archive] Вкладка ${downloadTab.id} загружена`);
        r();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpd);
  });
  return downloadTab.id;
}

async function downloadPages(tabId, title, startPage, endPage, baseUrl, sendResponse) {
  let downloaded = 0;

  for (const key of imageUrls.keys()) {
    if (key.startsWith(`${tabId}-`)) imageUrls.delete(key);
  }

  for (let page = startPage; page <= endPage; page++) {
    const downloadTabId = await navigateToPage(tabId, `${baseUrl}/${page}`);

    let imageUrl = await fetchNextImage(downloadTabId, page);
    if (!imageUrl) {
      const key = `${downloadTabId}-${page}`;
      imageUrl = imageUrls.get(key) || imageUrls.get(`${downloadTabId}-last`);
      // Проверяем type=original для найденного URL
      if (imageUrl) {
        try {
          const u = new URL(imageUrl);
          if (u.searchParams.get("type") !== "original") {
            console.warn(`[Yandex Archive] Страница ${page}: найден URL без type=original, пропускаем`);
            imageUrl = null;
          }
        } catch (e) {
          console.error(`[Yandex Archive] Ошибка разбора URL: ${e.message}`);
          imageUrl = null;
        }
      }
    }
    if (!imageUrl) {
      console.warn(`[Yandex Archive] Страница ${page}: URL не найден или без type=original`);
      chrome.tabs.remove(downloadTabId);
      continue;
    }

    let filename = `${title} - ${page}.jpeg`;
    if (filename.length > 100) filename = filename.substring(0, 97) + "...";

    // Определяем расширение файла из URL или Content-Type
    let fileExt = 'jfif'; // По умолчанию для Яндекс.Архива
    try {
      const u = new URL(imageUrl);
      const contentType = u.searchParams.get('type');
      // Можно расширить логику определения расширения по query-параметрам или заголовкам
      fileExt = 'jfif'; // Яндекс.Архив отдает jfif/jpeg
    } catch (e) {
      console.warn(`[Yandex Archive] Не удалось определить расширение, используем .jfif`);
    }
    
    // Заменяем расширение в имени файла
    filename = filename.replace(/\.jpeg$/, `.${fileExt}`);

    const downloadId = await new Promise(resolve =>
      chrome.downloads.download(
        { 
          url: imageUrl, 
          filename,
          saveAs: false
        },
        id => resolve(id)
      )
    );
    if (!downloadId) {
      console.error(`[Yandex Archive] Ошибка скачивания страницы ${page}: API не вернуло ID`);
      chrome.tabs.remove(downloadTabId);
      continue;
    }

    downloaded++;
    chrome.tabs.remove(downloadTabId);
  }

  sendResponse({ status: downloaded > 0 ? "success" : "fail" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getImageUrl") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab || !/^https?:\/\/(ya\.ru|yandex\.ru)\/archive/.test(tab.url)) {
        sendResponse({ status: "fail", data: null, error: "Не Яндекс.Архив" });
      } else if (WebArchivist.isYandexArchiveOriginalImageUrl(tab.url)) {
        console.log(`[Yandex Archive] getImageUrl: активная вкладка уже открыта на original image API`);
        sendResponse({ status: "success", data: { url: tab.url, suggestedFilename: "image.jfif" } });
      } else {
        const pn = tab.url.split('/').pop().split('?')[0];
        const key = `${tab.id}-${pn}`;
        const url = imageUrls.get(key) || imageUrls.get(`${tab.id}-last`);
        console.log(`[Yandex Archive] getImageUrl: таб=${tab.id}, страница=${pn}, найден URL=${!!url}`);
        
        if (!url) {
          sendResponse({ 
            status: "fail", 
            data: null, 
            error: "URL изображения не найден. Приблизьте изображение на странице (зум), чтобы загрузилась версия в оригинальном качестве." 
          });
        } else {
          // Проверяем наличие type=original в URL
          try {
            const u = new URL(url);
            if (u.searchParams.get("type") !== "original") {
              sendResponse({ 
                status: "fail", 
                data: null, 
                error: "Найден URL без type=original. Приблизьте изображение на странице (зум), чтобы загрузилась версия в оригинальном качестве." 
              });
              return;
            }
          } catch (e) {
            sendResponse({ status: "fail", data: null, error: `Ошибка разбора URL: ${e.message}` });
            return;
          }
          
          sendResponse({ status: "success", data: { url } });
        }
      }
    });
    return true;
  }

  if (message.type === "fetchNextImage") {
    const { pageNumber, tabId } = message.data;
    if (!tabId) {
      console.error("Не указан tabId");
      sendResponse({ status: "fail", data: null });
      return true;
    }
    fetchNextImage(tabId, pageNumber).then(url => {
      sendResponse(url
        ? { status: "success", data: { url } }
        : { status: "fail", data: null }
      );
    });
    return true;
  }

  if (message.type === "fetchImageBlob") {
    const { url } = message.data;
    (async () => {
      try {
        // Валидация URL с помощью URL API
        let safeUrl;
        try {
          safeUrl = new URL(url);
        } catch (e) {
          throw new Error(`Некорректный URL: ${e.message}`);
        }
        
        console.log(`fetchImageBlob: Начинаю загрузку: ${safeUrl.href}`);
        const response = await fetch(safeUrl, { 
          mode: 'cors',
          credentials: 'omit'
        });
        console.log(`fetchImageBlob: HTTP статус: ${response.status}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        console.log(`fetchImageBlob: Размер blob: ${blob.size} байт`);
        if (blob.size === 0) throw new Error('Пустое изображение');
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        sendResponse({ status: "success", data: { blob: Array.from(bytes) } });
      } catch (err) {
        console.error(`fetchImageBlob: Ошибка: ${err.message}`);
        sendResponse({ status: "fail", error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "downloadRangeImages") {
    const { title, startPage, endPage, baseUrl } = message.data;
    const start = parseInt(startPage, 10);
    const end = parseInt(endPage, 10);
    if (isNaN(start) || isNaN(end) || end < start) {
      sendResponse({ status: "fail", error: "Некорректный диапазон" });
      return true;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ status: "fail", error: "Нет активной вкладки" });
      } else {
        downloadPages(tab.id, title, start, end, baseUrl, sendResponse);
      }
    });
    return true;
  }

  console.log(`[Yandex Archive] Неизвестный тип сообщения: ${message.type}`);
  return false;
});