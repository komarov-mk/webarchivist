/**  site-yandex.js - Логика обработки и скачивания страниц Яндекс.Архива. */

window.WebArchivistDebug?.push("src/site-yandex.js загружен");
console.log("[DEBUG 4/7] src/site-yandex.js загружен.");

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Прогресс скачивания диапазона (сообщения из background) ---

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "yaRangeProgress" && message.data) {
        handleRangeProgressYA(message.data);
    }
});

function handleRangeProgressYA(p) {
    const M = WebArchivistPopupConfig.MESSAGES;
    const percent = p.total > 0 ? Math.round(((p.current - 1) / p.total) * 100) : 0;

    switch (p.phase) {
        case "opening":
            setProgress(percent, M.RANGE_PAGE_OPENING(p.page, p.total));
            setStatus(M.RANGE_PAGE_OPENING(p.page, p.total));
            break;
        case "waiting":
            setProgress(percent, M.RANGE_PAGE_WAITING(p.page, p.total));
            setStatus(M.RANGE_PAGE_WAITING(p.page, p.total));
            break;
        case "downloading":
            setProgress(percent, M.RANGE_PAGE_DOWNLOADING(p.page, p.total));
            setStatus(M.RANGE_PAGE_DOWNLOADING(p.page, p.total));
            break;
        case "pageDone":
            setProgress(Math.round((p.current / p.total) * 100), M.RANGE_PAGE_DONE(p.downloaded, p.total));
            setStatus(M.RANGE_PAGE_DONE(p.downloaded, p.total));
            break;
        case "pageError":
            setProgress(Math.round((p.current / p.total) * 100), M.RANGE_PAGE_ERROR(p.page, p.total, p.error));
            setStatus(M.RANGE_PAGE_ERROR(p.page, p.total, p.error), true);
            break;
        case "finished":
            setProgress(100, M.RANGE_FINISHING);
            break;
    }
}

// Итоговый отчёт о скачивании диапазона (без ZIP): ошибки или их отсутствие
function showRangeSummaryYA(result) {
    const M = WebArchivistPopupConfig.MESSAGES;
    const d = result?.data || {};
    const errs = d.errors || [];
    hideProgress();

    if (result?.status === "success") {
        setStatus(M.RANGE_DONE_ALL(d.downloaded, d.total));
        showNotification("Скачивание (Я.Архив)", `Готово: ${d.downloaded} из ${d.total} стр., без ошибок.`);
    } else if (result?.status === "partial") {
        setStatus(M.RANGE_DONE_PARTIAL(d.downloaded, d.total, errs), true);
        showNotification("Скачивание (Я.Архив)", `Скачано ${d.downloaded} из ${d.total}. Ошибок: ${errs.length}.`);
    } else {
        setStatus(M.RANGE_DONE_FAIL(d.total, errs), true);
        showNotification("Скачивание (Я.Архив)", "Не удалось скачать ни одну страницу.");
    }
}

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

