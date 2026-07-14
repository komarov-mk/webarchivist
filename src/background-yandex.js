/**
 * src/background-yandex.js - Фоновые обработчики для Яндекс.Архива.
 */

const imageUrls = new Map();
let yandexImageToken = ""; // Хранилище для динамического токена защиты

// Локальный аналог функции проверки URL во избежание конфликтов областей видимости
function isYandexArchiveOriginalImageUrlLocal(url) {
  try {
    const u = new URL(url);
    return /^(ya\.ru|yandex\.ru)$/.test(u.hostname) &&
      u.pathname === "/archive/api/image" &&
      u.searchParams.get("type") === "original";
  } catch (e) {
    return false;
  }
}

// Очистка кэша при закрытии вкладки
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of imageUrls.keys()) {
    if (key.startsWith(`${tabId}-`)) {
      imageUrls.delete(key);
    }
  }
});

// 1. Пассивный перехватчик заголовков для получения актуального токена авторизации картинок
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const tokenHeader = details.requestHeaders?.find(
      (h) => h.name.toLowerCase() === "x-archive-image-token"
    );
    if (tokenHeader) {
      yandexImageToken = tokenHeader.value;
      console.log("[Yandex Archive] Успешно перехвачен x-archive-image-token:", yandexImageToken);
    }
  },
  {
    urls: [
      "*://ya.ru/archive/api/image*",
      "*://yandex.ru/archive/api/image*"
    ]
  },
  ["requestHeaders"]
);

