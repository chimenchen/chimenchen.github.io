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
            // 自己實作拖動（只允許上下、鬆手後重排），所以關掉 ECharts 的自由拖拽
            if (option.series && option.series[0]) option.series[0].draggable = false;
            option.tooltip = option.tooltip || {};
            option.tooltip.position = makeTooltipPosition(chart);
            chart.setOption(option);
            installDrag(chart);
            return true;
        },
    };

    // tooltip 位置：固定在游標右下方 18px，靠近邊界時翻到另一側。
    // appendToBody 為 true，所以這裡要回傳「頁面座標」。
    function makeTooltipPosition(chart) {
        return function (pos, params, dom, rect, size) {
            var gap = 18;
            var box = chart.getDom().getBoundingClientRect();
            var scrollX = window.pageXOffset || 0;
            var scrollY = window.pageYOffset || 0;
            var w = size.contentSize[0];
            var h = size.contentSize[1];
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;
            var x = box.left + pos[0] + gap;
            var y = box.top + pos[1] + gap;
            if (x + w > viewW) x = Math.max(0, box.left + pos[0] - gap - w);
            if (y + h > viewH) y = Math.max(0, box.top + pos[1] - gap - h);
            return [x + scrollX, y + scrollY];
        };
    }

    // 只允許上下拖動：按下節點後記錄，鬆手時依游標 y 重排該欄（重排＝改 data 順序）。
    // 拖動期間隱藏 tooltip，避免遮擋。
    function installDrag(chart) {
        if (chart.__evoDragInstalled) return;
        chart.__evoDragInstalled = true;
        var zr = chart.getZr();
        var root = (zr.painter && zr.painter.getViewportRoot) ? zr.painter.getViewportRoot() : chart.getDom();
        var drag = null;

        function hitTest(px, py) {
            var data = chart.getModel().getSeriesByIndex(0).getData();
            for (var i = 0; i < data.count(); i++) {
                var L = data.getItemLayout(i);
                if (!L) continue;
                var w = L.dx || 20;
                var h = L.dy || 20;
                if (px >= L.x && px <= L.x + w && py >= L.y && py <= L.y + h) {
                    return { index: i, layout: L };
                }
            }
            return null;
        }

        root.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            var hit = hitTest(e.offsetX, e.offsetY);
            if (!hit) return;
            drag = { index: hit.index, x: hit.layout.x, moved: false };
            document.body.classList.add('evo-dragging');
            chart.dispatchAction({ type: 'hideTip' });
        });

        root.addEventListener('mousemove', function (e) {
            if (!drag) return;
            drag.moved = true;
            chart.dispatchAction({ type: 'hideTip' });
        });

        root.addEventListener('mouseup', function (e) {
            if (!drag) return;
            var d = drag;
            drag = null;
            document.body.classList.remove('evo-dragging');
            if (!d.moved) return;
            try {
                reorderByY(chart, d.index, d.x, e.offsetY);
            } catch (err) {
                /* 忽略：拖動失敗不影響原圖 */
            }
        });
    }

    // 依游標的 y 找出「插入位置」，把該欄的節點重新排序（連線索引一起重映射）
    // （掛到 window 上方便除錯；不影響功能）
    function reorderByY(chart, fromIndex, colX, cursorY) {
        var option = chart.getOption();
        var series = option.series[0];
        var data = series.data.map(function (d) { return d; });
        var links = series.links.map(function (l) { return l; });
        var model = chart.getModel().getSeriesByIndex(0).getData();

        // 找出同一欄（x 相同）的節點，依 y 排序
        var col = [];
        for (var i = 0; i < data.length; i++) {
            var L = model.getItemLayout(i);
            if (!L) continue;
            if (Math.abs(L.x - colX) < 1.5) col.push({ index: i, y: L.y });
        }
        if (col.length < 2) return;
        col.sort(function (a, b) { return a.y - b.y; });
        var curPos = -1;
        for (var k = 0; k < col.length; k++) if (col[k].index === fromIndex) curPos = k;
        if (curPos < 0) return;

        // 目標位置：數一數有多少節點的中心在游標上方
        var target = 0;
        for (var k = 0; k < col.length; k++) {
            if (col[k].index === fromIndex) continue;
            if (col[k].y < cursorY) target++;
        }
        if (target === curPos) return;

        // 重排這一欄：把被拖動的節點移到 target
        var seq = col.map(function (c) { return c.index; });
        seq.splice(curPos, 1);
        seq.splice(target, 0, fromIndex);

        // 用「欄內位置」重建整個 data 順序（同一欄在 data 中是連續的一段）
        var start = col[0].index;
        var newData = data.slice(0, start).concat(seq.map(function (i) { return data[i]; }))
            .concat(data.slice(start + col.length));

        // 舊索引 → 新索引
        var map = new Array(data.length);
        for (var i = 0; i < newData.length; i++) {
            map[data.indexOf(newData[i])] = i;
        }
        // data 內含相同內容的物件時 indexOf 會抓錯，改用標記
        var tagged = newData.map(function (d) { return d; });
        var oldToNew = {};
        var used = {};
        for (var i = 0; i < data.length; i++) {
            for (var j = 0; j < tagged.length; j++) {
                if (!used[j] && tagged[j] === data[i]) { oldToNew[i] = j; used[j] = true; break; }
            }
        }

        var newLinks = links.map(function (l) {
            return {
                source: oldToNew[l.source] != null ? oldToNew[l.source] : l.source,
                target: oldToNew[l.target] != null ? oldToNew[l.target] : l.target,
                value: l.value,
                tooltip: l.tooltip,
                lineStyle: l.lineStyle,
                edgeLabel: l.edgeLabel,
            };
        });

        // 節點 id 直接改成新位置（sankey 的 source/target 是 data 位置）
        var newDataFixed = newData.map(function (d, i) {
            var copy = {};
            for (var key in d) copy[key] = d[key];
            copy.id = i;
            return copy;
        });

        chart.setOption({ series: [{ data: newDataFixed, links: newLinks }] });
    }
    window.__evoReorder = reorderByY;
})(window);
