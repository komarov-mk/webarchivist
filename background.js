/**
 * background.js - Главный координатор фонового процесса (Service Worker).
 * Загружает необходимые модули и маршрутизирует сообщения.
 */

// Импортируем зависимости и модули сайтов строго на верхнем уровне
try {
  importScripts(
    "jszip.min.js",
    "src/shared.js",
    "src/background-yandex.js",
    "src/background-prlib.js"
  );
  console.log("[Background] Все вспомогательные скрипты успешно загружены.");
} catch (err) {
  console.error("[Background] Критическая ошибка загрузки скриптов:", err);
}

// Единый роутер сообщений chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // --- Президентская Библиотека (site-prlib) ---
  if (message.type === 'fetchTile') {
    handleFetchTile(message, sendResponse);
    return true; // Асинхронный ответ
  } 
  
  if (message.type === 'fetchJson') {
    handleFetchJson(message, sendResponse);
    return true; // Асинхронный ответ
  }

  // --- Яндекс.Архив (site-yandex) ---
  if (message.type === "getImageUrl") {
    handleGetImageUrl(sendResponse);
    return true; // Асинхронный ответ
  }

  if (message.type === "fetchNextImage") {
    handleFetchNextImage(message, sendResponse);
    return true; // Асинхронный ответ
  }

  if (message.type === "fetchImageBlob") {
    handleFetchImageBlob(message, sendResponse);
    return true; // Асинхронный ответ
  }

  if (message.type === "downloadRangeImages") {
    handleDownloadRangeImages(message, sendResponse);
    return true; // Асинхронный ответ
  }

  console.log(`[Background] Неизвестный тип сообщения: ${message.type}`);
  return false;
});