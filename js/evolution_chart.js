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
            // 保留 ECharts 的拖拽（實測最可靠），鬆手後由我們的 handler 依 y 重排並歸位到原欄
            if (option.series && option.series[0]) option.series[0].draggable = true;
            option.tooltip = option.tooltip || {};
            option.tooltip.position = makeTooltipPosition(chart);
            chart.setOption(option);
            installDrag(chart);
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
            var w = size.contentSize[0];
            var h = size.contentSize[1];
            var gap = 12;
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;

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

    // 只允許上下拖動：在 document 上以 capture 攔截滑鼠事件（tooltip、標籤文字都會被涵蓋），
    // 命中節點後只跟踪 y，鬆手時依游標 y 重排該欄。拖動期間隱藏 tooltip。
    function installDrag(chart) {
        if (chart.__evoDragInstalled) return;
        chart.__evoDragInstalled = true;
        var drag = null;

        function canvasRect() {
            return chart.getDom().getBoundingClientRect();
        }

        // 命中測試：節點方框 + 右側標籤區（+70px），允許 ±4px 誤差
        function hitTest(clientX, clientY) {
            var box = canvasRect();
            var off = seriesOffset(chart);
            var px = clientX - box.left - off.x;
            var py = clientY - box.top - off.y;
            if (px < 0 || py < 0 || px > box.width || py > box.height) return null;
            var data = chart.getModel().getSeriesByIndex(0).getData();
            var best = null;
            for (var i = 0; i < data.count(); i++) {
                var L = data.getItemLayout(i);
                if (!L) continue;
                var w = L.dx || 20;
                var h = L.dy || 20;
                if (px >= L.x - 4 && px <= L.x + w + 70 && py >= L.y - 4 && py <= L.y + h + 4) {
                    // 取最靠近游標中心的那一個（避免大節點搶走）
                    var d = Math.abs(py - (L.y + h / 2));
                    if (!best || d < best.d) best = { index: i, x: L.x, d: d };
                }
            }
            return best;
        }

        document.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            var hit = hitTest(e.clientX, e.clientY);
            if (!hit) return;
            drag = { index: hit.index, x: hit.x, moved: false, startY: e.clientY };
            document.body.classList.add('evo-dragging');
            try { chart.dispatchAction({ type: 'hideTip' }); } catch (err) { /* 忽略 */ }
        }, true);

        document.addEventListener('mousemove', function (e) {
            if (!drag) return;
            if (Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
            try { chart.dispatchAction({ type: 'hideTip' }); } catch (err) { /* 忽略 */ }
        }, true);

        document.addEventListener('mouseup', function (e) {
            if (!drag) return;
            var d = drag;
            drag = null;
            document.body.classList.remove('evo-dragging');
            if (!d.moved) return;
            var box = canvasRect();
            var off = seriesOffset(chart);
            try {
                reorderByY(chart, d.index, d.x, e.clientY - box.top - off.y);
            } catch (err) {
                /* 忽略：拖動失敗不影響原圖 */
            }
        }, true);
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
