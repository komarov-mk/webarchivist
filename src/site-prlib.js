/**
 * site-prlib.js - Логика сборки тайловых изображений и работы с Президентской библиотекой.
 */

let prlibCurrentDocumentInfo = null;

async function requestDocumentInfoPrLib() {
    setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_DOC_DATA_REQUEST);
    setControlsEnabled(false);
    try {
        const tab = await getActiveTab();

        if (tab.status !== 'complete') {
            setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_WAIT_TAB_LOAD);
            await new Promise((resolve) => {
                const listener = (tabIdUpdate, changeInfo) => {
                    if (tabIdUpdate === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        const res = await sendMessageToTab(tab.id, { type: "getDocumentInfo" });
        if (!res || res.status !== 'success' || !res.data) {
            throw new Error(res?.error || WebArchivistPopupConfig.MESSAGES.PRLIB_DOC_DATA_ERROR);
        }
        prlibCurrentDocumentInfo = res.data;

        let statusMessage = `Название: ${prlibCurrentDocumentInfo.itemTitle || '(неизвестно)'}`;
        if (typeof prlibCurrentDocumentInfo.pageCount === 'number') {
             statusMessage += `\nСтраниц: ${prlibCurrentDocumentInfo.pageCount}`;
        } else if (prlibCurrentDocumentInfo.files && Array.isArray(prlibCurrentDocumentInfo.files)) {
            statusMessage += `\nСтраниц (файлов): ${prlibCurrentDocumentInfo.files.length}`;
        } else {
            statusMessage += `\nСтраниц: (неизвестно)`;
        }

        setStatus(statusMessage);
        return prlibCurrentDocumentInfo;
    } catch (error) {
        console.error(error);
        setStatus(`Ошибка (ПБ): ${error.message}`, true);
        prlibCurrentDocumentInfo = null;
        throw error;
    } finally {
        setControlsEnabled(true);
    }
}

async function fetchImageMetadataPrLib(documentKey, documentNumber, documentFileGroup) {
    const infoUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?IIIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}/info.json`;
    const response = await sendMessageToBackground({ type: 'fetchJson', url: infoUrl });

    if (!response || response.status !== 'success' || !response.data) {
        throw new Error(`Ошибка загрузки info.json для ${documentNumber}`);
    }
    const { width, height } = response.data;
    if (!width || !height) throw new Error(`Некорректные размеры в info.json для ${documentNumber}`);
    return { width, height };
}

async function findMaxJtlLevelPrLib(documentKey, documentNumber, documentFileGroup) {
    const baseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${documentFileGroup}/${documentNumber}&JTL=`;
    for (let level = 10; level >= 0; level--) {
        const testUrl = `${baseUrl}${level},0`;
        try {
            const response = await sendMessageToBackground({ type: 'fetchTile', url: testUrl });
            if (response.status === 'success' && response.contentType && response.contentType.startsWith('image/')) {
                return level;
            }
        } catch (error) {
            console.debug(`JTL уровень ${level} для ${documentNumber} недоступен.`);
        }
    }
    throw new Error(`Не найден JTL уровень для ${documentNumber}`);
}

async function assembleTiledImagePrLib(documentKey, documentNumber, fileGroup, forZip = false) {
    if (!forZip) setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_GETTING_SIZES);
    const { width, height } = await fetchImageMetadataPrLib(documentKey, documentNumber, fileGroup);

    if (!forZip) setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_FINDING_JTL);
    const jtlLevel = await findMaxJtlLevelPrLib(documentKey, documentNumber, fileGroup);

    const cols = Math.ceil(width / WebArchivistPopupConfig.PRILIB_TILE_SIZE);
    const rows = Math.ceil(height / WebArchivistPopupConfig.PRILIB_TILE_SIZE);
    const totalTiles = cols * rows;
    const tileBaseUrl = `https://content.prlib.ru/fcgi-bin/iipsrv.fcgi?FIF=/var/data/scans/public/${documentKey}/${fileGroup}/${documentNumber}&JTL=${jtlLevel},`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!forZip) setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_FIRST_TILE);
    const firstTileResponse = await sendMessageToBackground({ type: 'fetchTile', url: tileBaseUrl + '0' });
    if (firstTileResponse.status !== 'success' || !firstTileResponse.data) {
        throw new Error(`Первый тайл для ${documentNumber} не загружен.`);
    }

    const firstImg = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error(`Ошибка первого тайла: ${e.type}`));
        img.src = firstTileResponse.data;
    });

    const actualTileWidth = firstImg.width;
    const actualTileHeight = firstImg.height;
    ctx.drawImage(firstImg, 0, 0);

    if (totalTiles > 1) {
        if (!forZip) setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_OTHER_TILES(totalTiles - 1));
        const tilePromises = [];
        for (let idx = 1; idx < totalTiles; idx++) {
            tilePromises.push((async () => {
                const tileUrl = tileBaseUrl + idx;
                const tileResponse = await sendMessageToBackground({ type: 'fetchTile', url: tileUrl });
                if (tileResponse.status !== 'success' || !tileResponse.data) return;

                await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const r = Math.floor(idx / cols);
                        const c = idx % cols;
                        ctx.drawImage(img, c * actualTileWidth, r * actualTileHeight);
                        resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = tileResponse.data;
                });
                if (!forZip && (idx + 1) % Math.ceil(totalTiles / 10) === 0) {
                     setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_TILE_PROGRESS(idx + 1, totalTiles));
                }
            })());
        }
        await Promise.all(tilePromises);
    }

    if (!forZip) setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_JPEG_GENERATING);
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) return reject(new Error(`Не удалось создать Blob для ${documentNumber}.`));
            resolve(blob);
        }, 'image/jpeg', 0.92);
    });
}

