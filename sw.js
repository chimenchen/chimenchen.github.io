const CACHE_NAME = 'koushing-v1';
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

    '/pure.css',
    '/styles.css',
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

    '/favicon.ico',

];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});