// Запрашивает метаданные документа (title, pageNumber, totalPages, baseUrl,
// docId, pageNodeIds) из DOM открытой страницы. При недоступности нового
// сообщения возвращается к прежнему getAllPageInfo.
async function requestDocumentMetaYA() {
    setStatus(WebArchivistPopupConfig.MESSAGES.DOC_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();
        try {
            const res = await sendMessageToTab(tab.id, { type: "getDocumentMeta" });
            if (res?.data) {
                setStatus(WebArchivistPopupConfig.MESSAGES.DOC_DATA_SUCCESS);
                return res.data;
            }
        } catch (metaError) {
            console.warn("getDocumentMeta недоступен, использую getAllPageInfo:", metaError);
        }
        return await requestAllInfoYA();
    } catch (error) {
        console.error("Ошибка в requestDocumentMetaYA:", error);
        setStatus(`Ошибка (Я.Архив): ${error.message}`, true);
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}

async function handleDownloadAllYA() {
    clearStatus();
    setControlsEnabled(false);
    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PREPARING({}));

    try {
        const { title, totalPages, baseUrl, pageNodeIds } = await requestDocumentMetaYA();
        const total = parseInt(totalPages, 10);
        if (totalPages === "unknown" || isNaN(total) || total <= 0) {
            throw new Error("Общее количество страниц для Яндекс.Архива неизвестно или некорректно.");
        }
        await processZipDownloadYA({ title, startPage: 1, endPage: total, baseUrl, pageNodeIds });
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
        const docInfo = await requestDocumentMetaYA();
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
            // Скачивание по отдельности выполняет background: он навигирует
            // текущую вкладку по страницам и шлёт прогресс (yaRangeProgress).
            const rangeTotal = endPage - startPage + 1;
            setProgress(0, WebArchivistPopupConfig.MESSAGES.RANGE_PROGRESS(0, rangeTotal));
            setStatus(WebArchivistPopupConfig.MESSAGES.RANGE_PROGRESS(0, rangeTotal));
            const result = await sendMessageToBackground({
                type: "downloadRangeImages",
                data: { ...docInfo, startPage, endPage }
            });
            showRangeSummaryYA(result);
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

// Навигация ТЕКУЩЕЙ вкладки на URL с ожиданием загрузки.
// Временные вкладки не создаются — работа расширения не сбрасывается.
async function navigateCurrentTabAndWaitYA(tabId, url) {
    console.log(`Я.Архив: навигация текущей вкладки ${tabId} на ${url}`);
    await chrome.tabs.update(tabId, { url });

    return new Promise((resolve, reject) => {
        const timeoutDuration = 45000;
        let timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error(`Таймаут загрузки страницы (${url})`));
        }, timeoutDuration);

        const listener = (changedTabId, changeInfo) => {
            if (changedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => resolve(tabId), 500);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Ожидание готовности content script после навигации (страница перезагрузилась).
async function waitForTabReadyYA(tabId, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await sendMessageToTab(tabId, { type: "getDocumentMeta" });
            if (res?.data) return res.data;
        } catch (e) {}
        await sleepMs(500);
    }
    return null;
}

// Итоговый отчёт о скачивании (ZIP): ошибки или их отсутствие
function showZipSummaryYA(zipName, downloaded, total, errors) {
    const M = WebArchivistPopupConfig.MESSAGES;
    if (errors.length === 0) {
        setStatus(M.ZIP_DOWNLOAD_SUCCESS);
        showNotification("Скачивание ZIP", `Файл "${zipName}" скачан: ${downloaded} из ${total} стр., без ошибок.`);
    } else {
        const list = errors.map(e => `стр. ${e.page}: ${e.error}`).join("; ");
        setStatus(`ZIP скачан: ${downloaded} из ${total} стр. Ошибки (${errors.length}): ${list}`, true);
        showNotification("Скачивание ZIP", `Файл "${zipName}" скачан с ошибками: ${downloaded} из ${total} стр.`);
    }
}

async function processZipDownloadYA({ title, startPage, endPage, baseUrl, pageNodeIds }) {
    if (typeof JSZip !== 'function') throw new Error('Библиотека JSZip не найдена.');
    setControlsEnabled(false);
    setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_PREPARING({ start: startPage, end: endPage }));
    const zip = new JSZip();
    const nodeIds = pageNodeIds && typeof pageNodeIds === "object" ? { ...pageNodeIds } : {};
    const errors = [];
    const total = endPage - startPage + 1;
    let downloaded = 0;
    let tabId = null;

    try {
        const tab = await getActiveTab();
        tabId = tab.id;

        for (let page = startPage; page <= endPage; page++) {
            const index = page - startPage + 1;
            const pageUrl = `${baseUrl}/${page}`;
            const percent = Math.round(((index - 1) / total) * 100);
            const M = WebArchivistPopupConfig.MESSAGES;

            try {
                // 1. Открываем страницу документа в ТЕКУЩЕЙ вкладке
                setProgress(percent, M.ZIP_PAGE_OPENING(page, endPage));
                setStatus(M.ZIP_PAGE_OPENING(page, endPage));
                await sendMessageToBackground({ type: "clearTabCapture", data: { tabId } });
                await navigateCurrentTabAndWaitYA(tabId, pageUrl);

                // 2. Ждём готовности content script, обновляем nodeId сканов из DOM
                const meta = await waitForTabReadyYA(tabId);
                if (meta?.pageNodeIds && typeof meta.pageNodeIds === "object") {
                    Object.assign(nodeIds, meta.pageNodeIds);
                }

                // 3. Авто-зум запускается при загрузке страницы; ждём источник
                //    оригинала: nodeId (из миниатюр) или перехваченный URL
                setProgress(percent, M.ZIP_PAGE_IMAGE_URL_WAIT(page, endPage));
                const imageResponse = await sendMessageToBackground({
                    type: "fetchNextImage",
                    data: { tabId, pageNumber: page }
                });
                const nodeId = nodeIds[String(page)] || imageResponse?.data?.nodeId || null;
                const imageUrl = imageResponse?.data?.url || null;

                if (!nodeId && !imageUrl) {
                    throw new Error("оригинал не получен (нет nodeId и URL)");
                }

                // 4. Скачиваем blob (приоритет у image-grant по nodeId)
                setProgress(percent, M.ZIP_PAGE_IMAGE_DOWNLOADING(page, endPage));
                const blobResp = await sendMessageToBackground({ type: "fetchImageBlob", data: { url: imageUrl, nodeId } });

                if (blobResp.status !== 'success' || !blobResp.data?.blob) {
                    throw new Error(blobResp?.error || `Не удалось получить Blob для стр. ${page}`);
                }
                const uint8Array = new Uint8Array(Object.values(blobResp.data.blob));
                const actualBlob = new Blob([uint8Array], { type: blobResp.data.contentType || "image/jpeg" });

                if (actualBlob.size === 0) {
                    throw new Error("пустое изображение");
                }

                const filenameInZip = WebArchivist.truncateFilename(`${title} - ${page}.jfif`, 90);
                zip.file(filenameInZip, actualBlob);
                downloaded++;
                setProgress(Math.round((index / total) * 100), M.ZIP_PAGE_ADDED(page, endPage));
                setStatus(M.ZIP_PAGE_ADDED(page, endPage));

            } catch (pageError) {
                console.error(`Ошибка на стр. ${page}:`, pageError);
                errors.push({ page, error: pageError.message });
                setProgress(Math.round((index / total) * 100), `Стр. ${page}/${endPage}: ошибка — ${pageError.message}`);
                setStatus(`Стр. ${page}/${endPage}: ошибка — ${pageError.message}`, true);
            }
        }

        if (Object.keys(zip.files).length === 0) throw new Error("Не удалось добавить файлы в ZIP.");

        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING);
        const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
            const percent = Math.round(metadata.percent);
            if (percent % 5 === 0 || percent === 100) {
                setProgress(100, WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING_PROGRESS(percent));
            }
        });

        const zipName = WebArchivist.truncateFilename(`${title} (Стр. ${startPage}-${endPage}).zip`);
        const zipUrl = URL.createObjectURL(zipBlob);

        setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_DOWNLOADING);
        await downloadFile({ url: zipUrl, filename: zipName });
        URL.revokeObjectURL(zipUrl);

        // Итоговый отчёт: сколько скачано и были ли ошибки
        showZipSummaryYA(zipName, downloaded, total, errors);
    } catch (zipError) {
        console.error(zipError);
        setStatus(`Ошибка ZIP (Яндекс.Архив): ${zipError.message}`, true);
    } finally {
        hideProgress();
        setControlsEnabled(true);
    }
}
