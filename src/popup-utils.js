/**  popup-utils.js - Вспомогательные инструменты для UI и взаимодействия с Chrome API.  */
window.WebArchivistDebug?.push("src/popup-utils.js загружен");
console.log("[DEBUG 3/7] src/popup-utils.js загружен.");

// Глобальный кэш DOM-элементов, который будут использовать все модули
const domElements = {};

/** Кэширует часто используемые DOM-элементы */
function cacheDOMElements() {
    console.log("[INIT-UTILS] Запуск cacheDOMElements()...");
    const ids = [
        "downloadBtn", "downloadLotBtn", "downloadAllBtn", "downloadRangeBtn", "downloadPageBtn",
        "startPage", "endPage", "zipMode", "messageList", "popupHeader"
    ];
    
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`[INIT-UTILS] Внимание: Элемент #${id} не найден в popup.html`);
        }
        domElements[id] = el;
    });

    domElements.rangeInputContainer = document.querySelector('.range-input');
    domElements.zipModeContainer = domElements.zipMode ? domElements.zipMode.closest('label') || domElements.zipMode.parentElement : null;
    domElements.zipModeLabel = document.querySelector('label[for="zipMode"]');
    
    console.log("[INIT-UTILS] Элементы успешно кэшированы:", Object.keys(domElements).filter(k => domElements[k] !== null));
}

// --- Утилиты UI ---

function setStatus(text, isError = false) {
    console.log(`[STATUS-LOG] ${isError ? 'ОШИБКА: ' : ''}${text}`);
    
    // Безопасная проверка: если DOM-элементы еще не закэшированы
    if (!domElements.messageList) {
        console.warn("[STATUS-LOG] Попытка установить статус до кэширования domElements.messageList!");
        domElements.messageList = document.getElementById('messageList');
        if (!domElements.messageList) return;
    }

    let statusLi = document.getElementById('status');
    if (!statusLi) {
        domElements.messageList.innerHTML = ''; 
        statusLi = document.createElement('li');
        statusLi.id = 'status';
        domElements.messageList.appendChild(statusLi);
    }

    if (text === WebArchivistPopupConfig.MESSAGES.SUPPORTED_SITES_INFO) {
        const siteLinks = [
            { url: "https://yandex.ru/archive/", name: "yandex.ru/archive" },
            { url: "https://goskatalog.ru/portal/", name: "goskatalog.ru/portal" },
            { url: "https://www.prlib.ru/", name: "prlib.ru" }
        ];
        const linksHtml = siteLinks.map(site =>
            `<li><a href="${site.url}" target="_blank" rel="noopener noreferrer">${site.name}</a></li>`
        ).join('');
        statusLi.innerHTML = `<span style="color: ${isError ? 'red' : 'inherit'}">Откройте поддерживаемый сайт:</span><ul>${linksHtml}</ul>`;
    } else {
        statusLi.textContent = text;
        statusLi.style.color = isError ? 'red' : (text.includes("Доступна новая версия") ? 'orange' : (text.includes("Версия актуальна") ? 'green' : ''));
    }
}

function clearStatus() {
    const statusLi = document.getElementById('status');
    if (statusLi) statusLi.remove();
}

function setControlsEnabled(enabled) {
    const allControls = [
        domElements.downloadBtn, domElements.downloadAllBtn, domElements.downloadRangeBtn,
        domElements.startPage, domElements.endPage, domElements.zipMode, domElements.downloadLotBtn, domElements.downloadPageBtn
    ].filter(el => el && typeof el.disabled === 'boolean');

    allControls.forEach(el => { el.disabled = !enabled; });
}

function showNotification(title, message) {
    chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: title,
        message: message
    });
}

// --- Промисифицированные обертки Chrome API ---

async function getActiveTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка API запроса вкладки: ${chrome.runtime.lastError.message}`));
            } else if (!tabs || tabs.length === 0 || !tabs[0]) {
                reject(new Error("Активная вкладка не найдена."));
            } else {
                resolve(tabs[0]);
            }
        });
    });
}

async function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка отправки/получения сообщения (вкладка ${tabId}, тип: ${message.type}): ${chrome.runtime.lastError.message}`));
            } else if (response === undefined && message.type !== "fetchNextImage") {
                if (response && response.status === 'error') {
                     reject(new Error(response.error || "Получен пустой ответ от content script с ошибкой."));
                } else if (!response && message.type === "fetchNextImage"){
                     resolve(null);
                } else {
                    reject(new Error(`Получен пустой ответ от content script для сообщения типа: ${message.type}.`));
                }
            } else if (response && response.status === 'error') {
                reject(new Error(response.error || `Content script вернул ошибку для сообщения типа: ${message.type}.`));
            } else {
                resolve(response);
            }
        });
    });
}

async function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка runtime.sendMessage (тип: ${message.type}): ${chrome.runtime.lastError.message}`));
            } else if (!response && message.type !== "fetchNextImage") {
                 reject(new Error(`Получен пустой ответ от background для сообщения типа: ${message.type}.`));
            } else if (response && response.status === 'error') {
                reject(new Error(response.error || `Background script вернул ошибку для сообщения типа: ${message.type}.`));
            } else {
                resolve(response);
            }
        });
    });
}

async function downloadFile(options) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download(options, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Ошибка скачивания файла "${options.filename}": ${chrome.runtime.lastError.message}`));
            } else if (downloadId === undefined) {
                reject(new Error(`API скачивания не вернуло ID загрузки для файла "${options.filename}".`));
            } else {
                resolve(downloadId);
            }
        });
    });
}