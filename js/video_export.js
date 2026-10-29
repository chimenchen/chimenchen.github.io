// 視頻素材導出（實驗）：把畫面上的「一頁」畫成 PNG / 量出「一頁」的自然尺寸。
//
// 做法：不截圖，而是取出每個文字段與每個內聯 SVG 的實際位置（getClientRects），
// 再按目標縮放把它們重畫到 canvas 上。這樣：
//   - 文字用頁面已載入的網頁字體，放大後仍然清晰；
//   - 聲調曲線/音符是內聯 SVG，序列化成 data URL 後用 Image 畫到 canvas，形狀完全一致。
//
// 幾個踩過的坑：
//   - 注音 rt 用 `transform: scaleX()` 壓窄，canvas 畫字不套用 transform，
//     所以用「rect 寬 ÷ measureText 寬」把整段文字横向壓回去；
//   - 逐字畫會丟掉字距（Latin、聲調符號會擠在一起），所以按「整段文本」畫，
//     只有跨行/豎排才退回逐字；
//   - SVG 裡的顏色用了 CSS 變量（例 stroke="var(--color-tone-line)"），
//     序列化成圖片後變量不會解析，要先換成計算後的實際顏色；
//   - 居中要按「文字的實際外接框」，不能按頁面元素盒子（盒子多半比文字寬，會偏左）。
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

  function isVisible(el, style) {
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
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
      if (!isVisible(parent, style)) continue;
      const font = fontOf(style);
      const color = style.color;
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

  // 收集內聯 SVG（聲調曲線、音符）
  function collectSvgs(root) {
    const svgs = [];
    const list = root.querySelectorAll('svg');
    for (const svg of list) {
      const style = window.getComputedStyle(svg);
      if (!isVisible(svg, style)) continue;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      svgs.push({ rect: rect, node: svg });
    }
    return svgs;
  }

  // SVG → data URL（把 CSS 變量換成實際顏色）
  function svgToDataUrl(svg) {
    const clone = svg.cloneNode(true);
    const originals = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll('*')));
    const clones = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (let i = 0; i < clones.length; i++) {
      const src = originals[i];
      const dst = clones[i];
      const cs = window.getComputedStyle(src);
      ['stroke', 'fill', 'stop-color'].forEach(function (attr) {
        const v = dst.getAttribute(attr);
        if (v && v.indexOf('var(') >= 0) {
          const resolved = cs.getPropertyValue(attr);
          if (resolved) dst.setAttribute(attr, resolved);
        }
      });
      const styleAttr = dst.getAttribute('style');
      if (styleAttr && styleAttr.indexOf('var(') >= 0) {
        dst.setAttribute('style', styleAttr.replace(/var\([^)]*\)/g, ''));
      }
    }
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    const text = new XMLSerializer().serializeToString(clone);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = src;
    });
  }

  // 一頁的內容：文字段 + SVG，以及它們的外接框
  function pageContent(el) {
    const runs = collectRuns(el);
    const svgs = collectSvgs(el);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const addRect = function (r) {
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    };
    runs.forEach(function (r) {
      addRect(r.rect);
    });
    svgs.forEach(function (s) {
      addRect(s.rect);
    });
    const empty = !isFinite(minX);
    return { runs: runs, svgs: svgs, minX: minX, minY: minY, maxX: maxX, maxY: maxY, empty: empty };
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
    // 2 倍解析度繪製，文字更清晰（輸出仍是畫幅像素）
    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(frameW * dpr));
    canvas.height = Math.max(1, Math.round(frameH * dpr));
    const ctx = canvas.getContext('2d');
    const k = scale * dpr;
    ctx.fillStyle = resolveBg(bgColor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const content = pageContent(el);
    if (content.empty) {
      const blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, 'image/png');
      });
      return new Uint8Array(await blob.arrayBuffer());
    }

    const offX = (frameW - (content.maxX - content.minX) * scale) / 2;
    const offY = (frameH - (content.maxY - content.minY) * scale) / 2;
    const toX = function (x) {
      return (offX + (x - content.minX) * scale) * dpr;
    };
    const toY = function (y) {
      return (offY + (y - content.minY) * scale) * dpr;
    };

    // 先畫 SVG（聲調曲線/音符在文字的上下方），再畫文字
    const images = await Promise.all(
      content.svgs.map(function (s) {
        return loadImage(svgToDataUrl(s.node));
      })
    );

    content.svgs.forEach(function (s, i) {
      const img = images[i];
      if (!img) return;
      ctx.drawImage(
        img,
        toX(s.rect.left),
        toY(s.rect.top),
        s.rect.width * scale * dpr,
        s.rect.height * scale * dpr
      );
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const run of content.runs) {
      const x = toX(run.rect.left);
      const y = toY(run.rect.top);
      const w = run.rect.width * scale * dpr;
      const h = run.rect.height * scale * dpr;

      ctx.save();
      ctx.font = scaleFont(run.font, k);
      ctx.fillStyle = run.color;

      const measured = ctx.measureText(run.text).width;
      if (run.perChar) {
        ctx.textAlign = 'center';
        ctx.fillText(run.text, x + w / 2, y + h / 2);
      } else {
        const squeeze = measured > 0.5 ? w / measured : 1;
        ctx.translate(x, y + h / 2);
        if (isFinite(squeeze) && Math.abs(squeeze - 1) > 0.02) {
          ctx.scale(squeeze, 1);
        }
        ctx.fillText(run.text, 0, 0);
      }
      ctx.restore();
    }

    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('canvas.toBlob failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * 量出容器內每一頁的自然尺寸（與導出用的外接框完全一致）。
   * @returns {Promise<Array<[number, number]>>}
   */
  async function measurePages(root) {
    const pages = root.querySelectorAll('.video-measure-page, .video-export-page');
    const out = [];
    for (const el of pages) {
      const c = pageContent(el);
      if (c.empty) {
        out.push([0, 0]);
      } else {
        out.push([Math.round(c.maxX - c.minX), Math.round(c.maxY - c.minY)]);
      }
    }
    return out;
  }

  window.zhongwenVideo = { rasterizePage: rasterizePage, measurePages: measurePages };
})();
