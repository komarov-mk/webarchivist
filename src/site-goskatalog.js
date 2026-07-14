/** site-goskatalog.js - Логика работы с сайтом Госкаталог РФ. */

window.WebArchivistDebug?.push("src/site-goskatalog.js загружен");
console.log("[DEBUG 5/7] src/site-goskatalog.js загружен.");


function extractLotIdFromUrl(urlString) {
    try {
        const urlObj = new URL(urlString);
        const hash = urlObj.hash || '';
        const paramsPart = hash.split('?')[1] || '';
        const hashParams = new URLSearchParams(paramsPart);
        const lotId = hashParams.get('id');
        if (!lotId) {
            console.warn(`ID лота не найден в URL: ${urlString}`);
            return null;
        }
        return lotId;
    } catch (error) {
        console.error(`Ошибка извлечения ID лота из URL:`, error);
        return null;
    }
}

async function handleDownloadLotGoskatalog() {
    clearStatus();
    setControlsEnabled(false);
    setStatus(WebArchivistPopupConfig.MESSAGES.LOT_DATA_REQUEST);

    try {
        const tab = await getActiveTab();
        const lotId = extractLotIdFromUrl(tab.url);
        if (!lotId) throw new Error("Не удалось извлечь ID лота из URL (Госкаталог).");

        const res = await sendMessageToTab(tab.id, { type: "getLotInfo" });
        if (!res || !res.data || !res.data.imageUrls || res.data.imageUrls.length === 0) {
            throw new Error("Не удалось получить URL-адреса изображений лота.");
        }
        const { imageUrls, documentTitle } = res.data;
        const baseFilename = documentTitle ? documentTitle.replace(/[<>:"/\\|?*]+/g, '_') : lotId;

        setStatus(WebArchivistPopupConfig.MESSAGES.LOT_IMAGES_FOUND(imageUrls.length));

        let downloadedCount = 0;
        let failedCount = 0;
        for (let i = 0; i < imageUrls.length; i++) {
            const imageUrl = imageUrls[i];
            const originalFilename = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
            const extension = originalFilename.includes('.') ? originalFilename.substring(originalFilename.lastIndexOf('.')) : '.jpg';
            const filename = WebArchivist.truncateFilename(`${baseFilename}_${i + 1}${extension}`);

            try {
                const fullImageUrl = new URL(imageUrl, tab.url).toString();
                await downloadFile({ url: fullImageUrl, filename });
                downloadedCount++;
                setStatus(WebArchivistPopupConfig.MESSAGES.LOT_DOWNLOAD_PROGRESS(downloadedCount, imageUrls.length));
            } catch (imgError) {
                console.error(imgError);
                failedCount++;
                setStatus(`Ошибка при скачивании изображения ${i + 1}: ${imgError.message.substring(0, 60)}...`, true);
            }
        }

        if (failedCount === 0) {
            setStatus(WebArchivistPopupConfig.MESSAGES.LOT_DOWNLOAD_SUCCESS);
            showNotification("Скачивание лота", "Все изображения успешно скачаны!");
        } else {
            setStatus(WebArchivistPopupConfig.MESSAGES.LOT_DOWNLOAD_PARTIAL(downloadedCount, imageUrls.length, failedCount), true);
        }
    } catch (error) {
        console.error(error);
        setStatus(`Ошибка (Госкаталог): ${error.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}