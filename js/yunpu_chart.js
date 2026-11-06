// /js/yunpu_chart.js

(function(window) {
    'use strict';

    // ── 縮放時的邊框參數（集中放這裡，方便微調）────────────────────
    // 邊框寬度以「螢幕像素」為目標，再換算回 canvas 座標（除以 zoom）。
    const BORDER_ZOOM_EXP = 1.0;    // 隨縮放衰減的指數；1.0 = 與 zoom 成正比（0.5 是舊值，衰減太慢）
    const BORDER_MIN_PX = 0.12;     // 螢幕上的最小邊框（<1px 由瀏覽器做覆蓋率抗鋸齒 → 看起來更淡）
    const BORDER_MAX_RATIO = 0.22;  // 邊框不得超過節點直徑的這個比例
    const BORDER_MAX_PX = 1.4;      // 放大時的上限
    const BORDER_ALPHA_EXP = 0.6;   // 縮小時邊框變淡的速度
    const BORDER_ALPHA_MIN = 0.30;  // 最淡不會低於這個不透明度

    // echarts 約 1MB，首屏不阻塞加載：第一次繪圖時才動態插入 <script>。
    let echartsLoadingPromise = null;
    let lastChartInstance = null;

    function ensureEchartsLoaded() {
        if (window.echarts) {
            return Promise.resolve(window.echarts);
        }
        if (!echartsLoadingPromise) {
            echartsLoadingPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/echarts.min.js';
                script.async = true;
                script.onload = () => resolve(window.echarts);
                script.onerror = () => {
                    echartsLoadingPromise = null; // 允許重試
                    reject(new Error('echarts 加載失敗'));
                };
                document.head.appendChild(script);
            });
        }
        return echartsLoadingPromise;
    }

    class YunpuChart {
        constructor(chartDom) {
            this.chartDom = chartDom;
            this.chart = null;

            this.loadingElement = null;
            this.isLoading = false;

            this.currentZoom = 1;
            this.initialZoom = 1;
            this.minZoom = 0.3;
            this.maxZoom = 3;
            this.originalSeriesLabelFontSize = 12;
            // 節點原始值一律以「節點名」為鍵（不用陣列索引：換資料或非同步更新時索引會錯位）
            this.originalNodeLabelFontSizes = new Map();
            this.originalSymbolSizes = new Map();
            this.originalSeriesBorderWidth = null;
            this.originalBorderWidths = new Map();
            // 邊框原始顏色：縮放時會把顏色轉成帶 alpha 的 rgba；若每次都從
            // getOption() 讀（那已經是上次改過的值），alpha 會累乘到 0，
            // 而且放大也救不回來。所以一律從這份原始值算。
            this.originalBorderColors = new Map();
            // 每套用一次完整 option 就 +1；縮放的 rAF 回呼靠它判斷是不是過期工作
            this.optionEpoch = 0;

            this.tooltipShown = false;
            
            this.graphRoamTimer = null;
            this.throttleTimer = null;
            this.throttleDelay = 100; // 100ms 的節流延遲
        }

        // 初始化圖表
        async init(option, createNewInstance) {
            this.showLoading();
            try {
                await this.initChartInstance(createNewInstance);
                // 容器可能先前被 display:none 隱藏（例如切到離合矩陣），
                // 那時 ECharts 初始化得到 0 尺寸；這裡在可見狀態下重新量一次。
                if (this.chart && this.chartDom.clientWidth > 0) {
                    this.chart.resize();
                }
                // 如果之前顯示了自定義加載指示器，現在移除它
                this.hideLoading();
                // 使用 ECharts 的加載指示器
                this.showLoading();
                await this.setOptionAsync(option, createNewInstance);
                this.setupEventListeners();
            } finally {
                this.hideLoading();
            }
        }

        showLoading() {
            if (this.isLoading) return; // 如果已經在加載中，不要重複顯示
            this.isLoading = true;
            if (this.chart) {
                const style = getComputedStyle(document.documentElement);
                this.chart.showLoading({
                    text: '數據加載中',
                    textColor: style.getPropertyValue('--color-text-primary').trim(),
                    maskColor: style.getPropertyValue('--color-background-translucent').trim(),
                    zlevel: 0,
                    fontSize: 14,
                    showSpinner: true,
                    spinnerRadius: 10,
                    lineWidth: 3,
                    color: style.getPropertyValue('--color-node-border-highlight').trim(),
                });
            } else {
                // 創建並顯示一個簡單的加載指示器
                if (!this.loadingElement) {
                    this.loadingElement = document.createElement('div');
                    this.loadingElement.className = 'loading-indicator';
                    this.loadingElement.innerHTML = '<div class="spinner"></div><span>數據加載中</span>';
                    this.chartDom.style.position = 'relative';
                }
                if (!this.chartDom.contains(this.loadingElement)) {
                    this.chartDom.appendChild(this.loadingElement);
                }
            }
        }

        hideLoading() {
            if (!this.isLoading) return; // 如果沒有在加載中，不需要隱藏
            this.isLoading = false;
            if (this.chart) {
                this.chart.hideLoading();
            }
            if (this.loadingElement && this.chartDom.contains(this.loadingElement)) {
                this.chartDom.removeChild(this.loadingElement);
            }
        }

        // 初始化或獲取圖表實例
        initChartInstance(createNewInstance) {
            if (createNewInstance) {
                this.disposeOldInstance();
            }
            this.chart = this.createOrGetChartInstance();
        }

        // 清除舊的圖表實例
        disposeOldInstance() {
            const oldChart = echarts.getInstanceByDom(this.chartDom);
            if (oldChart) {
                oldChart.dispose();
            }
            this.chartDom.innerHTML = '';
        }

        // 創建新的圖表實例或獲取現有實例
        createOrGetChartInstance() {
            if (!echarts.getInstanceByDom(this.chartDom)) {
                return echarts.init(this.chartDom);
            }
            return echarts.getInstanceByDom(this.chartDom);
        }

        async setOptionAsync(option, createNewInstance) {
            return new Promise(resolve => {
                setTimeout(() => {
                    this.setOption(option, createNewInstance);
                    resolve();
                }, 0);
            });
        }

        // 設置圖表選項
        setOption(option, createNewInstance) {
            option = this.preprocessOption(option);
            this.saveOriginalSizes(option);
            this.setInitialZoom(option);

            if (option.series && option.series[0] && option.series[0].scaleLimit) {
                this.minZoom = option.series[0].scaleLimit.min;
                this.maxZoom = option.series[0].scaleLimit.max;
            }

            // 在設置選項之前應用縮放
            // 在「被 highlight／blur 的狀態下」換資料，狀態會黏在新元素上
            // （節點一直半透明、邊框消失），所以先清掉焦點
            this.clearFocus();
            this.applyZoomToOption(option, this.currentZoom);
            this.optionEpoch += 1;
            // 一律整份替換（notMerge=true）：
            // 預覽切換（篇 → 作者 → 全部）時節點集合會變少，merge 會把舊節點留著，
            // 看起來就像「關掉膠囊沒有生效」。縮放已由上面的 applyZoomToOption 重新套用。
            this.chart.setOption(option, true);
        }

        // 預處理圖表選項
        preprocessOption(option) {
            option = parseCSSVariables(option);
            if (option.tooltip && option.tooltip.formatter === "tooltipFormatter") {
                option.tooltip.formatter = this.tooltipFormatter;
            }
            this.setupToolboxFeatures(option);
            return option;
        }

        // 保存原始大小信息
        saveOriginalSizes(option) {
            if (option.series && option.series[0]) {
                this.originalSeriesLabelFontSize = option.series[0].label && option.series[0].label.fontSize || 12;
                this.saveNodeSizes(option.series[0].data);
                this.originalSeriesBorderWidth = option.series[0].itemStyle.borderWidth || 1;
                this.originalSeriesBorderColor = option.series[0].itemStyle.borderColor || null;
            }
        }

        // 保存節點大小信息（以節點名為鍵，每次都重新建立）
        saveNodeSizes(data) {
            this.originalSymbolSizes = new Map();
            this.originalNodeLabelFontSizes = new Map();
            this.originalBorderWidths = new Map();
            this.originalBorderColors = new Map();
            (data || []).forEach(node => {
                const key = node.name;
                if (key === undefined || key === null) {
                    return;
                }
                this.originalSymbolSizes.set(key, node.symbolSize || null);
                this.originalNodeLabelFontSizes.set(key, (node.label && node.label.fontSize) || null);
                this.originalBorderWidths.set(key, (node.itemStyle && node.itemStyle.borderWidth) || null);
                this.originalBorderColors.set(key, (node.itemStyle && node.itemStyle.borderColor) || null);
            });
        }

        // 設置初始縮放級別
        setInitialZoom(option) {
            this.initialZoom = calculateInitialZoom(this.chartDom, option.series[0].data.length);
            option.series[0].zoom = this.initialZoom;
            this.currentZoom = this.initialZoom;
            console.log("initialZoom/currentZoom", this.initialZoom, this.currentZoom);
        }

        throttle(func, delay) {
            return (...args) => {
                if (!this.throttleTimer) {
                    this.throttleTimer = setTimeout(() => {
                        func.apply(this, args);
                        this.throttleTimer = null;
                    }, delay);
                }
            };
        }

        // 設置事件監聽器
        //
        // 每次生成都會呼叫這裡，若只 on 不 off，監聽器會一份一份累積
        // （N 次生成＝同一個事件跑 N 次），狀態機就容易被弄亂。
        setupEventListeners() {
            this.chart.off('click');
            this.chart.off('dblclick');
            this.chart.off('graphRoam');
            this.chart.off('restore');
            this.chart.off('globalout');
            this.chart.off('mouseover');
            this.chart.off('mouseout');

            this.chart.on('click', this.handleClick.bind(this));
            this.chart.on('dblclick', this.handleDoubleClick.bind(this));
            this.chart.on('graphRoam', this.throttledHandleGraphRoam.bind(this));
            this.chart.on('restore', this.handleRestore.bind(this));
            // 滑鼠離開圖表就清掉 highlight／blur：焦點狀態卡住時
            // （節點變幾乎透明、類別節點的邊框跟著淡掉）這是唯一的復原點
            this.chart.on('globalout', () => {
                this.focusLikely = false;
                this.clearFocus();
            });
            // hover 目標一改變就「對帳」：先把所有狀態歸零，再只 highlight 目前這一個。
            // 快速繞圈時 echarts 的 highlight／downplay 會 race，留下沒被 downplay 的
            // 元素（節點與連線停在 blur，看起來幾乎透明）；對帳可以保證狀態收斂。
            this.chart.on('mouseover', params => {
                if (!params || params.componentType !== 'series') {
                    return;
                }
                this.hoveredDataIndex = params.dataIndex;
                this.focusLikely = true;
                this.scheduleHoverReconcile();
            });
            this.chart.on('mouseout', params => {
                if (!params || params.componentType !== 'series') {
                    return;
                }
                if (this.hoveredDataIndex !== params.dataIndex) {
                    return; // 已經移到別的節點，交給那次 mouseover 處理
                }
                this.hoveredDataIndex = null;
                this.scheduleHoverReconcile();
            });
            this.bindEmptyAreaFocusReset();
            window.addEventListener('resize', this.throttle(this.handleResize.bind(this), this.throttleDelay));
        }

        // hover 狀態對帳（見 setupEventListeners 的說明）
        scheduleHoverReconcile() {
            if (this.hoverReconcileScheduled) {
                return;
            }
            this.hoverReconcileScheduled = true;
            const run = () => {
                this.hoverReconcileScheduled = false;
                if (!this.chart || this.applyingZoom) {
                    return;
                }
                const idx = this.hoveredDataIndex;
                // 先全部歸零（清掉任何殘留的 blur），再只 highlight 目前這一個
                this.clearFocus();
                if (idx === null || idx === undefined) {
                    return;
                }
                this.focusLikely = true;
                try {
                    this.chart.dispatchAction({
                        type: 'highlight',
                        seriesIndex: 0,
                        dataIndex: idx,
                    });
                } catch (e) {
                    // 節點剛好被換掉（重繪中）就交給下一次事件
                }
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(run);
            } else {
                setTimeout(run, 16);
            }
        }

        // 游標在「空白處」時不該有任何 blur。
        //
        // 快速在節點之間繞圈時，echarts 的 highlight／downplay 會 race，
        // 有些元素會停在 blur（節點與連線變幾乎透明）；此時游標沒離開圖表，
        // globalout 不會觸發，所以要在 zr 層自己檢查 hover 目標。
        bindEmptyAreaFocusReset() {
            if (!this.chart || this._zrBoundFor === this.chart) {
                return;
            }
            this._zrBoundFor = this.chart;
            const zr = this.chart.getZr();
            if (!zr) {
                return;
            }
            zr.on('mousemove', e => {
                if (!this.focusLikely || this.emptyCheckScheduled) {
                    return;
                }
                this.emptyCheckScheduled = true;
                const run = () => {
                    this.emptyCheckScheduled = false;
                    const hover = zr.handler && zr.handler.findHover
                        ? zr.handler.findHover(e.offsetX, e.offsetY)
                        : null;
                    if (hover && hover.target) {
                        return; // 還壓在元素上：保留合法的 adjacency blur
                    }
                    this.focusLikely = false;
                    this.clearFocus();
                };
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(run);
                } else {
                    setTimeout(run, 16);
                }
            });
        }

        // 清掉 emphasis.focus = adjacency 造成的 highlight／blur 狀態
        clearFocus() {
            this.focusLikely = false;
            if (!this.chart) {
                return;
            }
            try {
                this.chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
                this.chart.dispatchAction({ type: 'unfocusNodeAdjacency', seriesIndex: 0 });
            } catch (e) {
                // 舊版 echarts 沒有 unfocusNodeAdjacency，忽略即可
            }
            // dispatchAction 走的是 echarts 自己的狀態帳本；快速 hover 時它會漏掉
            // 某些元素（節點與連線停在 blur）。這裡直接對每個圖形元素做硬重置。
            this.hardResetStates();
        }

        // 直接把所有圖形元素的狀態清回 normal
        hardResetStates() {
            const zr = this.chart && this.chart.getZr && this.chart.getZr();
            if (!zr || !zr.storage || typeof zr.storage.getDisplayList !== 'function') {
                return;
            }
            let reset = 0;
            const list = zr.storage.getDisplayList(true) || [];
            for (let i = 0; i < list.length; i++) {
                const el = list[i];
                if (!el) {
                    continue;
                }
                try {
                    if (typeof el.clearStates === 'function' && el.hasState && el.hasState()) {
                        el.clearStates(false);
                        reset += 1;
                    }
                } catch (e) {
                    // 忽略單一元素的失敗
                }
            }
            if (reset > 0 && typeof zr.refresh === 'function') {
                zr.refresh();
            }
        }

        // 除錯用：在 console 執行 window.yunpuChartDebug() 看還有多少元素停在非 normal 狀態
        debugStates() {
            const zr = this.chart && this.chart.getZr && this.chart.getZr();
            if (!zr || !zr.storage) {
                return 'no chart';
            }
            const list = zr.storage.getDisplayList(true) || [];
            const stuck = [];
            list.forEach(el => {
                if (!el || !el.currentStates || !el.currentStates.length) {
                    return;
                }
                const ecData = el.__ecData || {};
                stuck.push({
                    states: el.currentStates.slice(),
                    type: el.type,
                    name: (ecData.dataIndex !== undefined ? `#${ecData.dataIndex}` : '') +
                        (el.style && el.style.opacity !== undefined ? ` opacity=${el.style.opacity}` : ''),
                });
            });
            return { total: list.length, stuckCount: stuck.length, stuck: stuck.slice(0, 20) };
        }

        // 縮放事件：用 requestAnimationFrame 合併（比 setTimeout 更貼近繪製節奏），
        // 並記錄事件給的 zoom（避免 getOption() 讀到落後的狀態）
        throttledHandleGraphRoam(params) {
            // 純平移（只有 dx/dy、沒有 zoom）不會改變縮放 → 不必重算節點尺寸。
            // 依 echarts 實作：pan 也會發 graphRoam，而且 action 會把
            // series.zoom 用 fC() 夾取後重寫、卻不重算內部的 symbolScale；
            // 那時若照讀到的 zoom 重算 symbolSize，兩者相乘就會讓節點偶爾變大，
            // 等下一個縮放事件才恢復。
            if (!params || typeof params.zoom !== 'number') {
                return;
            }
            this.pendingZoom = params.zoom;
            if (this.graphRoamScheduled) {
                return;
            }
            this.graphRoamScheduled = true;
            const epoch = this.optionEpoch;
            const run = () => {
                this.graphRoamScheduled = false;
                if (this.applyingZoom) {
                    return; // 這次是我們自己 setOption 觸發的，不要再處理，避免回授
                }
                if (epoch !== this.optionEpoch) {
                    return; // 期間已換過整份 option，這個回呼是過期工作，丟掉
                }
                this.handleGraphRoam();
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(run);
            } else {
                setTimeout(run, 16);
            }
        }

        // 處理圖表縮放事件
        //
        // 注意：graphRoam 事件參數裡的 zoom 是「相對倍率」，不是絕對縮放值，
        // 所以一律讀 getOption().series[0].zoom（在 rAF 之後讀，值已經更新）。
        handleGraphRoam() {
            this.pendingZoom = null;
            let currentView = null;
            const opt = this.chart.getOption();
            currentView = opt && opt.series && opt.series[0] ? opt.series[0].zoom : null;
            if (typeof currentView !== 'number') {
                return;
            }
            const next = Math.max(this.minZoom, Math.min(this.maxZoom, currentView));
            // 變化太小就不重繪（避免連續縮放時每幀 setOption）
            if (Math.abs(next - this.currentZoom) / Math.max(0.001, this.currentZoom) < 0.03) {
                return;
            }
            this.currentZoom = next;
            this.updateChartZoom(next);
        }

        handleRestore() {
            // 重置 zoom 值為初始值，並把節點大小/字級一併還原
            this.currentZoom = this.initialZoom;
            this.updateChartZoom(this.initialZoom);
        }

        // 處理窗口大小變化事件
        handleResize() {
            this.chart.resize();
        }

        // 將縮放應用到選項
        applyZoomToOption(option, zoom) {
            if (option.series && option.series[0]) {
                const series = option.series[0];
                series.data = this.updateNodeSizes(series.data, zoom);
                if (series.label) {
                    series.label.fontSize = this.updateFontSize(this.originalSeriesLabelFontSize, zoom);
                }
                if (series.itemStyle && this.originalBorderWidths) {
                    series.itemStyle.borderWidth = this.updateBorderWidth(
                        this.originalSeriesBorderWidth, zoom);
                }
            }
        }

        // 更新圖表縮放：只改節點大小/字級（用 merge 方式補丁，不要整份 option 重設，
        // 否則會把 roam 的 zoom/center 一併蓋掉 —— 這就是先前「跑飛」的主因）
        updateChartZoom(absoluteZoom) {
            const data = this.updateNodeSizes(this.chart.getOption().series[0].data, absoluteZoom);
            this.clearFocus();
            this.applyingZoom = true;
            try {
                this.chart.setOption(
                    {
                        series: [
                            {
                                data: data,
                                label: {
                                    fontSize: this.updateFontSize(
                                        this.originalSeriesLabelFontSize,
                                        absoluteZoom
                                    ),
                                },
                                itemStyle: {
                                    borderWidth: this.updateBorderWidth(
                                        this.originalSeriesBorderWidth || 1,
                                        absoluteZoom
                                    ),
                                    borderColor: this.withAlpha(
                                        this.originalSeriesBorderColor,
                                        this.nodeBorderAlpha(absoluteZoom)
                                    ),
                                },
                            },
                        ],
                    },
                    { lazyUpdate: true }
                );
            } finally {
                this.applyingZoom = false;
            }
        }

        // 更新節點大小
        updateNodeSizes(data, zoom) {
            const MIN_SCALE = 0.3;
            const MIN_NODE_SIZE = 3;
            const MIN_BORDER_WIDTH = 0.2;
            zoom = Math.max(MIN_SCALE, zoom);
            const nodeSizeFactor = zoom === 1 ? 1 : Math.pow(zoom, 0.7);
            const alpha = this.nodeBorderAlpha(zoom);

            return (data || []).map(node => {
                const newNode = { ...node };
                const key = node.name;
                const origSize = this.originalSymbolSizes.get(key);
                const origFont = this.originalNodeLabelFontSizes.get(key);
                const origBorder = this.originalBorderWidths.get(key);
                if (typeof origSize === 'number') {
                    newNode.symbolSize = Math.max(MIN_NODE_SIZE, origSize * nodeSizeFactor);
                }
                if (typeof origFont === 'number') {
                    newNode.label = {
                        ...node.label,
                        fontSize: this.updateFontSize(origFont, zoom),
                    };
                }
                // 每個節點都給明確的邊框寬度（否則會走 series 級設定，大小不一的節點無法各自調整）
                const ratio = (typeof origBorder === 'number' && origBorder > 0)
                    ? origBorder
                    : (this.originalSeriesBorderWidth || 1);
                // 原始顏色優先（避免 alpha 累乘）；沒有原始值才用節點自帶的
                const baseBorderColor = this.originalBorderColors.has(key)
                    ? this.originalBorderColors.get(key)
                    : (node.itemStyle && node.itemStyle.borderColor);
                newNode.itemStyle = {
                    ...node.itemStyle,
                    borderWidth: this.nodeBorderWidth(newNode.symbolSize || origSize || 30, zoom, ratio),
                    borderColor: baseBorderColor
                        ? this.withAlpha(baseBorderColor, alpha)
                        : baseBorderColor,
                };
                return newNode;
            });
        }

        // 更新系列標籤大小
        updateSeriesLabelSize(series, zoom) {
            const newSeries = { ...series };
            if (series.label && this.originalSeriesLabelFontSize) {
                newSeries.label = {
                    ...series.label,
                    fontSize: this.updateFontSize(this.originalSeriesLabelFontSize, zoom)
                };
            }
            return newSeries;
        }

        // 更新字體大小
        updateFontSize(fontSize, zoom) {
            const MIN_FONT_SCALE = 0.3;
            const MAX_FONT_SCALE = 2.0;
            const MIN_FONT_SIZE = 5;
            const fontScaleFactor = zoom === 1 ? 1 : Math.pow(zoom, 0.7);
            return Math.max(MIN_FONT_SIZE,
                MIN_FONT_SCALE * fontSize,
                Math.min(fontSize * fontScaleFactor, MAX_FONT_SCALE * fontSize));
        }

        // 邊框寬度（回傳圖座標值；ECharts 會再乘 zoom）。
        //
        // 兩個要求要同時成立：
        //   1. 同一張圖上「同類元素同線寬」→ 邊框不可跟著節點大小跑，
        //      否則大小節點粗細不同，看起來雜亂。
        //   2. 邊框要隨縮放溫和變化 → 不能完全固定成 1px（放大後會細得突兀）。
        // 做法：以 zoom^0.5 決定螢幕粗細（夾 0.30–1.40px），
        //      再用「不超過節點直徑 35%」保住填充色（只有極小的節點會因此更細）。
        nodeBorderWidth(scaledSymbolSize, zoom, ratio) {
            const z = Math.max(0.01, Number(zoom) || 1);
            const base = (typeof ratio === 'number' && isFinite(ratio) && ratio > 0) ? ratio : 1;
            const size = (typeof scaledSymbolSize === 'number' && isFinite(scaledSymbolSize))
                ? scaledSymbolSize : 30;
            const screenDiameter = Math.max(0.5, size * z);
            const byZoom = Math.min(BORDER_MAX_PX, Math.max(BORDER_MIN_PX, Math.pow(z, BORDER_ZOOM_EXP))) * base;
            const capByFill = Math.max(BORDER_MIN_PX * base, screenDiameter * BORDER_MAX_RATIO * base);
            return Math.round((Math.min(byZoom, capByFill) / z) * 1000) / 1000;
        }

        // 邊框的不透明度：縮小時一起變淡，免得細線在深色節點上形成硬邊
        nodeBorderAlpha(zoom) {
            const z = Math.max(0.01, Number(zoom) || 1);
            return Math.min(1, Math.max(BORDER_ALPHA_MIN, Math.pow(z, BORDER_ALPHA_EXP)));
        }

        // 把顏色轉成帶指定透明度的 rgba（認得 #rgb/#rrggbb/#rrggbbaa 與 rgb()/rgba()）
        withAlpha(color, alpha) {
            if (typeof color !== 'string' || !color) {
                return color;
            }
            const a = Math.min(1, Math.max(0, alpha));
            const c = color.trim();
            let m = /^#([0-9a-f]{3,8})$/i.exec(c);
            if (m) {
                let h = m[1];
                if (h.length === 3) {
                    h = h.split('').map(ch => ch + ch).join('');
                }
                if (h.length !== 6 && h.length !== 8) {
                    return c;
                }
                const r = parseInt(h.slice(0, 2), 16);
                const g = parseInt(h.slice(2, 4), 16);
                const b = parseInt(h.slice(4, 6), 16);
                const a0 = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
                return `rgba(${r},${g},${b},${(a * a0).toFixed(3)})`;
            }
            m = /^rgba?\(([^)]+)\)$/i.exec(c);
            if (m) {
                const p = m[1].split(',').map(x => parseFloat(x));
                if (p.length < 3 || p.some(x => !isFinite(x))) {
                    return c;
                }
                const a0 = p.length === 4 ? p[3] : 1;
                return `rgba(${p[0]},${p[1]},${p[2]},${(a * a0).toFixed(3)})`;
            }
            return c;
        }

        // series 級（沒有自帶 itemStyle 的節點）用的預設值：以預設 symbolSize 30 估算
        updateBorderWidth(originalWidth, zoom) {
            const z = Math.max(0.01, Number(zoom) || 1);
            const ratio = (typeof originalWidth === 'number' && originalWidth > 0) ? originalWidth : 1;
            return this.nodeBorderWidth(30 * Math.pow(z, 0.7), z, ratio);
        }

        // 設置工具箱功能
        setupToolboxFeatures(option) {
            const zoomStep = 1.1;
            option.toolbox.feature.myZoomIn.onclick = () => this.zoom(zoomStep);
            option.toolbox.feature.myZoomOut.onclick = () => this.zoom(1 / zoomStep);
            option.toolbox.feature.myRepulsionIncrease.onclick = () => this.adjustForce('repulsion', 10);
            option.toolbox.feature.myRepulsionDecrease.onclick = () => this.adjustForce('repulsion', -10);
            option.toolbox.feature.myGravityIncrease.onclick = () => this.adjustForce('gravity', 0.01);
            option.toolbox.feature.myGravityDecrease.onclick = () => this.adjustForce('gravity', -0.01);
        }

        // 縮放圖表
        zoom(factor) {
            const center = [this.chartDom.clientWidth / 2, this.chartDom.clientHeight / 2];
            this.chart.dispatchAction({
                type: 'graphRoam',
                zoom: factor,
                originX: center[0],
                originY: center[1]
            });
        }

        // 調整力導向圖的力
        adjustForce(forceType, delta) {
            const option = this.chart.getOption();
            const force = option.series[0].force;

            const MIN_GRAVITY = 0;
            const MAX_GRAVITY = 1;
            const MIN_REPULSION = 0;
            const MAX_REPULSION = 500;

            if (forceType === 'gravity') { // 重力
                force[forceType] = Math.max(MIN_GRAVITY, Math.min(MAX_GRAVITY, force[forceType] + delta));
            } else if (forceType === 'repulsion') { // 排斥力
                force[forceType] = Math.max(MIN_REPULSION, Math.min(MAX_REPULSION, force[forceType] + delta));
            }
            console.log(forceType, force[forceType]);
            this.chart.setOption(option);
        }

        // 工具提示格式化函數
        tooltipFormatter(params) {
            return '<div class="echarts-tooltip-content">' + 
                (params.data.desc || params.name) +
                '</div>';
        }

        handleClick(params) {
            // console.log("handleClick", params);
        
            if (params.componentType === 'series') {
                if (this.tooltipShown) {
                    this.chart.dispatchAction({ type: 'hideTip' });
                    this.tooltipShown = false;
                } else {
                    this.chart.dispatchAction({
                        type: 'showTip',
                        seriesIndex: 0,
                        dataIndex: params.dataIndex
                    });
                    this.tooltipShown = true;
                }
            }
        }

        handleDoubleClick(params) {
            // console.log("handleDoubleClick", params);
            
            let textToCopy = null;
            
            if (params.componentType === 'series') {
                const data = params.data;
                if (data) {
                    // 节点：优先使用 desc（tooltip内容），其次使用 name
                    textToCopy = data.desc || data.name;
                }
            } else if (params.componentType === 'edge') {
                // 處理連線
                textToCopy = params.name || params.data?.name;
            }
            
            if (textToCopy) {
                // 將 <br> 替換為普通換行符
                textToCopy = textToCopy.replace(/<br\s*\/?>/gi, '\n');
                this.copyToClipboard(textToCopy);
            }
        }

        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                this.showCopyFeedback('已複製到剪貼板');
            }).catch(err => {
                console.error('複製失敗：', err);
                // 降級方案：使用傳統的execCommand
                this.fallbackCopyToClipboard(text);
            });
        }

        fallbackCopyToClipboard(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.showCopyFeedback('已複製到剪貼板');
            } catch (err) {
                console.error('降級複製失敗：', err);
                this.showCopyFeedback('複製失敗');
            }
            document.body.removeChild(textarea);
        }

        showCopyFeedback(message) {
            const feedback = document.createElement('div');
            feedback.className = 'copy-feedback';
            feedback.textContent = message;
            feedback.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 10000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(feedback);
            // 觸發重排以使動畫生效
            feedback.offsetHeight;
            feedback.style.opacity = '1';
            setTimeout(() => {
                feedback.style.opacity = '0';
                setTimeout(() => {
                    document.body.removeChild(feedback);
                }, 300);
            }, 1500);
        }
    
    }

    // 創建或更新圖表的主函數
    async function createOrUpdateChart(chartDom, data, createNewInstance) {
        // 等 echarts 就緒（首次調用會下載，約 1MB / gzip 0.34MB）
        await ensureEchartsLoaded();
        data = preprocessData(data);
        if (!data.option) {
            console.error('無效的數據結構：缺少 option');
            return;
        }
        applyChartStyles(data.css);
        // logChartColors(chartDom);
        const chart = new YunpuChart(chartDom);
        await chart.init(data.option, createNewInstance);
        lastChartInstance = chart; // 除錯用（yunpuChart.debugStates）
        return chart;
    }

    // 預處理輸入數據
    function preprocessData(data) {
        if (typeof data === 'string') {
            try {
                return JSON.parse(data);
            } catch (e) {
                console.error('解析數據失敗：', e);
                return {};
            }
        }
        return data;
    }

    // 計算初始縮放級別
    function calculateInitialZoom(chartDom, nodeCount) {
        const width = chartDom.clientWidth;
        const height = chartDom.clientHeight - 60;
        const area = Math.pow(Math.min(width, height), 2);
        const baseArea = 1000000;
        const baseNodeCount = 100;
        const minZoom = 0.3;
        const maxZoom = 2;
        const areaFactor = Math.sqrt(area / baseArea);
        const nodeFactor = Math.sqrt(baseNodeCount / nodeCount);
        const zoom = areaFactor * nodeFactor * 1.3;
        return Math.max(minZoom, Math.min(maxZoom, zoom));
    }

    // 解析 CSS 變量
    function parseCSSVariables(option) {
        function parseValue(value) {
            if (typeof value === 'string' && value.startsWith('var(')) {
                return getComputedStyle(document.documentElement).getPropertyValue(value.slice(4, -1)).trim();
            }
            return value;
        }
        function parseObject(obj) {
            for (let key in obj) {
                if (typeof obj[key] === 'object') {
                    parseObject(obj[key]);
                } else {
                    obj[key] = parseValue(obj[key]);
                }
            }
        }
        parseObject(option);
        return option;
    }

    // 應用圖表樣式
    function applyChartStyles(cssContent) {
        const styleElement = document.createElement('style');
        styleElement.textContent = cssContent;
        document.head.appendChild(styleElement);
    }

    // 記錄圖表顏色
    function logChartColors(chartDom) {
        console.log("背景顏色：", getComputedStyle(chartDom).getPropertyValue('--color-background'));
        console.log("文字顏色：", getComputedStyle(chartDom).getPropertyValue('--color-text-primary'));
    }

    // 公開 API
    // 對外：容器由隱藏變可見後，讓 ECharts 重新量尺寸
    function resizeChart(chartDom) {
        if (!chartDom) return false;
        const inst = window.echarts && window.echarts.getInstanceByDom
            ? window.echarts.getInstanceByDom(chartDom)
            : null;
        if (inst && chartDom.clientWidth > 0) {
            inst.resize();
            return true;
        }
        return false;
    }

    // 韻單位關係圖（力導向）：獨立於主圖，直接操作 ECharts，避免套用主圖的縮放/事件邏輯
    async function createRelationChart(chartDom, optionJson) {
        await ensureEchartsLoaded();
        // 容器剛從 display:none 變可見時，這一帧可能還是 0 尺寸；等它排出寬高再初始化
        for (let i = 0; i < 40; i++) {
            if (chartDom.clientWidth > 0 && chartDom.clientHeight > 0) break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const option = typeof optionJson === 'string' ? JSON.parse(optionJson) : optionJson;
        // 關係圖自訂 tooltip：數字只保留一位小數，避免一串浮點
        if (option.relationTooltip) {
            const round = (v) => (typeof v === 'number' ? String(Math.round(v * 10) / 10) : v);
            option.tooltip.formatter = function (params) {
                const d = params.data || {};
                const small = d.enough === false ? '<b>樣本不足</b><br/>' : '';
                if (params.dataType === 'edge' || d.kind === 'link') {
                    return (
                        small +
                        params.data.source + ' ↔ ' + params.data.target +
                        '<br/>離合指數：' + round(d.index_value) +
                        '<br/>合押：' + round(d.heya) +
                        '；自押 ' + round(d.aa) + ' / ' + round(d.bb) +
                        '<br/>字次：' + round(d.zici_a) + ' / ' + round(d.zici_b) +
                        '<br/>卡方：' + round(d.chi) + '；z：' + round(d.z) +
                        '<br/>判別：' + d.verdict
                    );
                }
                return (
                    small + params.name +
                    '<br/>字次：' + round(d.zici) +
                    '<br/>自押：' + round(d.self_count) + ' 次'
                );
            };
            delete option.relationTooltip;
        }
        // layout:'none' 的節點用歸一化座標（nx/ny）傳來，這裡依容器實際尺寸換算成像素
        try {
            const series = (option.series || [])[0];
            if (series && series.layout === 'none' && Array.isArray(series.data)) {
                const W = Math.max(320, chartDom.clientWidth || 800);
                const H = Math.max(240, chartDom.clientHeight || 500);
                const mx = 30;
                const my = 26;
                series.data.forEach((n) => {
                    if (typeof n.nx === 'number' && typeof n.ny === 'number') {
                        n.x = mx + n.nx * (W - mx * 2);
                        n.y = my + n.ny * (H - my * 2);
                    }
                });
            }
        } catch (e) {
            /* ignore */
        }
        let inst = echarts.getInstanceByDom(chartDom);
        if (!inst) {
            inst = echarts.init(chartDom);
        } else {
            inst.resize();
        }
        // 作者版（option._author 存在）時，在標題區顯示作者名
    if (option && option._author && option.title) {
        option.title.text = (option.title.text || '') + '（' + option._author + '）';
    }
    inst.setOption(option, true);
        // 點連線＝選中該韻對（交給頁面處理，等同點矩陣格子）
        inst.off('click');
        inst.on('click', function (params) {
        // 點節點 → 讓頁面顯示該韻的自押例證（點連線仍走下面的韻對邏輯）
        if (params.dataType === 'node' && params.name) {
            window.dispatchEvent(new CustomEvent('yunpu-relation-unit', { detail: { unit: String(params.name) } }));
            return;
        }
            const d = params && params.data;
            if (params.dataType === 'edge' && d && d.source && d.target) {
                window.dispatchEvent(
                    new CustomEvent('yunpu-relation-pair', {
                        detail: { a: d.source, b: d.target },
                    })
                );
            }
        });
        // 容器可能剛由 display:none 變可見，這一帧量的尺寸仍可能是 0；
        // 稍後再 resize 一次即可正常繪製。
        setTimeout(() => {
            try {
                inst.resize();
            } catch (e) {
                /* ignore */
            }
        }, 200);

        // 容器大小改變（使用者拖拉調整高度、或版面變動）→ 自動重繪
        if (typeof ResizeObserver !== 'undefined') {
            if (chartDom.__relationResizeObserver) {
                chartDom.__relationResizeObserver.disconnect();
            }
            let pending = null;
            const ro = new ResizeObserver(() => {
                if (pending) return;
                pending = setTimeout(() => {
                    pending = null;
                    try {
                        inst.resize();
                    } catch (e) {
                        /* ignore */
                    }
                }, 60);
            });
            ro.observe(chartDom);
            chartDom.__relationResizeObserver = ro;
        }
        return true;
    }

    window.yunpuChart = {
        createOrUpdateChart: createOrUpdateChart,
        resizeChart: resizeChart,
        createRelationChart: createRelationChart,
        // 除錯：console 執行 yunpuChart.debugStates() 可看有沒有元素卡在非 normal 狀態
        debugStates: function() {
            return lastChartInstance ? lastChartInstance.debugStates() : 'no instance';
        },
    };

})(window);