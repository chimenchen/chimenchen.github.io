// /js/yunpu_chart.js

(function(window) {
    'use strict';

    // echarts 約 1MB，首屏不阻塞加載：第一次繪圖時才動態插入 <script>。
    let echartsLoadingPromise = null;

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
            this.applyZoomToOption(option, this.currentZoom);
            this.optionEpoch += 1;
            this.chart.setOption(option, createNewInstance);
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
            }
        }

        // 保存節點大小信息（以節點名為鍵，每次都重新建立）
        saveNodeSizes(data) {
            this.originalSymbolSizes = new Map();
            this.originalNodeLabelFontSizes = new Map();
            this.originalBorderWidths = new Map();
            (data || []).forEach(node => {
                const key = node.name;
                if (key === undefined || key === null) {
                    return;
                }
                this.originalSymbolSizes.set(key, node.symbolSize || null);
                this.originalNodeLabelFontSizes.set(key, (node.label && node.label.fontSize) || null);
                this.originalBorderWidths.set(key, (node.itemStyle && node.itemStyle.borderWidth) || null);
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
        setupEventListeners() {
            this.chart.on('click', this.handleClick.bind(this));
            this.chart.on('dblclick', this.handleDoubleClick.bind(this));
            this.chart.on('graphRoam', this.throttledHandleGraphRoam.bind(this));
            this.chart.on('restore', this.handleRestore.bind(this));
            window.addEventListener('resize', this.throttle(this.handleResize.bind(this), this.throttleDelay));
        }

        // 縮放事件：用 requestAnimationFrame 合併（比 setTimeout 更貼近繪製節奏），
        // 並記錄事件給的 zoom（避免 getOption() 讀到落後的狀態）
        throttledHandleGraphRoam(params) {
            if (params && typeof params.zoom === 'number') {
                this.pendingZoom = params.zoom;
            }
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
                if (typeof origBorder === 'number') {
                    newNode.itemStyle = {
                        ...node.itemStyle,
                        borderWidth: this.updateBorderWidth(origBorder, zoom),
                    };
                }
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

        // 更新邊框寬度
        //
        // ECharts 的 roam 縮放本身就會把線寬一起放大，所以這裡要「反向」補償，
        // 讓邊框在螢幕上大致維持原本的粗細（base / zoom）。
        // 之前用 base * zoom^0.7，放大時邊框會粗到 3px 以上；而且只有自帶 itemStyle 的
        // 節點會更新、其餘走 series 級設定，兩批節點粗細不一致，縮小後又細到看不見。
        updateBorderWidth(originalWidth, zoom) {
            const MIN_BORDER_WIDTH = 0.12;
            const MAX_BORDER_WIDTH = 3.5;
            const base = (typeof originalWidth === 'number' && isFinite(originalWidth) && originalWidth > 0)
                ? originalWidth : 1;
            const z = Math.max(0.01, Number(zoom) || 1);
            // 螢幕上的粗細 ≈ base × zoom^0.2：縮小（初始）時略細、放大時略粗，
            // 兩端都不會誇張；用 0.8 而不是 1.0，避免「一開始就覺得邊框偏粗」。
            const result = Math.max(MIN_BORDER_WIDTH,
                Math.min(base / Math.pow(z, 0.8), MAX_BORDER_WIDTH));
            return Math.round(result * 1000) / 1000;
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
    };

})(window);