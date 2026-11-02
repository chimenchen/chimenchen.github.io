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
            option.tooltip.position = makeTooltipPosition(chart);
            chart.setOption(option);
            return true;
        },
    };

    // tooltip 位置：以「被 hover 的節點方框」為準，在 右／左／下／上 四個方向中選一個
    // 「不覆蓋節點、且顯示得最完整（落在視窗內的面積最大）」的位置。
    // appendToBody 為 true，所以要回傳「頁面座標」。
    function makeTooltipPosition(chart) {
        return function (pos, params, dom, rect, size) {
            var box = chart.getDom().getBoundingClientRect();
            var scrollX = window.pageXOffset || 0;
            var scrollY = window.pageYOffset || 0;
            var gap = 12;
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;
            // CSS 有 max-width: min(90vw, 560px) / max-height: 60vh，實際尺寸會被裁；
            // contentSize 給的是未裁的尺寸，這裡取兩者較小值才是真正畫出來的大小。
            var w = Math.min(size.contentSize[0], Math.min(viewW * 0.9, 380));
            var h = Math.min(size.contentSize[1], viewH * 0.45);

            // 節點方框（系列座標 + 系列平移量）
            var node = null;
            try {
                var idx = params && params.dataIndex;
                if (idx != null && params.dataType === 'node') {
                    var L = chart.getModel().getSeriesByIndex(0).getData().getItemLayout(idx);
                    var off = seriesOffset(chart);
                    if (L) {
                        node = {
                            left: box.left + off.x + L.x,
                            top: box.top + off.y + L.y,
                            right: box.left + off.x + L.x + (L.dx || 20),
                            bottom: box.top + off.y + L.y + (L.dy || 20),
                        };
                    }
                }
            } catch (e) { /* 忽略 */ }

            if (!node) {
                // 沒有節點方框（例如 hover 連線）：沿用游標右下方，靠近邊界就翻轉
                var cx = box.left + pos[0] + gap;
                var cy = box.top + pos[1] + gap;
                if (cx + w > viewW) cx = Math.max(0, box.left + pos[0] - gap - w);
                if (cy + h > viewH) cy = Math.max(0, box.top + pos[1] - gap - h);
                return [cx + scrollX, cy + scrollY];
            }

            var nodeW = node.right - node.left;
            var nodeH = node.bottom - node.top;
            // 四個候選位置（左上角座標）
            var candidates = [
                { x: node.right + gap, y: node.top + nodeH / 2 - h / 2 },              // 右
                { x: node.left - gap - w, y: node.top + nodeH / 2 - h / 2 },            // 左
                { x: node.left + nodeW / 2 - w / 2, y: node.bottom + gap },             // 下
                { x: node.left + nodeW / 2 - w / 2, y: node.top - gap - h },            // 上
            ];

            function overlapArea(a, b) {
                var ox = Math.max(0, Math.min(a.x + w, b.right) - Math.max(a.x, b.left));
                var oy = Math.max(0, Math.min(a.y + h, b.bottom) - Math.max(a.y, b.top));
                return ox * oy;
            }

            var best = null;
            for (var i = 0; i < candidates.length; i++) {
                var c = candidates[i];
                // 夾進視窗（會被裁掉的部分不算顯示面積）
                var left = Math.max(0, Math.min(c.x, viewW - Math.min(w, viewW)));
                var top = Math.max(0, Math.min(c.y, viewH - Math.min(h, viewH)));
                var visible = Math.max(0, Math.min(left + w, viewW) - Math.max(left, 0))
                    * Math.max(0, Math.min(top + h, viewH) - Math.max(top, 0));
                // 覆蓋到節點＝扣分（正常情況下應為 0）
                var penalty = overlapArea({ x: left, y: top }, node) * 1000;
                var score = visible - penalty;
                if (!best || score > best.score) {
                    best = { x: left, y: top, score: score };
                }
            }
            return [best.x + scrollX, best.y + scrollY];
        };
    }

})(window);
