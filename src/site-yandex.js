/**  site-yandex.js - Логика обработки и скачивания страниц Яндекс.Архива. */

window.WebArchivistDebug?.push("src/site-yandex.js загружен");
console.log("[DEBUG 4/7] src/site-yandex.js загружен.");

async function requestPageInfoYA() {
    setStatus(WebArchivistPopupConfig.MESSAGES.PAGE_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        const res = await sendMessageToTab(tab.id, { type: "getPageInfo" });
        if (!res || !res.data) throw new Error("Не удалось получить данные страницы (Яндекс.Архив, пустой ответ).");
        setStatus(WebArchivistPopupConfig.MESSAGES.PAGE_DATA_SUCCESS);
        return res.data;
    } catch (error) {
        console.error("Ошибка в requestPageInfoYA:", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}

async function requestAllInfoYA() {
    setStatus(WebArchivistPopupConfig.MESSAGES.DOC_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        const res = await sendMessageToTab(tab.id, { type: "getAllPageInfo" });
        if (!res || !res.data) throw new Error("Не удалось получить данные документа (Яндекс.Архив, пустой ответ).");
        setStatus(WebArchivistPopupConfig.MESSAGES.DOC_DATA_SUCCESS);
        return res.data;
    } catch (error) {
        console.error("Ошибка в requestAllInfoYA:", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}

async function handleDownloadCurrentYA() {
    clearStatus();
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        const pageInfo = WebArchivist.isYandexArchiveOriginalImageUrl(tab.url)
            ? null
            : await requestPageInfoYA();
        setStatus(WebArchivistPopupConfig.MESSAGES.CURRENT_PAGE_IMAGE_SEARCH);

        const resp = await sendMessageToBackground({ type: "getImageUrl" });
        if (!resp || resp.status !== 'success' || !resp.data?.url) {
            throw new Error(resp?.error || "Обработчик getImageUrl в background не вернул URL.");
        }
        const imageUrl = resp.data.url;

        let filename;
        if (resp.data.suggestedFilename) {
            filename = WebArchivist.truncateFilename(resp.data.suggestedFilename);
        } else {
            let baseFn = `${pageInfo.title} - ${pageInfo.pageNumber}`;
            if (pageInfo.totalPages !== 'unknown' && pageInfo.totalPages) {
                baseFn += ` из ${pageInfo.totalPages}`;
            }
            filename = WebArchivist.truncateFilename(baseFn + ".jfif");
        }

        setStatus(WebArchivistPopupConfig.MESSAGES.DOWNLOADING);
        await downloadFile({ url: imageUrl, filename });
        setStatus(WebArchivistPopupConfig.MESSAGES.DOWNLOAD_COMPLETE);
        showNotification("Скачивание (Яндекс.Архив)", `Текущая страница "${filename}" скачана!`);
    } catch (error) {
        console.error("Ошибка скачивания текущей страницы (Яндекс.Архив):", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}

async function handleDownloadAllYA() {
    clearStatus();
    setControlsEnabled(false);
    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PREPARING({}));

    try {
        const { title, totalPages, baseUrl } = await requestAllInfoYA();
        const total = parseInt(totalPages, 10);
        if (totalPages === "unknown" || isNaN(total) || total <= 0) {
            throw new Error("Общее количество страниц для Яндекс.Архива неизвестно или некорректно.");
        }
        await processZipDownloadYA({ title, startPage: 1, endPage: total, baseUrl });
    } catch (error) {
        console.error("Ошибка при скачивании всего документа (Яндекс.Архив):", error);
        setStatus(`Ошибка ZIP (Я.Архив): ${error.message}`, true);
    }
}

async function handleDownloadRangeYA() {
    clearStatus();
    setControlsEnabled(false);

    const startPage = parseInt(domElements.startPage.value, 10);
    const endPage = parseInt(domElements.endPage.value, 10);

    if (isNaN(startPage) || isNaN(endPage) || startPage < 1 || endPage < startPage) {
        setStatus("Ошибка: Некорректный диапазон страниц для Яндекс.Архива.", true);
        setControlsEnabled(true);
        return;
    }

    try {
        const docInfo = await requestAllInfoYA();
        const total = parseInt(docInfo.totalPages, 10);

        if (docInfo.totalPages !== "unknown" && !isNaN(total) && endPage > total) {
            setStatus(`Ошибка: Конечная страница (${endPage}) больше общего числа страниц (${total}) для Яндекс.Архива.`, true);
            setControlsEnabled(true);
            return;
        }

        const useZip = domElements.zipMode.checked;
        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PREPARING({ start: startPage, end: endPage }));

        if (useZip) {
            await processZipDownloadYA({ ...docInfo, startPage, endPage });
        } else {
            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_REQUEST_SENT(startPage, endPage));
            await sendMessageToBackground({
                type: "downloadRangeImages",
                data: { ...docInfo, startPage, endPage }
            });
            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_REQUEST_CONFIRMED);
            showNotification("Скачивание диапазона (Яндекс.Архив)", `Запущено скачивание страниц ${startPage}-${endPage}.`);
        }
    } catch (error) {
        console.error("Ошибка подготовки скачивания диапазона (Яндекс.Архив):", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
    } finally {
        if (!domElements.zipMode.checked) {
            setControlsEnabled(true);
        }
    }
}

async function navigateToPageAndWaitYA(url, pageNumForLog = '') {
    console.log(`Я.Архив ZIP: Открываю временную вкладку ${pageNumForLog} с URL: ${url}`);
    const tab = await chrome.tabs.create({ url, active: false });

    return new Promise((resolve, reject) => {
        const timeoutDuration = 35000;
        let timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.remove(tab.id).catch(e => console.warn(`Я.Архив ZIP: Не удалось закрыть вкладку по таймауту: ${e}`));
            reject(new Error(`Таймаут загрузки вкладки ${tab.id} (${url})`));
        }, timeoutDuration);

        const listener = (tabId, changeInfo) => {
            if (tabId === tab.id) {
                if (changeInfo.status === 'complete') {
                    clearTimeout(timeoutId);
                    chrome.tabs.onUpdated.removeListener(listener);
                    setTimeout(() => resolve(tabId), 1000);
                } else if (changeInfo.status === 'error' || (changeInfo.error && changeInfo.status !== 'loading')) {
                    clearTimeout(timeoutId);
                    chrome.tabs.onUpdated.removeListener(listener);
                    chrome.tabs.remove(tabId).catch(e => console.warn(`Я.Архив ZIP: Не удалось закрыть вкладку после ошибки: ${e}`));
                    reject(new Error(`Ошибка загрузки вкладки ${tabId}: ${changeInfo.error || 'статус error'}`));
                }
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function processZipDownloadYA({ title, startPage, endPage, baseUrl }) {
    if (typeof JSZip !== 'function') throw new Error('Библиотека JSZip не найдена.');
    setControlsEnabled(false);
    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PREPARING({ start: startPage, end: endPage }));
    const zip = new JSZip();
    const collectedUrls = new Set();
    let tempTabId = null;

    try {
        for (let page = startPage; page <= endPage; page++) {
            const pageUrl = `${baseUrl}/${page}`;
            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_OPENING(page, endPage));
            try {
                tempTabId = await navigateToPageAndWaitYA(pageUrl, `${page}/${endPage}`);
                setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_IMAGE_URL_WAIT(page, endPage));

                const imageResponse = await sendMessageToBackground({
                    type: "fetchNextImage",
                    data: { tabId: tempTabId, pageNumber: page }
                });

                if (!imageResponse || imageResponse.status !== 'success' || !imageResponse.data?.url) {
                   setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_EMPTY_IMAGE(page, endPage), true);
                   continue;
                }
                const imageUrl = imageResponse.data.url;

                if (collectedUrls.has(imageUrl)) {
                    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_DUPLICATE_URL(page, endPage));
                    continue;
                }
                collectedUrls.add(imageUrl);

                setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_IMAGE_DOWNLOADING(page, endPage));
                const blobResp = await sendMessageToBackground({ type: "fetchImageBlob", data: { url: imageUrl } });

                if (blobResp.status !== 'success' || !blobResp.data?.blob) {
                    throw new Error(blobResp?.error || `Не удалось получить Blob для стр. ${page}`);
                }
                const uint8Array = new Uint8Array(Object.values(blobResp.data.blob));
                const actualBlob = new Blob([uint8Array], { type: blobResp.data.contentType || "image/jpeg" });

                if (actualBlob.size === 0) {
                    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_EMPTY_IMAGE(page, endPage));
                    continue;
                }

                const filenameInZip = WebArchivist.truncateFilename(`${title} - ${page}.jfif`, 90);
                zip.file(filenameInZip, actualBlob);
                setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PAGE_ADDED(page, endPage));

            } catch (pageError) {
                console.error(`Ошибка на стр. ${page}:`, pageError);
                setStatus(`Стр. ${page}/${endPage}: Ошибка, пропускаю.`, true);
            } finally {
                if (tempTabId) {
                    await chrome.tabs.remove(tempTabId).catch(e => console.warn(`Не удалось закрыть вкладку ${tempTabId}: ${e}`));
                    tempTabId = null;
                }
            }
        }

        if (Object.keys(zip.files).length === 0) throw new Error("Не удалось добавить файлы в ZIP.");

        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING);
        const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
            const percent = Math.round(metadata.percent);
            if (percent % 5 === 0 || percent === 100) {
                setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING_PROGRESS(percent));
            }
        });

        const zipName = WebArchivist.truncateFilename(`${title} (Стр. ${startPage}-${endPage}).zip`);
        const zipUrl = URL.createObjectURL(zipBlob);

        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_DOWNLOADING);
        await downloadFile({ url: zipUrl, filename: zipName });
        URL.revokeObjectURL(zipUrl);

        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_DOWNLOAD_SUCCESS);
        showNotification("Скачивание ZIP", `Файл "${zipName}" успешно скачан.`);
    } catch (zipError) {
        console.error(zipError);
        setStatus(`Ошибка ZIP (Яндекс.Архив): ${zipError.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}