const CACHE_VERSION = '1.0.649';
const CACHE_NAME = `koukoushengsheng-${CACHE_VERSION}`;

// 首次安裝時只預緩存「小文件」（HTML/CSS/圖標）。
// 各應用的 xxx-web.js / xxx-web_bg.wasm 由頁面以 "?v=<版本>" 的 URL 請求，
// 首次使用時才緩存——版本化的 URL 保證 js 與 wasm 永遠出自同一次構建，
// 不會出現「舊膠水 + 新 wasm」的 LinkError。
// wasm 主程序、字體、espeak 語音數據等大文件改為「首次使用時才緩存」（見 fetch 處理），
// 避免首次訪問時在後台下載上百 MB 而拖慢頁面加載。
const urlsToCache = [
    '/',
    '/index.html',

    '/duyinzdic.html',
    '/duyin.html',

    '/duyin.css',
    '/js/espeakng.js',
    '/js/zhongwen_speak.js',

    '/yunpu.html',
    '/js/yunpu_page.js',
    '/js/yunpu_chart.js',

    '/xilian.html',
    '/js/xilian_chart.js',

    '/evolution.html',

    '/favicon.ico',
    '/manifest.json',
];

// 大文件：緩存優先，首次使用時請求網絡並寫入緩存（之後訪問直接命中緩存）。
const RUNTIME_ASSET_PATTERNS = [
    /\/[^/]+_bg\.wasm$/, // Rust/wasm 主程序
    /^\/fonts\//, // 字體
    /^\/js\/espeakng\.worker/, // espeak worker js 與 data
    /^\/data\//, // 按需加載的數據文件（預留）
];

// 安裝新版本
self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then(cache => {
                // 逐個緩存，單個文件失敗（如 404）不應讓整個安裝失敗，
                // 否則 Service Worker 一直停留在 installing 狀態，用戶會看到「一直加載中」。
                return Promise.all(
                    urlsToCache.map(url =>
                        fetch(url, { cache: 'no-cache' }) // 強制檢查網絡
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error(`HTTP ${response.status}`);
                                }
                                return cache.put(url, response);
                            })
                            .catch(error => {
                                console.warn(`預緩存失敗，已跳過：${url}`, error);
                            })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// 激活時清理舊緩存
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            // 清理舊緩存
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('刪除舊緩存:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // 立即接管所有客戶端
            self.clients.claim()
        ])
    );
});

// 大文件（wasm、字體、語音數據、外置數據）判定
function isRuntimeAsset(url) {
    return RUNTIME_ASSET_PATTERNS.some(pattern => pattern.test(url.pathname));
}

// 緩存優先：命中直接返回，未命中則請求網絡並在後台寫入緩存
function cacheFirst(event) {
    const request = event.request;
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) {
                return cached;
            }
            return fetch(request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clone);
                    });
                }
                return response;
            });
        })
    );
}

// 攔截請求
self.addEventListener('fetch', event => {
    const request = event.request;

    // 只處理同源的 GET 請求
    if (request.method !== 'GET') {
        return;
    }
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    // 頁面導航：網絡優先，失敗時回退到緩存（保證離線/弱網也能打開）
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clone);
                    });
                    return response;
                })
                .catch(() => {
                    return caches.match(request).then(response => {
                        return response || caches.match('/index.html');
                    });
                })
        );
        return;
    }

    // 對樣式文件使用網絡優先策略
    if (url.pathname.endsWith('.css')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // 更新緩存
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, clone);
                    });
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // 大文件：緩存優先（首次使用時才下載）
    if (isRuntimeAsset(url)) {
        cacheFirst(event);
        return;
    }

    // 其他文件使用緩存優先策略
    cacheFirst(event);
});