async function handleDownloadPagesPrLib() {
    clearStatus();
    setControlsEnabled(false);
    setStatus("Начало процесса загрузки...");

    try {
        if (!prlibCurrentDocumentInfo || !prlibCurrentDocumentInfo.files) {
            setStatus("Данные отсутствуют, запрашиваю снова...");
            await requestDocumentInfoPrLib();
            if (!prlibCurrentDocumentInfo || !prlibCurrentDocumentInfo.files) {
                 throw new Error("Данные документа не найдены.");
            }
        }

        const { itemTitle, files, fileGroup, pageCount } = prlibCurrentDocumentInfo;
        const totalAvailablePages = (files && Array.isArray(files)) ? files.length : (typeof pageCount === 'number' ? pageCount : 0);

        if (totalAvailablePages === 0) throw new Error("Нет доступных страниц.");

        let start = parseInt(domElements.startPage.value, 10) || 1;
        let end = parseInt(domElements.endPage.value, 10) || start;

        if (start < 1 || end < start || end > totalAvailablePages) {
            throw new Error(`Неверный диапазон. Доступно: 1-${totalAvailablePages}.`);
        }

        const zipModeChecked = domElements.zipMode.checked;

        if (zipModeChecked) {
            if (typeof JSZip !== 'function') throw new Error("Библиотека JSZip не подключена.");
            setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_COLLECTING_ZIP(start, end));
            const zip = new JSZip();

            for (let i = start; i <= end; i++) {
                const pageIndexInFilesArray = i - 1;
                if (!files || !files[pageIndexInFilesArray]) continue;
                const fileNameOnServer = files[pageIndexInFilesArray];
                setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_PAGE_PROCESSING_ZIP(i, end));

                const blob = await assembleTiledImagePrLib(itemTitle, fileNameOnServer, fileGroup, true);
                const inZipName = WebArchivist.truncateFilename(`${itemTitle}-${i}.jpeg`);
                zip.file(inZipName, blob);
                setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_PAGE_ADDED_ZIP(i, end));
            }

            if (Object.keys(zip.files).length === 0) throw new Error("Нет файлов для добавления в ZIP.");

            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING);
            const zipBlob = await zip.generateAsync({ type: 'blob' }, metadata => {
                 if (metadata.percent) setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_GENERATING_PROGRESS(Math.round(metadata.percent)));
            });
            const zipUrl = URL.createObjectURL(zipBlob);
            const zipName = WebArchivist.truncateFilename(`${itemTitle} (Стр. ${start}-${end}).zip`);

            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_DOWNLOADING);
            await downloadFile({ url: zipUrl, filename: zipName });
            URL.revokeObjectURL(zipUrl);

            setStatus(WebArchivistPopupConfig.MESSAGES.ZIP_DOWNLOAD_SUCCESS);
        } else {
            setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_DOWNLOADING_PAGES(start, end));
            for (let i = start; i <= end; i++) {
                const pageIndexInFilesArray = i - 1;
                if (!files || !files[pageIndexInFilesArray]) continue;
                const fileNameOnServer = files[pageIndexInFilesArray];
                setStatus(WebArchivistPopupConfig.MESSAGES.PRLIB_PAGE_DOWNLOADING(i, end));
                const blob = await assembleTiledImagePrLib(itemTitle, fileNameOnServer, fileGroup);
                const filename = WebArchivist.truncateFilename(`${itemTitle}-${i}.jpeg`);
                const blobUrl = URL.createObjectURL(blob);
                await downloadFile({ url: blobUrl, filename: filename });
                URL.revokeObjectURL(blobUrl);
            }
            setStatus("Все запрошенные изображения успешно скачаны.");
        }
    } catch (err) {
        console.error(err);
        setStatus(`Ошибка (ПБ): ${err.message}`, true);
    } finally {
        setControlsEnabled(true);
    }
}