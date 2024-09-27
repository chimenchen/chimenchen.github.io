// /js/yunpu_chart.js

(function(window) {
    'use strict';

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
            this.originalNodeLabelFontSizes = [];
            this.originalSymbolSizes = [];
            this.originalSeriesBorderWidth = null;
            this.originalBorderWidths = [];

            this.tooltipShown = false;
            
            this.throttleTimer = null;
            this.throttleDelay = 100; // 100ms 的節流延遲
        }

        // 初始化圖表
        async init(option, createNewInstance) {
            this.showLoading();
            try {
                await this.initChartInstance(createNewInstance);
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
                this.chart.showLoading({
                    text: '數據加載中...',
                    color: '#c23531',
                    textColor: '#000',
                    maskColor: 'rgba(255, 255, 255, 0.8)',
                    zlevel: 0
                });
            } else {
                // 創建並顯示一個簡單的加載指示器
                if (!this.loadingElement) {
                    this.loadingElement = document.createElement('div');
                    this.loadingElement.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    background-color: rgba(255, 255, 255, 0.8);
                    z-index: 1000;
                `;
                    this.loadingElement.innerHTML = '<span style="color: #c23531;">數據加載中...</span>';
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

        // 保存節點大小信息
        saveNodeSizes(data) {
            data.forEach(node => {
                this.originalSymbolSizes.push(node.symbolSize || null);
                this.originalNodeLabelFontSizes.push(node.label && node.label.fontSize || null);
                this.originalBorderWidths.push(node.itemStyle && node.itemStyle.borderWidth || null);
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
            this.chart.on('graphRoam', this.throttle(this.handleGraphRoam.bind(this), this.throttleDelay));
            this.chart.on('restore', this.handleRestore.bind(this));
            window.addEventListener('resize', this.throttle(this.handleResize.bind(this), this.throttleDelay));
        }

        // 處理圖表縮放事件
        handleGraphRoam(params) {
            const currentView = this.chart.getOption().series[0].zoom;
            if (currentView != null) {
                this.currentZoom = currentView;
                this.currentZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.currentZoom));
                // console.log("graphRoam", params, "絕對縮放比例", this.currentZoom);

                this.updateChartZoom(this.currentZoom);

                if (this.currentZoom === this.minZoom || this.currentZoom === this.maxZoom) {
                    console.log("已達到縮放極限");
                    // 可以添加視覺反饋
                }
            }
        }

        handleRestore() {
            // 重置 zoom 值為初始值
            this.currentZoom = this.initialZoom;
            
            console.log("Restored. Current zoom:", this.currentZoom);
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

        // 更新圖表縮放
        updateChartZoom(absoluteZoom) {
            const option = this.chart.getOption();
            this.applyZoomToOption(option, absoluteZoom);
            // console.log("after applyZoomToOption", JSON.stringify(option, null, 2));
            this.chart.setOption(option);
        }

        // 更新節點大小
        updateNodeSizes(data, zoom) {
            const MIN_SCALE = 0.3;
            const MIN_NODE_SIZE = 3;
            const MIN_BORDER_WIDTH = 0.2;
            zoom = Math.max(MIN_SCALE, zoom);
            const nodeSizeFactor = zoom === 1 ? 1 : Math.pow(zoom, 0.7);

            return data.map((node, index) => {
                const newNode = { ...node };
                if (this.originalSymbolSizes[index] !== null) {
                    newNode.symbolSize = Math.max(MIN_NODE_SIZE, this.originalSymbolSizes[index] * nodeSizeFactor);
                }
                if (this.originalNodeLabelFontSizes[index] !== null) {
                    newNode.label = {
                        ...node.label,
                        fontSize: this.updateFontSize(this.originalNodeLabelFontSizes[index], zoom),
                    };
                }
                if (this.originalBorderWidths[index] !== null) {
                    newNode.itemStyle = {
                        ...node.itemStyle,
                        borderWidth: this.updateBorderWidth(this.originalBorderWidths[index], zoom),
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
        updateBorderWidth(originalWidth, zoom) {
            const MIN_BORDER_WIDTH = 0.2;
            const MAX_BORDER_WIDTH = 3;
            const borderWidthFactor = zoom === 1 ? 1 : Math.pow(zoom, 0.7);
            const result = Math.max(MIN_BORDER_WIDTH,
                Math.min(originalWidth * borderWidthFactor, MAX_BORDER_WIDTH));
            return result;
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
            console.log("handleClick", params);
        
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
    
    }

    // 創建或更新圖表的主函數
    async function createOrUpdateChart(chartDom, data, createNewInstance) {
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
    window.yunpuChart = {
        createOrUpdateChart: createOrUpdateChart,
    };

})(window);