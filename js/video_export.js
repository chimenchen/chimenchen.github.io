// 視頻素材導出（實驗）：把畫面上的「一頁」畫成 PNG。
//
// 為什麼不直接用 html2canvas / DOM 截圖：
//   1. 我們要的是「畫幅大小」的成品圖，而頁面本身是按標音結果的版式排的，
//      直接截圖再縮放會糊；所以先拿到每個字的實際位置（Range.getClientRects），
//      再按目標縮放把字重畫到 canvas 上（文字是重新渲染的，邊緣清晰）。
//   2. 這樣還能直接用頁面已載入的網頁字體（LingDong / 方正宋刻本等）。
//
// 注意：聲調曲線/音符是內聯 SVG，在視頻畫面裡被 CSS 隱藏了（見 duyin.scss），
// 因為有旋律時單個 SVG 高度可達上千 px，會把排版撐爆。
(function () {
  'use strict';

  // 收集 root 內每個字的位置與字體（ruby 注音也是獨立文本節點，所以都會被收集到）
  function collectChars(root) {
    const chars = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      const color = style.color;
      const font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].join(' ');
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const r = rects[0];
        if (r.width <= 0 || r.height <= 0) continue;
        chars.push({ ch, x: r.left, y: r.top, w: r.width, h: r.height, color, font });
      }
    }
    return chars;
  }

  // 背景色：容器本身多半是透明的，退回主題的 --color-output-bg
  function resolveBg(bgColor) {
    const transparent =
      !bgColor ||
      bgColor === 'transparent' ||
      /rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(bgColor.replace(/\s+/g, ' '));
    if (!transparent) {
      return bgColor;
    }
    const themeColor = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--color-output-bg')
      .trim();
    return themeColor || '#ffffea';
  }

  function scaleFont(font, scale) {
    return font.replace(/(\d+(?:\.\d+)?)px/, function (_m, px) {
      return (parseFloat(px) * scale).toFixed(2) + 'px';
    });
  }

  /**
   * 把 el（一頁的排版結果）光柵化成畫幅大小的 PNG。
   * @param {HTMLElement} el       頁面元素（自然尺寸，未縮放）
   * @param {number} frameW        畫幅寬 px
   * @param {number} frameH        畫幅高 px
   * @param {number} scale         縮放倍率（自然尺寸 → 畫幅像素）
   * @param {string} bgColor       背景色
   * @returns {Promise<Uint8Array>} PNG 位元組
   */
  async function rasterizePage(el, frameW, frameH, scale, bgColor) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(frameW));
    canvas.height = Math.max(1, Math.round(frameH));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = resolveBg(bgColor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const box = el.getBoundingClientRect();
    const offX = (frameW - box.width * scale) / 2;
    const offY = (frameH - box.height * scale) / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const c of collectChars(el)) {
      const x = offX + (c.x - box.left) * scale;
      const y = offY + (c.y - box.top) * scale;
      const w = c.w * scale;
      const h = c.h * scale;
      ctx.font = scaleFont(c.font, scale);
      ctx.fillStyle = c.color;
      // 用 middle 基線：字的視覺中心 ≈ 行盒中心（CJK 字都滿格，誤差很小）
      ctx.fillText(c.ch, x + w / 2, y + h / 2);
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  window.zhongwenVideo = { rasterizePage: rasterizePage };
})();
