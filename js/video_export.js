// 視頻素材導出（實驗）：把畫面上的「一頁」畫成 PNG。
//
// 為什麼不直接用 html2canvas / DOM 截圖：
//   1. 我們要的是「畫幅大小」的成品圖，而頁面本身是按標音結果的版式排的，
//      直接截圖再縮放會糊；所以先拿到每段文字的實際位置（Range.getClientRects），
//      再按目標縮放把字重畫到 canvas 上（文字是重新渲染的，邊緣清晰）。
//   2. 這樣還能直接用頁面已載入的網頁字體（LingDong / 方正宋刻本等）。
//
// 幾個要注意的地方（都踩過）：
//   - 注音 rt 用 `transform: scaleX()` 壓窄，canvas 畫字不會套用 transform，
//     所以要用「rect 寬 ÷ measureText 寬」把整段文字横向壓回去；
//   - 逐字畫會丟掉字距（Latin、聲調符號會擠在一起），所以按「整段文本」畫，
//     只有跨行/豎排的情況才退回逐字；
//   - 聲調曲線/音符是內聯 SVG，在視頻畫面裡被 CSS 隱藏（見 duyin.scss），
//     因為有旋律時單個 SVG 高度可達上千 px，會把排版撐爆。
(function () {
  'use strict';

  // 背景色：容器本身多半是透明的，退回主題的 --color-output-bg
  function resolveBg(bgColor) {
    const normalized = (bgColor || '').replace(/\s+/g, ' ');
    const transparent =
      !normalized || normalized === 'transparent' || /rgba\([^)]*, 0(\.0+)?\)$/.test(normalized);
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

  function fontOf(style) {
    return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
  }

  // 收集「一段文字」：{text, rect, font, color, perChar}
  function collectRuns(root) {
    const runs = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.textContent;
      if (!raw || !raw.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      const font = fontOf(style);
      const color = style.color;
      // 去掉首尾空白（保留中間空格，Latin 詞之間要靠它）
      const text = raw.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      if (!text) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.prototype.slice.call(range.getClientRects());
      const visible = rects.filter(function (r) {
        return r.width > 0 && r.height > 0;
      });
      if (!visible.length) continue;

      if (visible.length === 1) {
        runs.push({ text: text, rect: visible[0], font: font, color: color, perChar: false });
      } else {
        // 跨行（或豎排逐字）：退回逐字定位
        for (let i = 0; i < raw.length; i++) {
          const ch = raw[i];
          if (!ch || !ch.trim()) continue;
          const r2 = document.createRange();
          r2.setStart(node, i);
          r2.setEnd(node, i + 1);
          const rect = r2.getClientRects()[0];
          if (!rect || rect.width <= 0 || rect.height <= 0) continue;
          runs.push({ text: ch, rect: rect, font: font, color: color, perChar: true });
        }
      }
    }
    return runs;
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
    // 以 2 倍解析度繪製，文字更清晰（輸出仍是畫幅像素）
    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(frameW * dpr));
    canvas.height = Math.max(1, Math.round(frameH * dpr));
    const ctx = canvas.getContext('2d');
    const k = scale * dpr;
    ctx.fillStyle = resolveBg(bgColor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 以「實際文字的外接框」居中，而不是頁面元素的盒子：
    // 頁面盒子常常比文字寬（max-content / padding / 空行），用它居中會讓內容偏左。
    const runs = collectRuns(el);
    if (!runs.length) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const run of runs) {
      minX = Math.min(minX, run.rect.left);
      minY = Math.min(minY, run.rect.top);
      maxX = Math.max(maxX, run.rect.right);
      maxY = Math.max(maxY, run.rect.bottom);
    }
    const offX = (frameW - (maxX - minX) * scale) / 2;
    const offY = (frameH - (maxY - minY) * scale) / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const run of runs) {
      const x = (offX + (run.rect.left - minX) * scale) * dpr;
      const y = (offY + (run.rect.top - minY) * scale) * dpr;
      const w = run.rect.width * scale * dpr;
      const h = run.rect.height * scale * dpr;

      const font = scaleFont(run.font, k);
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = run.color;

      const measured = ctx.measureText(run.text).width;
      if (run.perChar) {
        // 逐字：畫在各自 rect 的中心
        ctx.textAlign = 'center';
        ctx.fillText(run.text, x + w / 2, y + h / 2);
      } else {
        // 整段：左對齊畫在 rect 內，並用 rect 寬度校正（注音的 scaleX 壓縮）
        const squeeze = measured > 0.5 ? w / measured : 1;
        ctx.translate(x, y + h / 2);
        if (Math.abs(squeeze - 1) > 0.02 && isFinite(squeeze)) {
          ctx.scale(squeeze, 1);
        }
        ctx.fillText(run.text, 0, 0);
      }
      ctx.restore();
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  window.zhongwenVideo = { rasterizePage: rasterizePage };
})();
