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

  globalScope.WebArchivistContent = Object.assign(globalScope.WebArchivistContent || {}, {
    yandexArchive: {
      getPageInfo,
      getAllPageInfo
    }
  });
})(window);
