// /js/yunpu_chart.js

(function(window) {
    'use strict';

    // 調整圖例位置
    function adjustLegendPosition(chart) {
        const chartWidth = chart.getWidth();
        const chartHeight = chart.getHeight();
        const topReservedSpace = 60;  // 為頂部元素預留空間

        let legendOption = chart.getOption().legend[0];
        let gridOption = chart.getOption().grid[0];

        legendOption.selector = [
            { type: 'all', title: '全選' },
            { type: 'inverse', title: '反選' }
        ];
        legendOption.selectorPosition = 'end';

        if (chartWidth > chartHeight) {
            // 寬屏：圖例在右側
            legendOption.orient = 'vertical';
            legendOption.right = 10;
            legendOption.top = topReservedSpace;
            gridOption.right = '20%';
            gridOption.top = topReservedSpace;

        } else {
            // 窄屏：圖例在底部
            legendOption.orient = 'horizontal';
            legendOption.left = 'center';
            legendOption.bottom = 10;
            gridOption.bottom = '15%';
            gridOption.top = topReservedSpace;
        }

        chart.setOption({
            legend: legendOption,
            grid: gridOption
        });
    }

    // 增加斥力
    function increaseRepulsion(chart) {
        var option = chart.getOption();
        option.series[0].force.repulsion += 10;
        console.log("repulsion", option.series[0].force.repulsion);
        chart.setOption(option);
    }

    // 減少斥力
    function decreaseRepulsion(chart) {
        var option = chart.getOption();
        option.series[0].force.repulsion -= 10;
        console.log("repulsion", option.series[0].force.repulsion);
        chart.setOption(option);
    }

    // 增加重力
    function increaseGravity(chart) {
        var option = chart.getOption();
        option.series[0].force.gravity += 0.01;
        console.log("gravity", option.series[0].force.gravity);
        chart.setOption(option);
    }

    // 減少重力
    function decreaseGravity(chart) {
        var option = chart.getOption();
        option.series[0].force.gravity = Math.max(0, option.series[0].force.gravity - 0.01);
        console.log("gravity", option.series[0].force.gravity);
        chart.setOption(option);
    }

    // 工具提示格式化
    function tooltipFormatter(params) {
        return '<div class="echarts-tooltip-content">' + 
            (params.data.desc || params.name) +
            '</div>';
    }

    // 原始字體大小和符號大小
    let originalFontSizes = [];
    let originalSymbolSizes = [];

    // 更新圖表縮放
    function updateChartZoom(chart, zoom) {
        console.log("zoom scale ", zoom);
        var option = chart.getOption();
        var newData = option.series[0].data.map(function(node, index) {
            var originalFontSize = originalFontSizes[index];
            var originalSymbolSize = originalSymbolSizes[index];
            
            var fontSizeScale = Math.max(0.3, Math.min(2, zoom));
            var newFontSize = Math.max(originalFontSize * fontSizeScale, 6);
            
            var symbolSizeScale = Math.max(0.3, Math.min(2, zoom));
            var newSymbolSize = Math.max(originalSymbolSize * symbolSizeScale, 5);

            return {
                ...node,
                symbolSize: newSymbolSize,
                label: {
                    ...node.label,
                    fontSize: newFontSize
                }
            };
        });

        chart.setOption({
            series: [{
                data: newData
            }]
        });
    }

    // 初始化圖表
    function initChart(chartDom, option, createNewInstance) {
        addChartStyles();

        if (typeof echarts === 'undefined') {
            console.error('ECharts is not defined. Make sure it is properly loaded.');
            return null;
        }

        if (createNewInstance) {
            // 完全清除舊的實例
            var oldChart = echarts.getInstanceByDom(chartDom);
            if (oldChart) {
                oldChart.dispose();
            }
            // 清空容器內容
            chartDom.innerHTML = '';
        }

        var chart;
        if (createNewInstance || !echarts.getInstanceByDom(chartDom)) {
            console.log('Creating new ECharts instance...');
            chart = echarts.init(chartDom);
        } else {
            console.log('Using existing ECharts instance...');
            chart = echarts.getInstanceByDom(chartDom);
        }
        
        if (option.tooltip && option.tooltip.formatter === "tooltipFormatter") {
            option.tooltip.formatter = tooltipFormatter;
        }

        // 添加點擊事件來固定/取消固定工具提示
        var tooltipShown = false;
        chart.on('click', function(params) {
            if (tooltipShown) {
                chart.dispatchAction({
                    type: 'hideTip'
                });
                tooltipShown = false;
            } else {
                chart.dispatchAction({
                    type: 'showTip',
                    seriesIndex: 0,
                    dataIndex: params.dataIndex
                });
                tooltipShown = true;
            }
        });

        // 自定義縮放功能
        var zoomStep = 1.1;
        option.toolbox.feature.myZoomIn.onclick = function() {
            zoom(chart, zoomStep);
        };
        option.toolbox.feature.myZoomOut.onclick = function() {
            zoom(chart, 1 / zoomStep);
        };
        option.toolbox.feature.myRepulsionIncrease.onclick = function() {  
            increaseRepulsion(chart);
        };
        option.toolbox.feature.myRepulsionDecrease.onclick = function() {
            decreaseRepulsion(chart);
        };
        option.toolbox.feature.myGravityIncrease.onclick = function() {
            increaseGravity(chart);
        };
        option.toolbox.feature.myGravityDecrease.onclick = function() {
            decreaseGravity(chart);
        };

        if (createNewInstance) {
            console.log("createNewInstance");
            // 重置缩放、平移状态和漫游
            if (option.series && option.series[0]) {
                option.series[0].zoom = 1;
                option.series[0].center = ['50%', '50%'];
                option.series[0].roam = true;  // 确保漫游功能开启
            }
            
            chart.setOption(option, true);   // 使用 true 作为第二个参数，强制清除之前的图表设置
        } else {
            chart.setOption(option);
        }

        var currentZoom = 1;

        // 保存原始字體大小和節點大小
        option.series[0].data.forEach(function(node, index) {
            originalFontSizes[index] = node.label.fontSize || 12;
            originalSymbolSizes[index] = node.symbolSize || 10;
        });

        function zoom(chart, scale) {
            var option = chart.getOption();
            var center = [chartDom.clientWidth / 2, chartDom.clientHeight / 2];
            
            chart.dispatchAction({
                type: 'graphRoam',
                zoom: scale,
                originX: center[0],
                originY: center[1]
            });
        }

        if (createNewInstance) {
            setTimeout(function() {
                // 强制重置视图到初始状态
                chart.dispatchAction({
                    type: 'restore'
                });
                // 強制重置縮放和中心位置
                chart.dispatchAction({
                    type: 'graphRoam',
                    zoom: 1,
                    dx: 0,
                    dy: 0
                });
            }, 5);
        }

        chart.on('graphRoam', function(params) {
            if (params.zoom != null) {
                currentZoom *= params.zoom;
                updateChartZoom(chart, currentZoom);
            }
        });

        adjustLegendPosition(chart);

        window.addEventListener('resize', function() {
            chart.resize();
            adjustLegendPosition(chart);
        });

        chart.off('restore');  // 先移除可能存在的舊監聽器
        chart.on('restore', function() {
            setTimeout(function() {
                adjustLegendPosition(chart);
            }, 0);
        });

        return chart;
    }

    function createOrUpdateChart(chartDom, options, createNewInstance) {
        var parsedOptions = typeof options === 'string' ? JSON.parse(options) : options;
        var chart = initChart(chartDom, parsedOptions, createNewInstance);
        return chart;
    }

    function addChartStyles() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            .echarts-tooltip {
                max-width: 90vw !important;
                word-wrap: break-word !important;
                white-space: pre-wrap !important;
                user-select: text !important;
                -webkit-user-select: text !important;
                padding: 2px !important;
                border-radius: 2px !important;
                border-width: 1px !important;
            }
            .echarts-tooltip-content {
                font-size: 10px !important;
                line-height: 1.2 !important;
                padding: 2px !important;
            }
        `;
        document.head.appendChild(styleElement);
    }

    // 公開 API
    window.yunpuChart = {
        initChart: initChart,
        createOrUpdateChart: createOrUpdateChart,
        adjustLegendPosition: adjustLegendPosition,
        tooltipFormatter: tooltipFormatter,
        increaseRepulsion: increaseRepulsion,
        decreaseRepulsion: decreaseRepulsion,
        increaseGravity: increaseGravity,
        decreaseGravity: decreaseGravity,
        addChartStyles: addChartStyles
    };

})(window);