// xilianChart namespace
var xilianChart = xilianChart || {};

// 保存图表实例
xilianChart.chartInstance = null;

// 应用图表样式
xilianChart.applyChartStyles = function(cssContent) {
    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
};

// 解析 CSS 变量
xilianChart.parseCSSVariables = function(option) {
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
};

// 计算初始缩放级别
xilianChart.calculateInitialZoom = function(chartDom, nodeCount) {
    const width = chartDom.clientWidth;
    const height = chartDom.clientHeight - 60;
    const area = Math.pow(Math.min(width, height), 2);
    const baseArea = 1000000;
    const baseNodeCount = 100;
    const minZoom = 0.1;
    const maxZoom = 2;
    const areaFactor = Math.sqrt(area / baseArea);
    const nodeFactor = Math.sqrt(baseNodeCount / nodeCount);
    const zoom = areaFactor * nodeFactor * 0.6;
    return Math.max(minZoom, Math.min(maxZoom, zoom));
};

// 保存原始大小信息
xilianChart.saveOriginalSizes = function(option) {
    if (option.series && option.series[0]) {
        option.series[0].originalSymbolSizes = [];
        option.series[0].originalLabelFontSizes = [];
        
        if (option.series[0].data) {
            option.series[0].data.forEach(node => {
                option.series[0].originalSymbolSizes.push(node.symbolSize || 20);
                option.series[0].originalLabelFontSizes.push(node.label ? node.label.fontSize || 12 : 12);
            });
        }
    }
};

// 应用缩放到选项
xilianChart.applyZoomToOption = function(option, zoom) {
    if (option.series && option.series[0]) {
        const series = option.series[0];
        
        // 更新节点大小
        if (series.data && series.originalSymbolSizes) {
            series.data.forEach((node, index) => {
                const originalSize = series.originalSymbolSizes[index];
                if (originalSize) {
                    node.symbolSize = originalSize * zoom;
                }
            });
        }
        
        // 更新标签字体大小
        if (series.data && series.originalLabelFontSizes) {
            series.data.forEach((node, index) => {
                const originalFontSize = series.originalLabelFontSizes[index];
                if (originalFontSize && node.label) {
                    node.label.fontSize = originalFontSize * zoom;
                }
            });
        }
    }
};

// 工具提示格式化函数
xilianChart.tooltipFormatter = function(params) {
    if (params.data && params.data.desc) {
        return '<div class="echarts-tooltip-content">' + params.data.desc + '</div>';
    }
    return params.name;
};

// 预处理图表选项
xilianChart.preprocessOption = function(option) {
    // 解析 CSS 变量
    option = xilianChart.parseCSSVariables(option);
    
    if (option.tooltip && option.tooltip.formatter === "tooltipFormatter") {
        option.tooltip.formatter = xilianChart.tooltipFormatter;
    }
    
    // 设置 toolbox 功能
    xilianChart.setupToolboxFeatures(option);
    
    return option;
};

