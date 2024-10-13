function initResizeWhenReady() {
    const layout = document.querySelector('.yunpu-layout');
    if (layout) {
        const form = layout.querySelector('.yunpu-form');
        const handle = layout.querySelector('.resize-handle');
        if (form && handle) {
            initializeResize(layout, form, handle);
        }
    } else {
        // 如果還沒有找到 .yunpu-layout，等待一段時間後再次嘗試
        setTimeout(initResizeWhenReady, 100);
    }
}

function startObserving() {
    if (document.body) {
        // 使用 MutationObserver 監聽 DOM 變化
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                if (mutation.type === 'childList') {
                    const layout = document.querySelector('.yunpu-layout');
                    if (layout) {
                        initResizeWhenReady();
                        observer.disconnect(); // 停止觀察
                        break;
                    }
                }
            }
        });

        // 開始觀察
        observer.observe(document.body, { childList: true, subtree: true });
        initTooltips(); // 添加這一行
    } else {
        // 如果 body 還不存在，等待一段時間後再次嘗試
        setTimeout(startObserving, 50);
    }
}

// 開始嘗試觀察
startObserving();

// 保留原有的 DOMContentLoaded 事件監聽，以防萬一
document.addEventListener('DOMContentLoaded', initResizeWhenReady);

function initializeResize(layout, form, handle) {
    let isResizing = false;
    let startX, startWidth;

    function startResize(e) {
        isResizing = true;
        startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(form).width, 10);
        document.addEventListener('mousemove', resize);
        document.addEventListener('touchmove', resize);
        document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchend', stopResize);
        e.preventDefault(); // 防止文本選擇和滾動
    }

    function resize(e) {
        if (!isResizing) return;
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const width = startWidth + clientX - startX;
        const maxWidth = layout.clientWidth * 0.8;
        if (width > 200 && width < maxWidth) {
            form.style.width = width + 'px';
        }
    }

    function stopResize() {
        if (!isResizing) return;
        isResizing = false;
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('touchmove', resize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('touchend', stopResize);
    }

    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize);
}

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

// 在 DOM 加載完成後初始化 tooltips
document.addEventListener('DOMContentLoaded', initTooltips);
