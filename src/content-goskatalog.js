(function initGoskatalogContent(globalScope) {
  function waitForElements(selector, timeout = 5000) {
    console.log(`Ожидаю элементы по селектору: ${selector}`);
    return new Promise(resolve => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`Найдено элементов сразу: ${elements.length} по селектору ${selector}`);
        resolve(elements);
        return;
      }

      const observer = new MutationObserver(() => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Найдено элементов после ожидания: ${elements.length} по селектору ${selector}`);
          observer.disconnect();
          resolve(elements);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        console.warn(`Тайм-аут: Элементы не найдены: ${selector}`);
        resolve([]);
      }, timeout);
    });
  }

  async function extractImageUrls() {
    const selectors = [
      'img[ng-src*="/muzfo-imaginator/rest/images/"]',
      'tr td[ng-repeat="image in collectionItem.images"] img[ng-src*="/muzfo-imaginator/rest/images/original/"]',
      'img[src*="/muzfo-imaginator/rest/images/"]',
      '.collection-item img, .lot-details img, [id*="collection"] img'
    ];

    let imageElements = [];
    for (const selector of selectors) {
      imageElements = await waitForElements(selector);
      if (imageElements.length > 0) {
        console.log(`Использован селектор: ${selector}`);
        break;
      }
    }

    if (imageElements.length === 0) {
      throw new Error("Не удалось найти изображения лота на странице.");
    }

    const seenOriginalNames = new Set();
    const imageUrls = [];

    Array.from(imageElements).forEach((element, index) => {
      let imageUrl = element.getAttribute('ng-src') || element.getAttribute('src');
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = 'https://goskatalog.ru' + imageUrl;
      }

      if (!imageUrl || !imageUrl.includes('/muzfo-imaginator/rest/images/')) {
        return;
      }

      const urlParams = new URLSearchParams(new URL(imageUrl).search);
      const originalName = urlParams.get('originalName') || imageUrl;

      if (seenOriginalNames.has(originalName)) {
        console.log(`Дубликат изображения ${index + 1}: ${imageUrl} (originalName: ${originalName})`);
        return;
      }

      seenOriginalNames.add(originalName);
      imageUrls.push(imageUrl);
      console.log(`Извлечённый URL изображения ${imageUrls.length}: ${imageUrl} (originalName: ${originalName})`);
    });

    console.log(`Всего извлечено уникальных изображений: ${imageUrls.length}`, imageUrls);

    if (imageUrls.length === 0) {
      throw new Error("Извлечены пустые или некорректные URL-адреса изображений.");
    }

    return imageUrls;
  }

  globalScope.WebArchivistContent = Object.assign(globalScope.WebArchivistContent || {}, {
    goskatalog: {
      extractImageUrls
    }
  });
})(window);