// 设置 toolbox 功能
xilianChart.setupToolboxFeatures = function(option) {
    if (option.toolbox && option.toolbox.feature) {
        // 增加斥力
        if (option.toolbox.feature.myRepulsionIncrease) {
            option.toolbox.feature.myRepulsionIncrease.onclick = function() {
                console.log('增加斥力');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0] && currentOption.series[0].force) {
                        const newRepulsion = (currentOption.series[0].force.repulsion || 100) * 1.2;
                        console.log('新斥力值:', newRepulsion);
                        // 使用 setOption 方法更新
                        chart.setOption({
                            series: [{
                                force: {
                                    repulsion: newRepulsion
                                }
                            }]
                        });
                    }
                }
            };
        }
        
        // 减少斥力
        if (option.toolbox.feature.myRepulsionDecrease) {
            option.toolbox.feature.myRepulsionDecrease.onclick = function() {
                console.log('减少斥力');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0] && currentOption.series[0].force) {
                        const newRepulsion = Math.max(10, (currentOption.series[0].force.repulsion || 100) * 0.8);
                        console.log('新斥力值:', newRepulsion);
                        chart.setOption({
                            series: [{
                                force: {
                                    repulsion: newRepulsion
                                }
                            }]
                        });
                    }
                }
            };
        }
        
        // 减少重力
        if (option.toolbox.feature.myGravityDecrease) {
            option.toolbox.feature.myGravityDecrease.onclick = function() {
                console.log('减少重力');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0] && currentOption.series[0].force) {
                        const newGravity = Math.max(0.01, (currentOption.series[0].force.gravity || 0.1) * 0.8);
                        console.log('新重力值:', newGravity);
                        chart.setOption({
                            series: [{
                                force: {
                                    gravity: newGravity
                                }
                            }]
                        });
                    }
                }
            };
        }
        
        // 增加重力
        if (option.toolbox.feature.myGravityIncrease) {
            option.toolbox.feature.myGravityIncrease.onclick = function() {
                console.log('增加重力');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0] && currentOption.series[0].force) {
                        const newGravity = Math.min(2, (currentOption.series[0].force.gravity || 0.1) * 1.2);
                        console.log('新重力值:', newGravity);
                        chart.setOption({
                            series: [{
                                force: {
                                    gravity: newGravity
                                }
                            }]
                        });
                    }
                }
            };
        }
        
        // 放大
        if (option.toolbox.feature.myZoomIn) {
            option.toolbox.feature.myZoomIn.onclick = function() {
                console.log('放大');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0]) {
                        const newZoom = (currentOption.series[0].zoom || 1) * 1.2;
                        console.log('新缩放值:', newZoom);
                        chart.setOption({
                            series: [{
                                zoom: newZoom
                            }]
                        });
                    }
                }
            };
        }
        
        // 缩小
        if (option.toolbox.feature.myZoomOut) {
            option.toolbox.feature.myZoomOut.onclick = function() {
                console.log('缩小');
                const chart = xilianChart.chartInstance;
                if (chart) {
                    const currentOption = chart.getOption();
                    if (currentOption.series && currentOption.series[0]) {
                        const newZoom = Math.max(0.1, (currentOption.series[0].zoom || 1) * 0.8);
                        console.log('新缩放值:', newZoom);
                        chart.setOption({
                            series: [{
                                zoom: newZoom
                            }]
                        });
                    }
                }
            };
        }
    }
};

// 创建或更新图表
xilianChart.createOrUpdateChart = function(chartDom, optionsStr, createNewInstance) {
    console.log('xilianChart.createOrUpdateChart called');
    console.log('Chart DOM:', chartDom);
    console.log('Chart DOM size:', {
        width: chartDom.clientWidth,
        height: chartDom.clientHeight
    });
    
    var options = JSON.parse(optionsStr);
    console.log('Parsed options:', options);
    
    // 应用样式
    if (options.css) {
        xilianChart.applyChartStyles(options.css);
    }
    
    // 提取option部分
    var chartOption = options.option || options;
    console.log('Chart option before preprocess:', chartOption);
    
    // 确保启用 roam 功能
    if (chartOption.series && chartOption.series[0]) {
        if (chartOption.series[0].roam === undefined) {
            chartOption.series[0].roam = true;
            console.log('Enabled roam for series');
        }
    }
    
    // 计算初始缩放级别
    let initialZoom = 1.0;
    if (chartOption.series && chartOption.series[0] && chartOption.series[0].data) {
        const nodeCount = chartOption.series[0].data.length;
        initialZoom = xilianChart.calculateInitialZoom(chartDom, nodeCount);
        console.log("initialZoom", initialZoom);
        
        // 直接设置 zoom 属性
        chartOption.series[0].zoom = initialZoom;
        console.log('Set zoom property:', initialZoom);
    }
    
    // 预处理图表选项
    chartOption = xilianChart.preprocessOption(chartOption);
    console.log('Chart option after preprocess:', chartOption);
    
    // 如果是创建新实例，先销毁旧实例
    if (createNewInstance || !chartDom.chartInstance) {
        console.log('Creating new chart instance');
        if (chartDom.chartInstance) {
            console.log('Disposing old chart instance');
            chartDom.chartInstance.dispose();
        }
        chartDom.chartInstance = echarts.init(chartDom);
        console.log('Chart instance created:', chartDom.chartInstance);
        
        // 保存到全局命名空间
        xilianChart.chartInstance = chartDom.chartInstance;
    }
    
    try {
        // 设置配置项并渲染图表
        console.log('Setting chart option...');
        chartDom.chartInstance.setOption(chartOption);
        console.log('Chart option set successfully');
        
        // 检查图表实例状态
        console.log('Chart instance exists:', !!chartDom.chartInstance);
        console.log('Chart instance is disposed:', chartDom.chartInstance.isDisposed());
    } catch (error) {
        console.error('Error setting chart option:', error);
    }
    
    // 响应式调整
    window.addEventListener('resize', function() {
        if (chartDom.chartInstance) {
            chartDom.chartInstance.resize();
        }
    });
};
