chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Получено сообщение в contentScript.js:', message);
  const content = window.WebArchivistContent || {};

  if (message.type === 'getDocumentInfo') {
    content.prlib.getDocumentInfo()
      .then(sendResponse)
      .catch(err => {
        console.error('Ошибка при getDocumentInfo:', err);
        sendResponse({ status: 'error', error: err.message });
      });
    return true;
  }

  if (message.type === 'getTotalPagesPr') {
    const totalPages = content.prlib.getTotalPagesPr();
    if (totalPages !== null) {
      sendResponse({ status: 'success', data: totalPages });
    } else {
      sendResponse({ status: 'error', error: 'Не удалось извлечь количество страниц' });
    }
    return false;
  }

  if (message.type === 'getPageInfo') {
    sendResponse({ data: content.yandexArchive.getPageInfo() });
    return false;
  }

  if (message.type === 'getAllPageInfo') {
    sendResponse({ data: content.yandexArchive.getAllPageInfo() });
    return false;
  }

  if (message.type === 'getLotInfo') {
    content.goskatalog.extractImageUrls()
      .then(imageUrls => sendResponse({ data: { imageUrls } }))
      .catch(error => {
        console.error('Ошибка извлечения изображений:', error);
        sendResponse({ data: null, error: error.message });
      });
    return true;
  }

  return false;
});
