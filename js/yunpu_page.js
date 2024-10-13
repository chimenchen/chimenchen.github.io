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
    let touchStartTime;
    const touchDelay = 500; // 毫秒

    function createTooltip(text) {
        const div = document.createElement('div');
        div.className = 'custom-tooltip';
        div.textContent = text;
        document.body.appendChild(div);
        return div;
    }

    function showTooltip(e, element) {
        const text = element.getAttribute('title') || element.getAttribute('data-tooltip');
        if (!text) return;

        if (!tooltip) {
            tooltip = createTooltip(text);
        } else {
            tooltip.textContent = text;
        }

        const rect = element.getBoundingClientRect();
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.top = `${rect.bottom + 5}px`;
        tooltip.style.display = 'block';
    }

    function hideTooltip() {
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }

    document.body.addEventListener('mouseover', function(e) {
        const target = e.target.closest('.zi, .yunduan, .author-name, .yunbu');
        if (target) {
            showTooltip(e, target);
        }
    });

    document.body.addEventListener('mouseout', hideTooltip);

    document.body.addEventListener('touchstart', function(e) {
        touchStartTime = new Date().getTime();
    });

    document.body.addEventListener('touchend', function(e) {
        const touchEndTime = new Date().getTime();
        const touchDuration = touchEndTime - touchStartTime;

        if (touchDuration < touchDelay) {
            const target = e.target.closest('.zi, .yunduan, .author-name, .yunbu');
            if (target) {
                e.preventDefault(); // 防止觸發點擊事件
                showTooltip(e, target);
            } else {
                hideTooltip();
            }
        }
    });
}
