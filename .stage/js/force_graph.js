// 力导向图实现
function createForceGraph(container, graphData) {
    // 清空容器
    d3.select(container).selectAll('*').remove();
    
    // 设置尺寸
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    // 创建SVG
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);
    
    // 创建力导向模拟
    const simulation = d3.forceSimulation(graphData.nodes)
        .force('link', d3.forceLink(graphData.links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2));
    
    // 创建连接线
    const link = svg.append('g')
        .selectAll('line')
        .data(graphData.links)
        .enter()
        .append('line')
        .attr('stroke', '#999')
        .attr('stroke-width', d => Math.sqrt(d.value));
    
    // 创建节点
    const node = svg.append('g')
        .selectAll('circle')
        .data(graphData.nodes)
        .enter()
        .append('circle')
        .attr('r', d => d.group === 1 ? 10 : 15)
        .attr('fill', d => d.group === 1 ? '#666' : '#333')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));
    
    // 添加节点标签
    const label = svg.append('g')
        .selectAll('text')
        .data(graphData.nodes)
        .enter()
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .text(d => d.label);
    
    // 更新模拟
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
        
        label
            .attr('x', d => d.x)
            .attr('y', d => d.y);
    });
    
    // 拖拽函数
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
}

// 暴露函数给Rust
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createForceGraph };
}
