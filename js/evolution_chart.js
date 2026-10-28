// echarts 按需加載：首屏不阻塞，第一次繪圖時才動態插入 <script>（約 1MB / gzip 0.34MB）。
// 由 evolution-web/src/components/evolution_graph.rs 通過 wasm-bindgen 調用，
// 兩個方法都返回 Promise，Rust 端會 await。
(function (window) {
    'use strict';

    let loadingPromise = null;

    function ensureEcharts() {
        if (window.echarts) {
            return Promise.resolve(window.echarts);
        }
        if (!loadingPromise) {
            loadingPromise = new Promise(function (resolve, reject) {
                const script = document.createElement('script');
                script.src = '/js/echarts.min.js';
                script.async = true;
                script.onload = function () { resolve(window.echarts); };
                script.onerror = function () {
                    loadingPromise = null; // 允許重試
                    reject(new Error('echarts 加載失敗'));
                };
                document.head.appendChild(script);
            });
        }
        return loadingPromise;
    }

    window.evolutionChart = {
        // 初始化圖表：等 echarts 就緒 → 清除舊實例 → 返回新實例
        initAsync: async function (dom) {
            await ensureEcharts();
            const old = document.querySelector('.evolution-graph div');
            if (old) {
                try { window.echarts.dispose(old); } catch (e) { /* 忽略 */ }
            }
            return window.echarts.init(dom);
        },

        // 設置圖表配置
        setOptionAsync: async function (chart, option) {
            await ensureEcharts();
            chart.setOption(option);
            return true;
        },
    };
})(window);