// 2. Слушатель веб-запросов для перехвата оригинальных изображений Яндекс.Архива
chrome.webRequest.onCompleted.addListener(
  details => {
    if (!details.url.includes("/archive/api/image")) return;
    
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

// Защищенный загрузчик изображений Яндекса в формате Data URL
async function fetchYandexImageAsBase64(imageUrl, refererUrl) {
  console.log(`[Yandex Archive] Запуск защищенного fetch для: ${imageUrl}`);
  
  const headers = {
    "x-requested-with": "XMLHttpRequest"
  };

  if (yandexImageToken) {
    headers["x-archive-image-token"] = yandexImageToken;
  }

  // Передаем правильный Referer через встроенный параметр referrer fetch API
  const response = await fetch(imageUrl, { 
    headers,
    referrer: refererUrl || "https://yandex.ru/archive/"
  });

  if (!response.ok) {
    throw new Error(`Яндекс отклонил запрос: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  
  // Проверка на случай, если Яндекс все же вернул ошибку в формате JSON или текста
  if (contentType.includes("json") || contentType.includes("text")) {
    const textError = await response.text();
    throw new Error(`Сервер вернул ошибку вместо изображения: ${textError.substring(0, 150)}`);
  }

  const blob = await response.blob();

  // 100% безопасная и быстрая конвертация Blob в Base64 Data URL без переполнения стека
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // reader.result уже содержит полный "data:image/jpeg;base64,..."
    reader.onerror = () => reject(new Error("Не удалось прочитать бинарные данные изображения в Base64"));
    reader.readAsDataURL(blob);
  });
}

// Функция для получения следующего изображения
function fetchNextImage(tabId, pageNumber, timeoutMs = 10000) {
  console.log(`[Yandex Archive] Ожидаю URL для вкладки ${tabId}, страница ${pageNumber}`);
  
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
    const pageUrl = `${baseUrl}/${page}`;
    const downloadTabId = await navigateToPage(tabId, pageUrl);

    let imageUrl = await fetchNextImage(downloadTabId, page);
    if (!imageUrl) {
      const key = `${downloadTabId}-${page}`;
      imageUrl = imageUrls.get(key) || imageUrls.get(`${downloadTabId}-last`);
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
      chrome.tabs.remove(downloadTabId).catch(() => {});
      continue;
    }

    let filename = `${title} - ${page}.jpeg`;
    if (filename.length > 100) filename = filename.substring(0, 97) + "...";

    let fileExt = 'jfif'; 
    try {
      const u = new URL(imageUrl);
      fileExt = 'jfif'; 
    } catch (e) {
      console.warn(`[Yandex Archive] Не удалось определить расширение, используем .jfif`);
    }
    
    filename = filename.replace(/\.jpeg$/, `.${fileExt}`);
    // На всякий случай страхуемся от расширения .txt
    if (filename.endsWith(".txt")) {
      filename = filename.replace(/\.txt$/, ".jfif");
    }

    let finalDownloadUrl = imageUrl;
    try {
      // Пытаемся безопасно скачать картинку в Base64, имитируя легитимного клиента
      finalDownloadUrl = await fetchYandexImageAsBase64(imageUrl, pageUrl);
    } catch (fetchErr) {
      console.error(`[Yandex Archive] Ошибка обхода защиты для страницы ${page}:`, fetchErr);
      console.warn(`[Yandex Archive] Пробуем прямой метод скачивания (возможна ошибка .txt)...`);
    }

    const downloadId = await new Promise(resolve =>
      chrome.downloads.download(
        { 
          url: finalDownloadUrl, 
          filename,
          saveAs: false
        },
        id => resolve(id)
      )
    );
    if (!downloadId) {
      console.error(`[Yandex Archive] Ошибка скачивания страницы ${page}: API не вернуло ID`);
      chrome.tabs.remove(downloadTabId).catch(() => {});
      continue;
    }

    downloaded++;
    chrome.tabs.remove(downloadTabId).catch(() => {});
  }

  sendResponse({ status: downloaded > 0 ? "success" : "fail" });
}

// --- Функции-обработчики сообщений, вызываемые из background.js ---

function handleGetImageUrl(sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab || !/^https?:\/\/(ya\.ru|yandex\.ru)\/archive/.test(tab.url)) {
      sendResponse({ status: "fail", data: null, error: "Не Яндекс.Архив" });
      return;
    } 
    
    let targetUrl = "";
    if (isYandexArchiveOriginalImageUrlLocal(tab.url)) {
      console.log(`[Yandex Archive] getImageUrl: активная вкладка уже открыта на original image API`);
      targetUrl = tab.url;
    } else {
      const pn = tab.url.split('/').pop().split('?')[0];
      const key = `${tab.id}-${pn}`;
      targetUrl = imageUrls.get(key) || imageUrls.get(`${tab.id}-last`);
      console.log(`[Yandex Archive] getImageUrl: таб=${tab.id}, страница=${pn}, найден URL=${!!targetUrl}`);
    }
    
    if (!targetUrl) {
      sendResponse({ 
        status: "fail", 
        data: null, 
        error: "URL изображения не найден. Приблизьте изображение на странице (зум), чтобы загрузилась версия в оригинальном качестве." 
      });
      return;
    }

    try {
      const u = new URL(targetUrl);
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

    // Вместо отправки сырой ссылки, скачиваем картинку в Base64 прямо в бэкграунде
    fetchYandexImageAsBase64(targetUrl, tab.url)
      .then(dataUrl => {
        // Отправляем в попап уже готовый Base64-код картинки
        sendResponse({ status: "success", data: { url: dataUrl, suggestedFilename: "image.jfif" } });
      })
      .catch(err => {
        console.error("[Yandex Archive] Ошибка загрузки одиночного изображения:", err);
        sendResponse({ 
          status: "fail", 
          data: null, 
          error: `Не удалось загрузить защищенное изображение: ${err.message}` 
        });
      });
  });
}

function handleFetchNextImage(message, sendResponse) {
  const { pageNumber, tabId } = message.data;
  if (!tabId) {
    console.error("Не указан tabId");
    sendResponse({ status: "fail", data: null });
    return;
  }
  fetchNextImage(tabId, pageNumber).then(url => {
    sendResponse(url
      ? { status: "success", data: { url } }
      : { status: "fail", data: null }
    );
  });
}

function handleFetchImageBlob(message, sendResponse) {
  const { url } = message.data;
  (async () => {
    try {
      let safeUrl;
      try {
        safeUrl = new URL(url);
      } catch (e) {
        throw new Error(`Некорректный URL: ${e.message}`);
      }
      
      console.log(`fetchImageBlob: Начинаю загрузку: ${safeUrl.href}`);
      
      const headers = {
        "x-requested-with": "XMLHttpRequest"
      };
      if (yandexImageToken) {
        headers["x-archive-image-token"] = yandexImageToken;
      }

      let refererUrl = "https://yandex.ru/archive/";
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
          refererUrl = tabs[0].url;
        }
      } catch (e) {
        console.warn("Не удалось прочитать активную вкладку для реферера blob:", e);
      }

      // Скачиваем бинарник с подменой заголовков (для генерации ZIP-архивов)
      const response = await fetch(safeUrl, { 
        headers,
        referrer: refererUrl
      });

      console.log(`fetchImageBlob: HTTP статус: ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("json") || contentType.includes("text")) {
        const textError = await response.text();
        throw new Error(`Яндекс вернул текст ошибки вместо картинки: ${textError.substring(0, 150)}`);
      }

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
}

function handleDownloadRangeImages(message, sendResponse) {
  const { title, startPage, endPage, baseUrl } = message.data;
  const start = parseInt(startPage, 10);
  const end = parseInt(endPage, 10);
  if (isNaN(start) || isNaN(end) || end < start) {
    sendResponse({ status: "fail", error: "Некорректный диапазон" });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab) {
      sendResponse({ status: "fail", error: "Нет активной вкладки" });
    } else {
      downloadPages(tab.id, title, start, end, baseUrl, sendResponse);
    }
  });
}