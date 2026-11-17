/**  site-yandex.js - Логика обработки и скачивания страниц Яндекс.Архива. */

window.WebArchivistDebug?.push("src/site-yandex.js загружен");
console.log("[DEBUG 4/7] src/site-yandex.js загружен.");

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
        case "zipping": // ZIP собирается в background
            setProgress(100, M.ZIP_GENERATING);
            setStatus(M.ZIP_GENERATING);
            break;
        case "savingZip": // архив сохраняется через chrome.downloads
            setProgress(100, M.ZIP_DOWNLOADING);
            setStatus(M.ZIP_DOWNLOADING);
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

// Итоговый отчёт о скачивании (ZIP): ошибки или их отсутствие.
// Результат приходит из background (downloadRangeZip).
function showZipSummaryYA(result) {
    const M = WebArchivistPopupConfig.MESSAGES;
    const d = result?.data || {};
    const errs = d.errors || [];
    hideProgress();

    if (result?.status === "success") {
        setStatus(M.ZIP_DONE_ALL(d.downloaded, d.total));
        showNotification("Скачивание ZIP (Я.Архив)", `Архив "${d.zipName}" готов: ${d.downloaded} из ${d.total} стр., без ошибок.`);
    } else if (result?.status === "partial") {
        setStatus(M.ZIP_DONE_PARTIAL(d.downloaded, d.total, errs), true);
        showNotification("Скачивание ZIP (Я.Архив)", `Архив "${d.zipName || "ZIP"}" готов с ошибками: ${d.downloaded} из ${d.total} стр.`);
    } else {
        setStatus(M.ZIP_DONE_FAIL(d.total, errs), true);
        showNotification("Скачивание ZIP (Я.Архив)", "Не удалось скачать ни одну страницу.");
    }
}

// ZIP-скачивание теперь ЦЕЛИКОМ выполняется в background (downloadRangeZip):
// JSZip уже импортирован в service worker, байты изображений не передаются
// через messaging (большие сканы превышали лимит размера сообщения — это и
// ломало ZIP), а попап можно закрыть без риска сорвать загрузку. Прогресс
// приходит сообщениями yaRangeProgress (см. handleRangeProgressYA).
async function processZipDownloadYA({ title, startPage, endPage, baseUrl, pageNodeIds }) {
    setControlsEnabled(false);
    const M = WebArchivistPopupConfig.MESSAGES;
    const total = endPage - startPage + 1;
    setStatus(M.ZIP_PREPARING({ start: startPage, end: endPage }));
    setProgress(0, M.RANGE_PROGRESS(0, total));

    try {
        const result = await sendMessageToBackground({
            type: "downloadRangeZip",
            data: { title, startPage, endPage, baseUrl, pageNodeIds }
        });
        showZipSummaryYA(result);
    } catch (zipError) {
        console.error("Ошибка ZIP (Я.Архив):", zipError);
        setStatus(`Ошибка ZIP (Я.Архив): ${zipError.message}`, true);
    } finally {
        hideProgress();
        setControlsEnabled(true);
    }
}
