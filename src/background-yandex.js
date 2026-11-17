/**
 * src/background-yandex.js - Фоновые обработчики для Яндекс.Архива.
 */

const imageUrls = new Map();
const collectedNodeIds = new Map(); // "tabId-page" | "tabId-last" -> nodeId (из параметра id запросов /archive/api/image)
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
  for (const key of collectedNodeIds.keys()) {
    if (key.startsWith(`${tabId}-`)) {
      collectedNodeIds.delete(key);
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

      const nodeId = u.searchParams.get("id");
      if (nodeId && details.tabId >= 0) {
        collectedNodeIds.set(`${details.tabId}-${page}`, nodeId);
        collectedNodeIds.set(`${details.tabId}-last`, nodeId);
        console.log(`[Yandex Archive] collectedNodeIds: tab ${details.tabId}, страница ${page}, nodeId ${nodeId}`);
      }
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
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // reader.result уже содержит полный "data:image/jpeg;base64,..."
    reader.onerror = () => reject(new Error("Не удалось прочитать бинарные данные изображения в Base64"));
    reader.readAsDataURL(blob);
  });
}

// Загрузка оригинала через API-грант Яндекс.Архива (подход yandex-archive-downloader):
// POST /archive/api/image-grant {nodeId, type:"original"} -> {url, token},
// затем GET url с заголовком X-Archive-Image-Token. Не требует приближения (зума) изображения.
async function fetchOriginalGrant(nodeId, refererUrl) {
  let origin = "https://yandex.ru";
  try {
    if (refererUrl) origin = new URL(refererUrl).origin;
  } catch (e) {}

  const grantResponse = await fetch(`${origin}/archive/api/image-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    referrer: refererUrl || "https://yandex.ru/archive/",
    body: JSON.stringify({ nodeId, type: "original" })
  });
  if (!grantResponse.ok) {
    throw new Error(`image-grant: HTTP ${grantResponse.status} ${grantResponse.statusText}`);
  }

  const grant = await grantResponse.json();
  if (!grant?.url || !grant?.token) {
    throw new Error("image-grant: некорректный ответ сервера");
  }

  const imageResponse = await fetch(grant.url, {
    headers: { "X-Archive-Image-Token": grant.token },
    credentials: "include",
    referrer: refererUrl || "https://yandex.ru/archive/"
  });
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  if (!imageResponse.ok || contentType.includes("json") || contentType.includes("text")) {
    throw new Error(`image: HTTP ${imageResponse.status} ${imageResponse.statusText}`);
  }

  return { arrayBuffer: await imageResponse.arrayBuffer(), contentType };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Загрузка оригинала по nodeId через image-grant без открытия вкладок
// (сессия пользователя не прерывается).
async function downloadViaGrant(nodeId, refererUrl) {
  const granted = await fetchOriginalGrant(nodeId, refererUrl);
  return blobToDataUrl(new Blob([granted.arrayBuffer], { type: granted.contentType }));
}

// Определяет nodeId документа для вкладки: сначала из перехваченных запросов,
// затем из данных Next.js страницы (через content script).
async function resolveNodeId(tabId, page) {
  const keys = [];
  if (page !== undefined && page !== null) keys.push(`${tabId}-${page}`);
  keys.push(`${tabId}-last`);

  for (const key of keys) {
    const nodeId = collectedNodeIds.get(key);
    if (nodeId) return nodeId;
  }

  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "getDocId" });
    if (res?.data) return res.data;
  } catch (e) {
    console.warn("[Yandex Archive] Не удалось получить docId из content script:", e.message);
  }
  return null;
}

// Функция для получения следующего изображения
function fetchNextImage(tabId, pageNumber, timeoutMs = 10000) {
  console.log(`[Yandex Archive] Ожидаю URL для вкладки ${tabId}, страница ${pageNumber}`);

  // Если nodeId уже перехвачен для ЭТОЙ страницы, оригинал можно получить
  // через image-grant без ожидания зума. Ключ "tabId-last" тоже безопасен:
  // попап вызывает clearTabCapture перед каждой навигацией, поэтому "-last"
  // однозначно относится к текущей странице вкладки.
  if (collectedNodeIds.get(`${tabId}-${pageNumber}`) || collectedNodeIds.get(`${tabId}-last`)) {
    console.log(`[Yandex Archive] nodeId уже известен для вкладки ${tabId}, страница ${pageNumber}, оригинал будет получен через image-grant`);
    return Promise.resolve(null);
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
        
        // "last" = запрос оригинала без параметра page (типично для зума):
        // после clearTabCapture он гарантированно принадлежит текущей странице.
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

// Прогресс скачивания диапазона -> попап (UI). Если попап закрыт, ошибку игнорируем.
function sendRangeProgress(data) {
  try {
    const p = chrome.runtime.sendMessage({ type: "yaRangeProgress", data });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {}
}

// Очистка перехваченных данных вкладки (перед навигацией на новую страницу,
// чтобы не смешались nodeId/URL разных страниц).
function clearTabCaptureState(tabId) {
  for (const key of Array.from(imageUrls.keys())) {
    if (key.startsWith(`${tabId}-`)) imageUrls.delete(key);
  }
  for (const key of Array.from(collectedNodeIds.keys())) {
    if (key.startsWith(`${tabId}-`)) collectedNodeIds.delete(key);
  }
}

// Навигация ТЕКУЩЕЙ вкладки на URL с ожиданием загрузки (без создания вкладок).
// Временные вкладки не открываются — работа расширения не сбрасывается.
function navigateCurrentTab(tabId, url, timeoutMs = 45000) {
  console.log(`[Yandex Archive] Навигация текущей вкладки ${tabId} на: ${url}`);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve(ok);
      }
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") {
        console.log(`[Yandex Archive] Вкладка ${tabId} загрузилась: ${url}`);
        finish(true);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.update(tabId, { url }).then(() => {}, () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

// Ожидание готовности content script после навигации (страница перезагрузилась).
async function waitForTabReady(tabId, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: "getDocumentMeta" });
      if (res?.data) return res.data;
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

// Получение оригинала ОДНОЙ страницы: навигация текущей вкладкой, ожидание
// источника (nodeId/URL через перехват + авто/принудительный зум) и загрузка
// через image-grant. Общая логика для потоков "отдельные файлы" и "ZIP".
// Возвращает dataUrl оригинала или бросает ошибку.
async function fetchPageOriginal(tabId, page, pageUrl, nodeIds, progressBase) {
  // 1. Открываем страницу документа в ТЕКУЩЕЙ вкладке
  sendRangeProgress({ ...progressBase, phase: "opening" });
  clearTabCaptureState(tabId);
  const navOk = await navigateCurrentTab(tabId, pageUrl);
  if (!navOk) throw new Error("страница не загрузилась (таймаут)");

  // 2. Ждём готовности content script и обновляем nodeId сканов из DOM новой страницы
  const meta = await waitForTabReady(tabId);
  if (meta?.pageNodeIds && typeof meta.pageNodeIds === "object") {
    Object.assign(nodeIds, meta.pageNodeIds);
  }

  // 3. Ждём источник оригинала: nodeId (из миниатюр) и/или перехваченный URL
  //    (авто-зум запускается content script'ом при загрузке страницы)
  sendRangeProgress({ ...progressBase, phase: "waiting" });
  let nodeId = nodeIds[String(page)] || null;
  let originalUrl = null;
  let zoomTriggered = false;
  // ВАЖНО: запросы оригинала, инициированные зумом, обычно НЕ содержат параметр page,
  // поэтому onCompleted сохраняет их под ключом "<tabId>-last". Поскольку перед каждой
  // навигацией вызывается clearTabCaptureState(tabId), ключ "-last" однозначно относится
  // к только что загруженной странице — фолбэк на него безопасен.
  const readCaptured = () => {
    if (!nodeId) {
      nodeId = collectedNodeIds.get(`${tabId}-${page}`)
        || collectedNodeIds.get(`${tabId}-last`)
        || null;
    }
    if (!originalUrl) {
      const u = imageUrls.get(`${tabId}-${page}`) || imageUrls.get(`${tabId}-last`);
      if (u) {
        try {
          if (new URL(u).searchParams.get("type") === "original") originalUrl = u;
        } catch (e) {}
      }
    }
  };
  const deadline = Date.now() + 20000;
  // Фаза A: ждём первый источник (nodeId из миниатюр или URL после зума)
  while (Date.now() < deadline && !nodeId && !originalUrl) {
    readCaptured();
    // Подстраховка: если авто-зум не сработал, запускаем его принудительно
    if (!nodeId && !originalUrl && !zoomTriggered && Date.now() > deadline - 15000) {
      zoomTriggered = true;
      try { await chrome.tabs.sendMessage(tabId, { type: "triggerZoom" }); } catch (e) {}
    }
    if (nodeId || originalUrl) break;
    await sleep(400);
  }
  // Фаза B: если nodeId уже есть, даём авто-зуму 3 с догрузить оригинал
  if (nodeId && !originalUrl) {
    const graceDeadline = Date.now() + 3000;
    while (Date.now() < graceDeadline && !originalUrl) {
      readCaptured();
      if (originalUrl) break;
      await sleep(300);
    }
  }
  // Фаза C: последняя линия защиты — resolveNodeId (exact -> "-last" -> docId из
  // __NEXT_DATA__ через content script). Зеркалирует рабочий путь "Скачать текущую
  // страницу": во время цикла в просмотрщике открыта именно страница N, поэтому
  // грант по документному nodeId возвращает оригинал текущего скана.
  if (!nodeId) {
    nodeId = await resolveNodeId(tabId, page);
    if (nodeId) {
      console.log(`[Yandex Archive] Страница ${page}: nodeId найден через resolveNodeId (fallback): ${nodeId}`);
    }
  }
  if (!nodeId && !originalUrl) {
    console.warn(`[Yandex Archive] Страница ${page}: ничего не перехвачено. Ключи captured:`,
      Array.from(collectedNodeIds.keys()).filter(k => k.startsWith(`${tabId}-`)),
      Array.from(imageUrls.keys()).filter(k => k.startsWith(`${tabId}-`)));
  }

  // 4. Скачивание: приоритет у image-grant по nodeId, фолбэк — перехваченный URL
  sendRangeProgress({ ...progressBase, phase: "downloading" });
  let dataUrl = null;
  if (nodeId) {
    try {
      dataUrl = await downloadViaGrant(nodeId, pageUrl);
      console.log(`[Yandex Archive] Страница ${page}: оригинал получен через image-grant (nodeId=${nodeId})`);
    } catch (grantErr) {
      console.warn(`[Yandex Archive] Страница ${page}: image-grant не сработал (${grantErr.message}), пробую перехваченный URL`);
    }
  }
  if (!dataUrl && originalUrl) {
    dataUrl = await fetchYandexImageAsBase64(originalUrl, pageUrl);
  }
  if (!dataUrl) {
    throw new Error("оригинал не получен (нет nodeId и URL оригинала)");
  }
  return dataUrl;
}

async function downloadPages(tabId, title, startPage, endPage, baseUrl, pageNodeIds, sendResponse) {
  let downloaded = 0;
  const total = endPage - startPage + 1;
  const errors = [];
  const nodeIds = pageNodeIds && typeof pageNodeIds === "object" ? { ...pageNodeIds } : {};

  for (let page = startPage; page <= endPage; page++) {
    const index = page - startPage + 1;
    const pageUrl = `${baseUrl}/${page}`;
    const progressBase = { current: index, total, page, downloaded, errorsCount: errors.length };

    try {
      const dataUrl = await fetchPageOriginal(tabId, page, pageUrl, nodeIds, progressBase);

      let filename = `${title} - ${page}.jfif`;
      if (filename.length > 100) filename = filename.substring(0, 97) + "...";
      if (filename.endsWith(".txt")) filename = filename.replace(/\.txt$/, ".jfif");

      const downloadId = await new Promise(resolve =>
        chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, id => resolve(id))
      );
      if (!downloadId) throw new Error("API скачивания не вернул ID");

      downloaded++;
      console.log(`[Yandex Archive] Страница ${page} скачана (${downloaded}/${total})`);
      sendRangeProgress({ ...progressBase, downloaded, phase: "pageDone" });
    } catch (pageErr) {
      console.error(`[Yandex Archive] Страница ${page}: ошибка:`, pageErr);
      errors.push({ page, error: pageErr.message });
      sendRangeProgress({ ...progressBase, phase: "pageError", error: pageErr.message });
    }

    await sleep(400);
  }

  const status = downloaded === total ? "success" : (downloaded > 0 ? "partial" : "fail");
  console.log(`[Yandex Archive] Диапазон ${startPage}-${endPage} завершён: скачано ${downloaded}/${total}, ошибок: ${errors.length}`);
  sendResponse({ status, data: { downloaded, total, errors } });
}

// Скачивание диапазона в ZIP-архив. Вся сборка происходит в background:
// JSZip уже импортирован через importScripts, байты изображений НЕ передаются
// через messaging (это ломало ZIP: большие сканы превышали лимит размера
// сообщения runtime.sendMessage), а попап можно закрыть без риска сорвать
// загрузку. Прогресс приходит в попап сообщениями yaRangeProgress.
async function downloadPagesAsZip(tabId, title, startPage, endPage, baseUrl, pageNodeIds, sendResponse) {
  const total = endPage - startPage + 1;
  const errors = [];
  const nodeIds = pageNodeIds && typeof pageNodeIds === "object" ? { ...pageNodeIds } : {};
  const zip = new JSZip();
  let downloaded = 0;

  for (let page = startPage; page <= endPage; page++) {
    const index = page - startPage + 1;
    const pageUrl = `${baseUrl}/${page}`;
    const progressBase = { current: index, total, page, downloaded, errorsCount: errors.length };

    try {
      const dataUrl = await fetchPageOriginal(tabId, page, pageUrl, nodeIds, progressBase);

      let filenameInZip = `${title} - ${page}.jfif`;
      if (typeof WebArchivist?.truncateFilename === "function") {
        filenameInZip = WebArchivist.truncateFilename(filenameInZip, 90);
      } else if (filenameInZip.length > 90) {
        filenameInZip = filenameInZip.substring(0, 87) + "...";
      }
      // dataUrl имеет вид "data:image/jpeg;base64,<...>" — JSZip принимает base64 с флагом { base64: true }
      zip.file(filenameInZip, dataUrl.split(",")[1], { base64: true });

      downloaded++;
      console.log(`[Yandex Archive] Страница ${page} добавлена в ZIP (${downloaded}/${total})`);
      sendRangeProgress({ ...progressBase, downloaded, phase: "pageDone" });
    } catch (pageErr) {
      console.error(`[Yandex Archive] Страница ${page}: ошибка:`, pageErr);
      errors.push({ page, error: pageErr.message });
      sendRangeProgress({ ...progressBase, phase: "pageError", error: pageErr.message });
    }

    await sleep(400);
  }

  if (downloaded === 0) {
    console.log(`[Yandex Archive] ZIP: не скачано ни одной страницы диапазона ${startPage}-${endPage}`);
    sendResponse({ status: "fail", data: { downloaded: 0, total, errors } });
    return;
  }

  // Сборка архива (в service worker нет URL.createObjectURL, поэтому base64 -> data: URL)
  sendRangeProgress({ current: total, total, page: endPage, downloaded, errorsCount: errors.length, phase: "zipping" });
  let zipBase64;
  try {
    zipBase64 = await zip.generateAsync({ type: "base64" });
  } catch (zipErr) {
    console.error("[Yandex Archive] Ошибка сборки ZIP:", zipErr);
    errors.push({ page: "-", error: `сборка ZIP: ${zipErr.message}` });
    sendResponse({ status: "partial", data: { downloaded, total, errors } });
    return;
  }

  let zipName = `${title} (Стр. ${startPage}-${endPage}).zip`;
  if (typeof WebArchivist?.truncateFilename === "function") {
    zipName = WebArchivist.truncateFilename(zipName);
  } else if (zipName.length > 100) {
    zipName = zipName.substring(0, 97) + "...";
  }

  sendRangeProgress({ current: total, total, page: endPage, downloaded, errorsCount: errors.length, phase: "savingZip" });
  try {
    const downloadId = await new Promise(resolve =>
      chrome.downloads.download({ url: `data:application/zip;base64,${zipBase64}`, filename: zipName, saveAs: false }, id => resolve(id))
    );
    if (!downloadId) throw new Error("API скачивания не вернул ID");
  } catch (dlErr) {
    console.error("[Yandex Archive] Ошибка сохранения ZIP:", dlErr);
    errors.push({ page: "-", error: `сохранение ZIP: ${dlErr.message}` });
  }

  const status = errors.length === 0 ? "success" : "partial";
  console.log(`[Yandex Archive] ZIP диапазона ${startPage}-${endPage} готов: ${downloaded}/${total}, ошибок: ${errors.length}`);
  sendResponse({ status, data: { downloaded, total, errors, zipName } });
}

// --- Функции-обработчики сообщений, вызываемые из background.js ---

function handleGetImageUrl(sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    const tab = tabs[0];
    if (!tab || !/^https?:\/\/(ya\.ru|yandex\.ru)\/archive/.test(tab.url)) {
      sendResponse({ status: "fail", data: null, error: "Не Яндекс.Архив" });
      return;
    }

    // Приоритет: оригинал через image-grant по nodeId (не требует зума изображения)
    try {
      const page = tab.url.split('/').pop().split('?')[0];
      const nodeId = await resolveNodeId(tab.id, page);
      if (nodeId) {
        const granted = await fetchOriginalGrant(nodeId, tab.url);
        const dataUrl = await blobToDataUrl(new Blob([granted.arrayBuffer], { type: granted.contentType }));
        console.log(`[Yandex Archive] getImageUrl: оригинал получен через image-grant (nodeId=${nodeId})`);
        sendResponse({ status: "success", data: { url: dataUrl, suggestedFilename: "image.jfif" } });
        return;
      }
    } catch (grantErr) {
      console.warn("[Yandex Archive] image-grant не сработал, использую перехваченный URL:", grantErr.message);
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
    const nodeId = collectedNodeIds.get(`${tabId}-${pageNumber}`)
      || collectedNodeIds.get(`${tabId}-last`)
      || null;
    if (url || nodeId) {
      sendResponse({ status: "success", data: { url, nodeId } });
    } else {
      sendResponse({ status: "fail", data: null });
    }
  });
}

// Очистка перехваченных данных вкладки (вызывается попапом перед навигацией
// на очередную страницу в режиме ZIP).
function handleClearTabCapture(message, sendResponse) {
  const { tabId } = message.data || {};
  if (tabId) {
    clearTabCaptureState(tabId);
    console.log(`[Yandex Archive] Состояние перехвата вкладки ${tabId} очищено`);
  }
  sendResponse({ status: "success" });
}

function handleFetchImageBlob(message, sendResponse) {
  const { url, nodeId } = message.data;
  (async () => {
    try {
      let refererUrl = "https://yandex.ru/archive/";
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
          refererUrl = tabs[0].url;
        }
      } catch (e) {
        console.warn("Не удалось прочитать активную вкладку для реферера blob:", e);
      }

      // Приоритет: оригинал через image-grant по nodeId (подход yandex-archive-downloader)
      if (nodeId) {
        try {
          const granted = await fetchOriginalGrant(nodeId, refererUrl);
          const bytes = new Uint8Array(granted.arrayBuffer);
          console.log(`fetchImageBlob: оригинал получен через image-grant (nodeId=${nodeId}), размер: ${bytes.length} байт`);
          sendResponse({ status: "success", data: { blob: Array.from(bytes), contentType: granted.contentType } });
          return;
        } catch (grantErr) {
          console.warn(`fetchImageBlob: image-grant не сработал (${grantErr.message}), использую перехваченный URL`);
        }
      }

      if (!url) throw new Error("Не передан URL изображения и не удалось получить nodeId");

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
  const { title, startPage, endPage, baseUrl, pageNodeIds } = message.data;
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
      downloadPages(tab.id, title, start, end, baseUrl, pageNodeIds, sendResponse);
    }
  });
}

// ZIP-версия: та же валидация, но сборка архива идёт в background.
function handleDownloadRangeZip(message, sendResponse) {
  const { title, startPage, endPage, baseUrl, pageNodeIds } = message.data;
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
      downloadPagesAsZip(tab.id, title, start, end, baseUrl, pageNodeIds, sendResponse);
    }
  });
}