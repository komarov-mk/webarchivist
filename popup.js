/**
 * popup.js - Главный координатор расширения (Изолированная область видимости).
 */
{
    console.log("[DEBUG 7/7] Файл popup.js успешно загружен в память.");
    window.WebArchivistDebug?.push("popup.js загружен");

    // Защищенное получение конфигурации во избежание падения парсера
    const config = typeof WebArchivistPopupConfig !== 'undefined' ? WebArchivistPopupConfig : null;
    if (!config) {
        console.error("[CRITICAL ERROR] Объект WebArchivistPopupConfig не найден! Проверьте загрузку src/popup-config.js");
    }

    // Эти константы теперь локальны для этого блока и не конфликтуют с глобальными!
    const GITHUB_MANIFEST_URL = config?.GITHUB_MANIFEST_URL || "";
    const GITHUB_REPO_URL = config?.GITHUB_REPO_URL || "";
    const SITES = config?.SITES || {};
    const MESSAGES = config?.MESSAGES || { INIT: "Инициализация...", INIT_ERROR: "Ошибка инициализации", UNSUPPORTED_SITE: "Сайт не поддерживается" };

    // --- Проверка версии на GitHub ---
    async function checkExtensionVersion() {
        console.log("[VERSION] Запуск проверки обновлений...");
        const messageList = domElements.messageList;
        if (!messageList) {
            console.warn("[VERSION] messageList не найден для вывода версии.");
            return;
        }

        try {
            const response = await fetch(GITHUB_MANIFEST_URL, { cache: "no-cache" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const remoteManifest = await response.json();
            const latestVersion = remoteManifest.version;
            const currentVersion = chrome.runtime.getManifest().version;

            console.log(`[VERSION] Локальная версия: ${currentVersion}, Удаленная: ${latestVersion}`);

            const isNewerVersion = (v1, v2) => {
                const s1 = v1.split('.').map(Number);
                const s2 = v2.split('.').map(Number);
                for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
                    if ((s2[i] || 0) > (s1[i] || 0)) return true;
                    if ((s2[i] || 0) < (s1[i] || 0)) return false;
                }
                return false;
            };

            let versionLi = document.getElementById('version-status') || document.createElement('li');
            versionLi.id = 'version-status';
            if (!versionLi.parentNode) {
                messageList.firstChild ? messageList.insertBefore(versionLi, messageList.firstChild) : messageList.appendChild(versionLi);
            }

            if (isNewerVersion(currentVersion, latestVersion)) {
                versionLi.textContent = MESSAGES.VERSION_NEW_AVAILABLE ? MESSAGES.VERSION_NEW_AVAILABLE(latestVersion, currentVersion) : `Доступна версия ${latestVersion}`;
                versionLi.style.color = 'orange';

                let updateButton = document.getElementById('updateExtensionBtn') || document.createElement('button');
                updateButton.id = 'updateExtensionBtn';
                updateButton.textContent = "Обновить";
                updateButton.style.marginTop = '5px';
                updateButton.style.display = 'block';
                updateButton.onclick = () => chrome.tabs.create({ url: GITHUB_REPO_URL });
                versionLi.appendChild(updateButton);
            } else {
                versionLi.textContent = MESSAGES.VERSION_LATEST ? MESSAGES.VERSION_LATEST(currentVersion) : `Версия ${currentVersion} актуальна`;
                versionLi.style.color = 'green';
                const existingButton = document.getElementById('updateExtensionBtn');
                if (existingButton) existingButton.remove();
            }
        } catch (error) {
            console.warn("[VERSION] Не удалось проверить обновление:", error.message);
        }
    }

    // --- Маршрутизация событий и UI ---

    function setupEventListeners(siteName) {
        console.log(`[LISTENERS] Навешивание обработчиков событий для сайта: ${siteName}`);
        const reCacheAndListen = (elementKey, event, handler) => {
            if (domElements[elementKey]) {
                const oldElement = domElements[elementKey];
                const newElement = oldElement.cloneNode(true);
                oldElement.parentNode.replaceChild(newElement, oldElement);
                domElements[elementKey] = newElement;
                domElements[elementKey].addEventListener(event, handler);
                console.log(`[LISTENERS] Событие "${event}" привязано к #${elementKey}`);
            } else {
                console.warn(`[LISTENERS] Элемент ${elementKey} не найден в кэше, событие не привязано.`);
            }
        };

        if (siteName === SITES.YANDEX_ARCHIVE?.name) {
            reCacheAndListen('downloadBtn', "click", handleDownloadCurrentYA);
            reCacheAndListen('downloadAllBtn', "click", handleDownloadAllYA);
            reCacheAndListen('downloadRangeBtn', "click", handleDownloadRangeYA);
        } else if (siteName === SITES.GOSKATALOG?.name) {
            reCacheAndListen('downloadLotBtn', "click", handleDownloadLotGoskatalog);
        } else if (siteName === SITES.PRLIB?.name) {
            reCacheAndListen('downloadPageBtn', "click", handleDownloadPagesPrLib);
        }
    }

    function updateUIVisibility(activeSite) {
        console.log("[UI] Обновление видимости элементов интерфейса...");
        Object.values(SITES).forEach(siteConfig => {
            siteConfig.elements.forEach(elId => {
                if (domElements[elId]) domElements[elId].style.display = "none";
            });
        });
        if (domElements.zipModeLabel) domElements.zipModeLabel.style.display = "none";

        if (activeSite) {
            console.log(`[UI] Активация интерфейса для сайта: ${activeSite.name}`);
            domElements.popupHeader.textContent = activeSite.name;
            activeSite.elements.forEach(elId => {
                if (domElements[elId]) {
                     domElements[elId].style.display = "";
                }
            });
            if (activeSite === SITES.PRLIB && domElements.zipModeLabel) {
                domElements.zipModeLabel.style.display = "";
            }
        } else {
            console.log("[UI] Активный сайт не поддерживается расширением.");
            domElements.popupHeader.textContent = MESSAGES.UNSUPPORTED_SITE;
            setStatus(MESSAGES.SUPPORTED_SITES_INFO, true);
        }
    }

    async function initializePopup() {
        console.log("[INIT] НАЧАЛО ИНИЦИАЛИЗАЦИИ ПОПАПА...");
        
        // Шаг 1: Кэшируем DOM
        cacheDOMElements();
        
        if (!domElements.messageList || !domElements.popupHeader) {
            console.error("[CRITICAL ERROR] Не найден messageList или popupHeader в DOM!");
            return;
        }

        clearStatus();
        setControlsEnabled(false);
        setStatus(MESSAGES.INIT);

        try {
            // Шаг 2: Получаем вкладку
            console.log("[INIT] Запрос активной вкладки через API...");
            const tab = await getActiveTab();
            console.log("[INIT] Активная вкладка получена успешно:", tab);
            
            const url = tab.url || "";
            console.log("[INIT] Текущий URL вкладки:", url);
            let activeSite = null;

            // Шаг 3: Идентифицируем сайт
            if (SITES.YANDEX_ARCHIVE?.regex.test(url)) activeSite = SITES.YANDEX_ARCHIVE;
            else if (SITES.GOSKATALOG?.regex.test(url)) activeSite = SITES.GOSKATALOG;
            else if (SITES.PRLIB?.regex.test(url)) activeSite = SITES.PRLIB;

            console.log("[INIT] Определенный сайт конфигурации:", activeSite ? activeSite.name : "НЕТ (Не поддерживается)");

            updateUIVisibility(activeSite);

            if (activeSite) {
                // Шаг 4: Конкретная логика сайтов
                console.log(`[INIT] Запуск специфичной инициализации для ${activeSite.name}...`);
                
                if (activeSite === SITES.YANDEX_ARCHIVE) {
                    try {
                        console.log("[INIT-YANDEX] Запрос информации о документе...");
                        const allInfo = await requestAllInfoYA();
                        console.log("[INIT-YANDEX] Получена информация:", allInfo);
                        if (allInfo.totalPages === "unknown" || parseInt(allInfo.totalPages, 10) <= 0) {
                            if (domElements.downloadAllBtn) domElements.downloadAllBtn.disabled = true;
                            setStatus(`Я.Архив: Общее кол-во страниц неизвестно.`);
                        } else {
                            setStatus(`Документ (Я.Архив): ${allInfo.title || 'Без названия'}, ${allInfo.totalPages} стр.`);
                        }
                    } catch (e) {
                        console.error("[INIT-YANDEX] Сбой получения информации:", e);
                        setStatus(`Не удалось получить инфо о документе: ${e.message.substring(0, 50)}...`, true);
                    }
                } else if (activeSite === SITES.GOSKATALOG) {
                    console.log("[INIT-GOSKATALOG] Подготовка UI завершена.");
                    setStatus("Госкаталог.рф: Готово к скачиванию.");
                } else if (activeSite === SITES.PRLIB) {
                    if (domElements.downloadPageBtn) domElements.downloadPageBtn.disabled = true;
                    console.log("[INIT-PRLIB] Запрос метаданных документа...");
                    await requestDocumentInfoPrLib();
                    if (domElements.downloadPageBtn && prlibCurrentDocumentInfo) {
                         domElements.downloadPageBtn.disabled = false;
                    }
                }

                // Шаг 5: Навешиваем клики
                setupEventListeners(activeSite.name);
                setControlsEnabled(true);
                console.log("[INIT] ИНИЦИАЛИЗАЦИЯ УСПЕШНО ЗАВЕРШЕНА.");
            }
        } catch (error) {
            console.error("[INIT-FATAL] Критический сбой во время инициализации:", error);
            if (domElements.popupHeader) domElements.popupHeader.textContent = MESSAGES.INIT_ERROR;
            setStatus(error.message || MESSAGES.UNKNOWN_ERROR, true);
            setControlsEnabled(false);
        }
    }

    // Запуск приложения
    document.addEventListener('DOMContentLoaded', () => {
        console.log("[EVENT] DOMContentLoaded сработал! Запуск скриптов...");
        window.WebArchivistDebug?.push("DOMContentLoaded event fired");
        
        initializePopup().catch(err => {
            console.error("[INIT-PROMISE] Необработанная ошибка в Promise инициализации:", err);
        });
        
        checkExtensionVersion().catch(err => {
             console.error("[VERSION-PROMISE] Ошибка проверки версии:", err);
        });
    });
}