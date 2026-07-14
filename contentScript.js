/**
 * contentScript.js - Единый приемник сообщений для контентных скриптов.
 * Маршрутизирует запросы к соответствующим модулям сайтов (Яндекс, Госкаталог, PRLib)
 * и автоматизирует интерфейсные действия (например, зум на Яндекс.Архиве).
 */

/**
 * Функция авто-кликера для симуляции приближения (зума) на Яндекс.Архиве.
 * Это заставляет движок Яндекс.Архива отправить запрос на оригинальное изображение (type=original),
 * которое затем перехватывается фоновым скриптом расширения.
 */
function triggerYandexZoom() {
  return new Promise((resolve) => {
    const maxAttempts = 30; // Ожидаем кнопку до 15 секунд (30 попыток по 500мс)
    let attempts = 0;

    const interval = setInterval(() => {
      attempts++;

      // Поиск кнопки "+" по динамическим классам Яндекса, стандартным Leaflet-классам и атрибутам
      const zoomInBtn = 
        document.querySelector('button[class*="ZoomControls_buttonPlus"]') || 
        document.querySelector('button[class*="zoom-in"]') ||                 
        document.querySelector('button[aria-label*="Приблизить"]') ||         
        document.querySelector('button[title*="Приблизить"]') ||              
        Array.from(document.querySelectorAll('button')).find(btn => {
          const text = btn.textContent?.trim();
          return text === '+' || btn.innerHTML.includes('plus') || btn.className.includes('zoom-in');
        });

      if (zoomInBtn) {
        clearInterval(interval);
        console.log('[WebArchivist] Кнопка масштабирования найдена. Выполняю авто-зум...');
        
        // Кликаем трижды с микро-паузами для гарантированного переключения на слой максимального разрешения
        zoomInBtn.click();
        setTimeout(() => zoomInBtn.click(), 150);
        setTimeout(() => {
          zoomInBtn.click();
          resolve({ status: 'success', message: 'Авто-зум успешно выполнен, оригинальный слой запрошен.' });
        }, 300);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn('[WebArchivist] Не удалось найти кнопку зума на странице за отведенное время.');
        resolve({ status: 'error', error: 'Кнопка приближения не найдена на странице.' });
      }
    }, 500);
  });
}

// --- Единый слушатель сообщений ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Получено сообщение в contentScript.js:', message);
  const content = window.WebArchivistContent || {};

  // --- Президентская Библиотека (prlib) ---
  if (message.type === 'getDocumentInfo') {
    if (content.prlib && typeof content.prlib.getDocumentInfo === 'function') {
      content.prlib.getDocumentInfo()
        .then(sendResponse)
        .catch(err => {
          console.error('Ошибка при getDocumentInfo:', err);
          sendResponse({ status: 'error', error: err.message });
        });
      return true; // Асинхронный ответ
    } else {
      console.warn('Модуль prlib не загружен на этой странице.');
      sendResponse({ status: 'error', error: 'Модуль Президентской Библиотеки не инициализирован.' });
      return false;
    }
  }

  if (message.type === 'getTotalPagesPr') {
    if (content.prlib && typeof content.prlib.getTotalPagesPr === 'function') {
      const totalPages = content.prlib.getTotalPagesPr();
      if (totalPages !== null) {
        sendResponse({ status: 'success', data: totalPages });
      } else {
        sendResponse({ status: 'error', error: 'Не удалось извлечь количество страниц' });
      }
    } else {
      console.warn('Модуль prlib не загружен на этой странице.');
      sendResponse({ status: 'error', error: 'Модуль Президентской Библиотеки не инициализирован.' });
    }
    return false;
  }

  // --- Яндекс.Архив (yandexArchive) ---
  if (message.type === 'getPageInfo') {
    if (content.yandexArchive && typeof content.yandexArchive.getPageInfo === 'function') {
      sendResponse({ data: content.yandexArchive.getPageInfo() });
    } else {
      console.warn('Модуль yandexArchive не загружен на этой странице.');
      sendResponse({ data: null, error: 'Модуль Яндекс.Архива не инициализирован.' });
    }
    return false;
  }

  if (message.type === 'getAllPageInfo') {
    if (content.yandexArchive && typeof content.yandexArchive.getAllPageInfo === 'function') {
      sendResponse({ data: content.yandexArchive.getAllPageInfo() });
    } else {
      console.warn('Модуль yandexArchive не загружен на этой странице.');
      sendResponse({ data: null, error: 'Модуль Яндекс.Архива не инициализирован.' });
    }
    return false;
  }

  // Принудительный вызов зума из бэкграунда/попапа
  if (message.type === 'triggerZoom') {
    triggerYandexZoom()
      .then(sendResponse);
    return true; // Асинхронный ответ
  }

  // --- Госкаталог (goskatalog) ---
  if (message.type === 'getLotInfo') {
    if (content.goskatalog && typeof content.goskatalog.extractImageUrls === 'function') {
      content.goskatalog.extractImageUrls()
        .then(imageUrls => sendResponse({ data: { imageUrls } }))
        .catch(error => {
          console.error('Ошибка извлечения изображений:', error);
          sendResponse({ data: null, error: error.message });
        });
      return true; // Асинхронный ответ
    } else {
      console.warn('Модуль goskatalog не загружен на этой странице.');
      sendResponse({ data: null, error: 'Модуль Госкаталога не инициализирован.' });
      return false;
    }
  }

  console.log('Неизвестный тип сообщения или целевой модуль отсутствует на странице:', message.type);
  return false;
});

// --- Автоматический запуск зума при загрузке страницы Яндекс.Архива ---
if (/^(ya\.ru|yandex\.ru)$/.test(window.location.hostname) && window.location.pathname.includes('/archive')) {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    triggerYandexZoom();
  } else {
    window.addEventListener('DOMContentLoaded', triggerYandexZoom);
  }
}