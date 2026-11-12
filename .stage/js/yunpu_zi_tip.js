// /js/yunpu_zi_tip.js
//
// 韻字提示浮層（韻段列表 .zi、例證 .rhyme-zi 共用）。
//
// 為什麼不用 title：
//   * title 不能只把「當前依據」那一段加粗；
//   * 觸控裝置根本無法顯示 title。
//
// 為什麼不用 Rust 端 state：
//   兩份列表（韻段列表、例證）在不同元件裡，用一份 document 級委派最省；
//   而且滑鼠與觸控可以共用同一套定位邏輯。
//
// 互動：
//   滑鼠：移入顯示、移出隱藏
//   觸控：點一下顯示並固定，點空白處／捲動／按 Esc 收起

(function (window, document) {
    'use strict';

    const SELECTOR = '.zi, .rhyme-zi';
    const GAP = 8; // 與字之間的距離
    const EDGE = 8; // 與視窗邊緣的最小距離
    const MAX_WIDTH = 22 * 16; // 22em，超過就換行

    let tip = null;
    let pinned = false;
    let hidden = true;

    function ensureTip() {
        if (tip) {
            return tip;
        }
        tip = document.createElement('div');
        tip.className = 'zi-tip';
        tip.setAttribute('role', 'tooltip');
        tip.style.display = 'none';
        tip.style.maxWidth = `min(${MAX_WIDTH}px, 88vw)`;
        document.body.appendChild(tip);
        return tip;
    }

    function readData(el) {
        const get = name => el.getAttribute(name) || '';
        return {
            zi: get('data-zi'),
            q: get('data-q'),
            l: get('data-l'),
            s: get('data-s'),
            basis: parseInt(get('data-basis'), 10),
        };
    }

    // 沒有 data-* 的元素（例如找不到資料的韻字）就退回 title
    function fallbackTitle(el) {
        return el.getAttribute('title') || '';
    }

    function fill(el) {
        const node = ensureTip();
        node.textContent = '';
        const data = readData(el);

        if (!data.zi) {
            const text = fallbackTitle(el);
            if (!text) {
                return false;
            }
            node.textContent = text;
            node.style.whiteSpace = 'pre-line';
            return true;
        }

        node.style.whiteSpace = 'normal';

        const zi = document.createElement('span');
        zi.className = 'zi-tip-zi';
        zi.textContent = data.zi;
        node.appendChild(zi);

        const parts = [
            ['中古', data.q, 0],
            ['歷時', data.l, 1],
            ['上古', data.s, 2],
        ];
        parts.forEach(([label, value, idx]) => {
            if (!value) {
                return;
            }
            const span = document.createElement('span');
            span.className = 'zi-tip-part' + (data.basis === idx ? ' active' : '');
            span.textContent = `${label} ${value}`;
            node.appendChild(span);
        });
        return true;
    }

    function place(el) {
        const node = ensureTip();
        const rect = el.getBoundingClientRect();
        const w = node.offsetWidth;
        const h = node.offsetHeight;
        const vw = window.innerWidth || document.documentElement.clientWidth;

        const below = rect.top < h + 14;
        const top = below ? rect.bottom + GAP : rect.top - GAP;
        const center = rect.left + rect.width / 2;
        const left = Math.min(
            Math.max(center, w / 2 + EDGE),
            Math.max(vw - w / 2 - EDGE, w / 2 + EDGE)
        );

        node.style.left = `${Math.round(left)}px`;
        node.style.top = `${Math.round(top)}px`;
        node.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
    }

    function show(el) {
        if (!fill(el)) {
            return;
        }
        const node = ensureTip();
        node.style.display = 'flex';
        hidden = false;
        place(el); // 先量到寬高才放位置
    }

    function hide() {
        if (!tip) {
            return;
        }
        tip.style.display = 'none';
        hidden = true;
        pinned = false;
    }

    function pointerType(e) {
        return e.pointerType || (e.touches ? 'touch' : 'mouse');
    }

    // 滑鼠：移入顯示、移出隱藏
    document.addEventListener(
        'pointerover',
        e => {
            if (pointerType(e) === 'touch') {
                return; // 觸控交給 click，避免一碰就閃
            }
            const el = e.target.closest && e.target.closest(SELECTOR);
            if (el) {
                show(el);
            }
        },
        true
    );

    document.addEventListener(
        'pointerout',
        e => {
            if (pointerType(e) === 'touch' || pinned) {
                return;
            }
            const el = e.target.closest && e.target.closest(SELECTOR);
            if (el) {
                hide();
            }
        },
        true
    );

    // 觸控（也接受滑鼠點擊）：點字元顯示並固定；點空白處收起
    document.addEventListener(
        'click',
        e => {
            const el = e.target.closest && e.target.closest(SELECTOR);
            if (!el) {
                if (!hidden) {
                    hide();
                }
                return;
            }
            if (pointerType(e) === 'touch' || e.pointerType === '') {
                show(el);
                pinned = true;
            }
        },
        true
    );

    // 捲動、視窗尺寸改變、Esc 都收起（固定狀態下尤其重要）
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            hide();
        }
    });
})(window, document);
