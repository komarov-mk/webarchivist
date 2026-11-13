(function initYandexArchiveContent(globalScope) {
  function getTitle() {
    const rawTitle = document.title.split(" — ")[0]?.trim() || document.title.trim();
    return WebArchivist.sanitizeFilename(rawTitle);
  }

  function getPageNumber() {
    const urlParts = window.location.href.split('/');
    const pageNumber = urlParts[urlParts.length - 1];
    return !isNaN(pageNumber) && isFinite(pageNumber) ? pageNumber : "unknown";
  }

  // Собирает nodeId сканов из миниатюр просмотрщика и полосы прокрутки:
  // /archive/api/image?id=<nodeId>&type=thumb&page=<номер скана>
  function getPageNodeIds() {
    const result = {};
    const candidates = new Set();

    document.querySelectorAll('img[src*="/archive/api/image"]').forEach(img => {
      if (img.src) candidates.add(img.src);
    });

    document.querySelectorAll('source[srcset*="/archive/api/image"]').forEach(source => {
      (source.srcset || '').split(',').forEach(part => {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.add(url);
      });
    });

    candidates.forEach(rawUrl => {
      try {
        const u = new URL(rawUrl, location.origin);
        const id = u.searchParams.get('id');
        const page = u.searchParams.get('page');
        if (id && page && /^\d+$/.test(page)) {
          result[page] = id;
        }
      } catch (e) {}
    });

    return result;
  }

  // Ищет количество страниц документа в данных Next.js
  function getTotalPagesFromNextData() {
    const nextData = document.querySelector('#__NEXT_DATA__');
    if (!nextData) return null;

    let found = null;
    const countKeyRe = /^(pagesCount|totalPages|partsCount|scansCount|pagesTotal|scansTotal)$/i;
    const arrayKeyRe = /^(pages|parts|scans|thumbs|files|nodes|leaves)$/i;

    const walk = (obj, key) => {
      if (found || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        if (key && arrayKeyRe.test(key) && obj.length > 0) {
          found = obj.length;
          return;
        }
        obj.forEach(item => walk(item, key));
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (found) return;
        if (typeof v === 'number' && countKeyRe.test(k) && v > 0) {
          found = v;
          return;
        }
        walk(v, k);
      }
    };

    try {
      walk(JSON.parse(nextData.textContent).props, '');
    } catch (e) {
      return null;
    }

    return found;
  }

  function getTotalPages() {
    const paginationElement = document.querySelector('div[class*="ShortPagination"]');
    if (paginationElement) {
      const parts = paginationElement.textContent.split('/');
      if (parts.length > 1) {
        const total = parseInt(parts[1].trim(), 10);
        if (!isNaN(total) && total > 0) return String(total);
      }
    }

    const fromNextData = getTotalPagesFromNextData();
    if (fromNextData) return String(fromNextData);

    const nodeIds = getPageNodeIds();
    const fromThumbs = Object.keys(nodeIds).reduce((max, p) => Math.max(max, parseInt(p, 10) || 0), 0);
    if (fromThumbs > 0) return String(fromThumbs);

    let maxLink = 0;
    document.querySelectorAll('a[href*="/archive/catalog/"]').forEach(a => {
      const tail = (a.getAttribute('href') || '').split('/').pop().split('?')[0];
      const num = parseInt(tail, 10);
      if (!isNaN(num) && num > maxLink) maxLink = num;
    });
    if (maxLink > 0) return String(maxLink);

    return "unknown";
  }

  function getBaseUrl() {
    const urlParts = window.location.href.split('/');
    urlParts.pop();
    return urlParts.join('/');
  }

  function getPageInfo() {
    return {
      title: getTitle(),
      pageNumber: getPageNumber(),
      totalPages: getTotalPages()
    };
  }

  function getAllPageInfo() {
    return {
      title: getTitle(),
      totalPages: getTotalPages(),
      baseUrl: getBaseUrl()
    };
  }

  // Полные метаданные документа: количество страниц, docId и nodeId каждого скана
  function getDocumentMeta() {
    return {
      title: getTitle(),
      pageNumber: getPageNumber(),
      totalPages: getTotalPages(),
      baseUrl: getBaseUrl(),
      docId: getDocId(),
      pageNodeIds: getPageNodeIds()
    };
  }

  // Fallback: достаём docId (nodeId) из данных Next.js, если запросы превью не были перехвачены
  function getDocId() {
    const nextData = document.querySelector('#__NEXT_DATA__');
    if (!nextData) return null;

    let found = null;
    const walk = (obj) => {
      if (found || !obj || typeof obj !== 'object') return;
      if (typeof obj.docId === 'string') {
        found = obj.docId;
        return;
      }
      Object.values(obj).forEach(walk);
    };

    try {
      walk(JSON.parse(nextData.textContent).props);
    } catch (e) {
      return null;
    }

    return found;
  }

  globalScope.WebArchivistContent = Object.assign(globalScope.WebArchivistContent || {}, {
    yandexArchive: {
      getPageInfo,
      getAllPageInfo,
      getDocId,
      getDocumentMeta
    }
  });
})(window);
