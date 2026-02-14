const CACHE_VERSION = '1.0.504';
const CACHE_NAME = `koukoushengsheng-${CACHE_VERSION}`;

const urlsToCache = [
    '/',
    '/index.html',

    '/duyinzdic.html',
    '/duyinzdic-web.js',
    '/duyinzdic-web_bg.wasm',
    '/duyin.html',
    '/duyin-web.js',
    '/duyin-web_bg.wasm',

    '/espeak.html',
    '/js/demo.js',

    '/duyin.css',
    '/js/espeakng.js',
    '/js/espeakng.worker.data',
    '/js/espeakng.worker.js',
    '/js/zhongwen_speak.js',

    '/fonts/CharisSIL.ttf',
    '/fonts/FZLBK.ttf',
    '/fonts/GentiumPlus.ttf',
    '/fonts/HanaMinA.ttf',
    '/fonts/LingDongQiCheChunTang-2.ttf',
    '/fonts/方正宋刻本秀楷微调.ttf',

    '/yunpu.html',
    '/yunpu-web.js',
    '/yunpu-web_bg.wasm',
    '/js/yunpu_page.js',
    '/js/yunpu_chart.js',

    '/evolution.html',
    '/evolution-web.js',
    '/evolution-web_bg.wasm',

    '/favicon.ico',
];

// 安裝新版本
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // 先檢查關鍵文件是否有更新
                return Promise.all(
                    urlsToCache.map(url => 
                        fetch(url, { cache: 'no-cache' })  // 強制檢查網絡
                            .then(response => {
                                if (response.ok) {
                                    return cache.put(url, response);
                                }
                                throw new Error(`Failed to fetch ${url}`);
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

// 攔截請求
self.addEventListener('fetch', event => {
    // 對樣式文件使用網絡優先策略
    if (event.request.url.endsWith('.css')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // 更新緩存
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, clone);
                    });
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // 其他文件使用緩存優先策略
        event.respondWith(
            caches.match(event.request)
                .then(response => response || fetch(event.request))
        );
    }
});