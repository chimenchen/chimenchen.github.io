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

    // sankey 的 itemLayout 是「系列座標」，畫到畫布上時整個系列還會被 left/top 平移
    // （例如 left:5%、top:50px → 平移 (64.5, 50)）。滑鼠座標是畫布像素，
    // 兩者必須換算，否則命中測試會整體偏移，看起來就是「拖不動」。
    function seriesOffset(chart) {
        try {
            var d = chart.getModel().getSeriesByIndex(0).getData();
            for (var i = 0; i < d.count(); i++) {
                var el = d.getItemGraphicEl(i);
                if (el && el.transform) {
                    return { x: el.transform[4] || 0, y: el.transform[5] || 0 };
                }
            }
        } catch (e) { /* 忽略 */ }
        return { x: 0, y: 0 };
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
            // 拖拽交回 ECharts 預設行為（自己實作容易出錯，已放棄）
            option.tooltip = option.tooltip || {};
            // 位置交回 ECharts 預設（簡單、穩定）；完整顯示由 confine + 尺寸上限保證
            delete option.tooltip.position;
            // hover 只顯示一行摘要；完整內容（原本的 desc）改成點擊後顯示在右側面板
            option.tooltip.formatter = function (params) {
                var d = params && params.data;
                if (!d) return '';
                return d.short ? d.short : (d.desc || '');
            };
            chart.setOption(option);
            installDetailPanel(chart);
            // 容器尺寸由 Rust 的 Yew 重繪決定，時機比 setOption 晚；
            // 用 ResizeObserver 監看容器，尺寸一變就 resize（修「節點有時沒變高」）。
            watchSize(chart);
            window.__evoResize = function () {
                try { chart.resize(); } catch (e) { /* 忽略 */ }
            };
            return true;
        },
    };


    // 監看圖表容器尺寸：Rust 改高度、面板開合都會改變容器大小，
    // 沒 resize 的話 canvas 還是舊尺寸（看起來就是「節點高度沒變」）。
    function watchSize(chart) {
        var el = chart.getDom();
        var sync = function () {
            if (chart.isDisposed && chart.isDisposed()) return;
            var w = el.clientWidth;
            var h = el.clientHeight;
            if (w > 0 && h > 0 && (Math.abs(chart.getWidth() - w) > 1 || Math.abs(chart.getHeight() - h) > 1)) {
                try { chart.resize(); } catch (e) { /* 忽略 */ }
            }
        };
        if (!chart.__evoSizeObserved && typeof ResizeObserver !== 'undefined') {
            chart.__evoSizeObserved = new ResizeObserver(sync);
            chart.__evoSizeObserved.observe(el);
        }
        // 保險：前 1 秒內逐幀比對（Yew 重繪可能比 ResizeObserver 回呼更晚一點）
        var tries = 0;
        (function tick() {
            sync();
            if (++tries < 60) requestAnimationFrame(tick);
        })();
    }

    // 點擊節點／連線 → 通知 Rust 顯示右側詳情面板（面板本身由 Yew 渲染，較穩定）
    function installDetailPanel(chart) {
        if (chart.__evoClickInstalled) return;
        chart.__evoClickInstalled = true;
        chart.on('click', function (params) {
            var d = params && params.data;
            if (!d) {
                setDetail(null);
                return;
            }
            var html = buildDetailHtml(chart, params, d);
            setDetail(html);
        });
    }

    function setDetail(html) {
        if (typeof window.__evoSetDetail === 'function') {
            window.__evoSetDetail(html);
        }
    }

    // 詳情內容＝原本的完整字表 + 「相連的線」清單；太長時先折疊，按「展開全部」再看
    function buildDetailHtml(chart, params, d) {
        var main = d.desc || '';
        var data = chart.getOption().series[0].data;
        var links = chart.getOption().series[0].links;
        var isNode = params.dataType === 'node';
        var rows = [];
        if (isNode) {
            links.forEach(function (l) {
                if (l.source !== params.dataIndex && l.target !== params.dataIndex) return;
                var other = l.source === params.dataIndex ? data[l.target] : data[l.source];
                if (!other) return;
                var dir = l.source === params.dataIndex ? '→' : '←';
                rows.push(dir + ' ' + (other.name || '') + '（' + (l.value || 0) + '字）');
            });
        }
        var list = '';
        if (rows.length) {
            list = '<div class="evo-detail-links"><b>相連 ' + rows.length + ' 條：</b><br>' +
                rows.slice(0, 80).join('<br>') +
                (rows.length > 80 ? '<br>…（其餘 ' + (rows.length - 80) + ' 條省略）' : '') +
                '</div>';
        }
        var body = main + list;
        if (body.length > 3000) {
            return '<div class="evo-detail-truncated">' + body.slice(0, 3000) +
                '…</div><button type="button" class="evo-detail-more" ' +
                'onclick="this.previousElementSibling.classList.remove(\'evo-detail-truncated\');' +
                'this.previousElementSibling.innerHTML=this.dataset.full.replace(/&lt;/g,\'&lt;\');' +
                'this.remove();" data-full="' + body.replace(/"/g, '&quot;') + '">展開全部</button>';
        }
        return body;
    }

})(window);
