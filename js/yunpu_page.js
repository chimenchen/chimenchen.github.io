function initTooltips() {
    let tooltip = null;
    let currentElement = null;
    const showDelay = 200; // 顯示延遲，毫秒
    let showTimeout;

    function createTooltip() {
        const div = document.createElement('div');
        div.className = 'custom-tooltip';
        document.body.appendChild(div);
        return div;
    }

    function showTooltip(element) {
        const text = element.getAttribute('data-tooltip') || element.getAttribute('title');
        if (!text) return;

        if (!tooltip) {
            tooltip = createTooltip();
        }
        tooltip.textContent = text;

        const rect = element.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.top = `${rect.bottom + 5}px`;
        tooltip.style.display = 'block';

        // 暫時移除 title 屬性以禁用默認 tooltip
        if (element.hasAttribute('title')) {
            element.setAttribute('data-original-title', element.getAttribute('title'));
            element.removeAttribute('title');
        }
    }

    function hideTooltip() {
        if (tooltip) {
            tooltip.style.display = 'none';
        }
        if (showTimeout) {
            clearTimeout(showTimeout);
        }
        // 恢復 title 屬性
        if (currentElement && currentElement.hasAttribute('data-original-title')) {
            currentElement.setAttribute('title', currentElement.getAttribute('data-original-title'));
            currentElement.removeAttribute('data-original-title');
        }
    }

    function handleMouseEnter(e) {
        const target = e.target.closest('.zi, .yunduan, .author-name, .yunbu');
        if (target) {
            currentElement = target;
            showTimeout = setTimeout(() => showTooltip(target), showDelay);
        }
    }

    function handleMouseLeave() {
        hideTooltip();
        currentElement = null;
    }

    function handleTouchStart(e) {
        const target = e.target.closest('.zi, .yunduan, .author-name, .yunbu');
        if (target) {
            if (currentElement === target) {
                hideTooltip();
                currentElement = null;
            } else {
                hideTooltip();
                currentElement = target;
                showTooltip(target);
            }
            e.preventDefault(); // 防止觸發點擊事件
        } else {
            hideTooltip();
            currentElement = null;
        }
    }

    document.body.addEventListener('mouseenter', handleMouseEnter, true);
    document.body.addEventListener('mouseleave', handleMouseLeave, true);
    document.body.addEventListener('touchstart', handleTouchStart);
}

document.addEventListener('DOMContentLoaded', function() {
    // 確保 document.body 存在
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTooltips);
    } else {
        initTooltips();
    }
});