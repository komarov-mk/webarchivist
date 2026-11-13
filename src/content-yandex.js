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

  function getTotalPages() {
    const paginationElement = document.querySelector('.ShortPagination_ShortPagination__08e_C');
    if (!paginationElement) return "unknown";
    const parts = paginationElement.textContent.split('/');
    return parts.length > 1 ? parts[1].trim() : "unknown";
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
      getDocId
    }
  });
})(window);
