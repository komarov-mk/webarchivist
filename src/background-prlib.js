/**
 * src/background-prlib.js - Фоновые обработчики для Президентской Библиотеки.
 */

function handleFetchTile(message, sendResponse) {
  let safeUrl;
  try {
    safeUrl = new URL(message.url);
  } catch (e) {
    sendResponse({ status: 'error', error: `Некорректный URL: ${e.message}` });
    return;
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
}

function handleFetchJson(message, sendResponse) {
  let safeUrl;
  try {
    safeUrl = new URL(message.url);
  } catch (e) {
    sendResponse({ status: 'error', error: `Некорректный URL: ${e.message}` });
    return;
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
}