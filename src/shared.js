(function initWebArchivistShared(globalScope) {
  const YANDEX_ARCHIVE_HOST_PATTERN = /^(ya\.ru|yandex\.ru)$/;
  const MAX_FILENAME_LENGTH = 100;
  const FILENAME_TRUNCATE_SUFFIX = "...";
  const FILENAME_TRUNCATE_KEEP_CHARS = 4;

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch (e) {
      return null;
    }
  }

  function isYandexArchiveUrl(url) {
    const parsedUrl = parseUrl(url);
    return Boolean(parsedUrl && YANDEX_ARCHIVE_HOST_PATTERN.test(parsedUrl.hostname) && parsedUrl.pathname.startsWith("/archive"));
  }

  function isYandexArchiveOriginalImageUrl(url) {
    const parsedUrl = parseUrl(url);
    return Boolean(parsedUrl &&
      YANDEX_ARCHIVE_HOST_PATTERN.test(parsedUrl.hostname) &&
      parsedUrl.pathname === "/archive/api/image" &&
      parsedUrl.searchParams.get("type") === "original");
  }

  function sanitizeFilename(filename) {
    return String(filename || "").replace(/[\\/:*?"<>|]/g, "_");
  }

  function truncateFilename(filename, maxLength = MAX_FILENAME_LENGTH) {
    const safeFilename = String(filename || "file");
    if (safeFilename.length <= maxLength) {
      return safeFilename;
    }

    const maxBaseLength = maxLength - (FILENAME_TRUNCATE_SUFFIX.length + FILENAME_TRUNCATE_KEEP_CHARS);
    const extensionMatch = safeFilename.match(/\.[^.]+$/);
    const extension = extensionMatch ? extensionMatch[0] : "";
    const baseName = safeFilename.substring(0, safeFilename.length - extension.length);

    if (baseName.length > maxBaseLength) {
      return baseName.substring(0, maxBaseLength) + FILENAME_TRUNCATE_SUFFIX + extension;
    }
    return safeFilename;
  }

  globalScope.WebArchivist = Object.assign(globalScope.WebArchivist || {}, {
    YANDEX_ARCHIVE_HOST_PATTERN,
    MAX_FILENAME_LENGTH,
    sanitizeFilename,
    truncateFilename,
    parseUrl,
    isYandexArchiveUrl,
    isYandexArchiveOriginalImageUrl
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
