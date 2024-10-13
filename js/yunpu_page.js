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
