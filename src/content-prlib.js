(function initPrlibContent(globalScope) {
  function getTotalPagesPr() {
    const numPagesElement = document.querySelector('#diva-1-num-pages');

    if (!numPagesElement) {
      console.log('Элемент с id="diva-1-num-pages" не найден');
      const altElements = document.querySelectorAll('[id*="num-pages"]');
      if (altElements.length > 0) {
        console.log('Найдены альтернативные элементы с "num-pages" в id:', altElements.length);
        for (const el of altElements) {
          const text = el.textContent.trim();
          const num = parseInt(text, 10);
          if (!isNaN(num) && num > 0) {
            console.log(`Извлечено количество страниц из ${el.id}: ${num}`);
            return num;
          }
          console.log(`Содержимое ${el.id}: ${text} (не число)`);
        }
      }
      return null;
    }

    const numPagesText = numPagesElement.textContent.trim();
    console.log('Содержимое элемента diva-1-num-pages:', numPagesText);

    const numPages = parseInt(numPagesText, 10);

    if (isNaN(numPages) || numPages <= 0) {
      console.log('Некорректное количество страниц:', numPagesText);
      return null;
    }

    console.log('Извлеченное количество страниц:', numPages);
    return numPages;
  }

  function extractDocumentInfo() {
    const scriptTags = Array.from(document.querySelectorAll('script'));
    let settingsText = null;

    for (const s of scriptTags) {
      if (s.textContent.includes('Drupal.settings') && s.textContent.includes('diva')) {
        settingsText = s.textContent;
        break;
      }
    }

    if (!settingsText) {
      console.error('Скрипт с Drupal.settings.diva не найден');
      return null;
    }

    const jsonMatch = settingsText.match(/jQuery\.extend\(Drupal\.settings,\s*(\{[\s\S]*?\})\);/);
    if (!jsonMatch) {
      console.error('Не удалось распарсить объект Drupal.settings');
      return null;
    }

    let settings;
    try {
      settings = JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('JSON.parse failed:', e);
      return null;
    }

    const diva = settings.diva;
    const instance = diva && (diva['1'] || diva[1]);
    const objectDataUrl = instance?.options?.objectData || null;
    if (!objectDataUrl) {
      console.error('diva.options.objectData не найден');
      return null;
    }

    const fgMatch = objectDataUrl.match(/\/public\/[^\/]+\/(\d+)\/[^\/]+\.json$/);
    const fileGroup = fgMatch ? fgMatch[1] : null;
    if (!fileGroup) {
      console.warn('Не удалось извлечь fileGroup из objectDataUrl');
    }

    return { objectDataUrl, fileGroup };
  }

  async function getDocumentMetadata(objectDataUrl) {
    const resp = await fetch(objectDataUrl, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`Ошибка загрузки JSON: ${resp.status}`);
    const data = await resp.json();

    const itemTitle = data.item_title;
    const pgs = Array.isArray(data.pgs) ? data.pgs : [];
    const pageCount = pgs.length;
    const files = pgs.map(pg => pg.f);

    return { itemTitle, pageCount, files };
  }

  function getDocumentInfoResponse(info) {
    return getDocumentMetadata(info.objectDataUrl).then(meta => ({
      status: 'success',
      data: {
        objectDataUrl: info.objectDataUrl,
        fileGroup: info.fileGroup,
        itemTitle: meta.itemTitle,
        pageCount: meta.pageCount,
        files: meta.files
      }
    }));
  }

  function waitForDocumentInfo() {
    return new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const newInfo = extractDocumentInfo();
        if (newInfo) {
          observer.disconnect();
          resolve(newInfo);
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  }

  async function getDocumentInfo() {
    const info = extractDocumentInfo() || await waitForDocumentInfo();
    return getDocumentInfoResponse(info);
  }

  globalScope.WebArchivistContent = Object.assign(globalScope.WebArchivistContent || {}, {
    prlib: {
      getTotalPagesPr,
      getDocumentInfo
    }
  });
})(window);
