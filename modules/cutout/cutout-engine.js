/**
 * Plant cutout engine — shared by Plant Calendar (index.html) & cutout-demo.html
 * Local high-precision cutout + white stroke + complexity-aware simplification
 */
(function (global) {
  const PLANT = [61, 107, 82];

  function loadImg(src) {
    return new Promise((ok, no) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('图片加载失败'));
      i.src = src;
    });
  }

  function blobToUrl(blob) {
    return new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => no(new Error('读取失败'));
      r.readAsDataURL(blob);
    });
  }

  async function resizeBlob(blob, max = 1024) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImg(url);
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * sc));
      const h = Math.max(1, Math.round(img.naturalHeight * sc));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return await new Promise((ok, no) =>
        c.toBlob((b) => (b ? ok(b) : no(new Error('压缩失败'))), 'image/jpeg', 0.92),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function sampleBg(d, w, h) {
    const pts = [];
    for (let x = 0; x < w; x++) pts.push([x, 0], [x, h - 1]);
    for (let y = 1; y < h - 1; y++) pts.push([0, y], [w - 1, y]);
    let r = 0, g = 0, b = 0, n = 0;
    pts.forEach(([x, y]) => {
      const k = (y * w + x) * 4;
      if (d[k + 3] < 30) return;
      r += d[k];
      g += d[k + 1];
      b += d[k + 2];
      n++;
    });
    return n ? { r: r / n, g: g / n, b: b / n } : { r: 255, g: 255, b: 255 };
  }

  function isBg(r, g, b, a, bg) {
    if (a < 20) return true;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const dist = Math.hypot(r - bg.r, g - bg.g, b - bg.b);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const shadow = lum < 82 && sat < 0.24 && dist < 100;
    return dist < 68 || lum > 246 || (lum > 202 && sat < 0.17) || shadow;
  }

  function buildMask(d, w, h) {
    const mask = new Uint8Array(w * h);
    let tr = 0;
    for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] < 20) tr++;
    const useAlpha = tr / (w * h) > 0.04;
    if (useAlpha) {
      for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 22 ? 1 : 0;
    } else {
      const bg = sampleBg(d, w, h);
      for (let i = 0; i < w * h; i++) {
        const k = i * 4;
        mask[i] = isBg(d[k], d[k + 1], d[k + 2], d[k + 3], bg) ? 0 : 1;
      }
    }
    return mask;
  }

  function dilate(mask, w, h, r) {
    const out = new Uint8Array(w * h);
    const r2 = r * r;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) {
          out[i] = 1;
          continue;
        }
        let hit = false;
        for (let dy = -r; dy <= r && !hit; dy++)
          for (let dx = -r; dx <= r && !hit; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) hit = true;
          }
        out[i] = hit ? 1 : 0;
      }
    return out;
  }

  function erode(mask, w, h, r) {
    const out = new Uint8Array(w * h);
    const r2 = r * r;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) {
          out[i] = 0;
          continue;
        }
        let keep = true;
        for (let dy = -r; dy <= r && keep; dy++)
          for (let dx = -r; dx <= r && keep; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) keep = false;
          }
        out[i] = keep ? 1 : 0;
      }
    return out;
  }

  function keepLargest(mask, w, h) {
    const vis = new Uint8Array(w * h);
    const lbl = new Int32Array(w * h).fill(-1);
    let best = 0;
    let bestId = -1;
    let id = 0;
    const flood = (sx, sy, tag) => {
      const st = [[sx, sy]];
      let n = 0;
      while (st.length) {
        const [x, y] = st.pop();
        const i = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || vis[i] || !mask[i]) continue;
        vis[i] = 1;
        lbl[i] = tag;
        n++;
        st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return n;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!vis[i] && mask[i]) {
          const n = flood(x, y, id);
          if (n > best) {
            best = n;
            bestId = id;
          }
          id++;
        }
      }
    if (best < 16) return mask;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = lbl[i] === bestId ? 1 : 0;
    return out;
  }

  function measureComplexity(mask, w, h) {
    let edge = 0;
    let fg = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        fg++;
        const border =
          !mask[(y - 1) * w + x] ||
          !mask[(y + 1) * w + x] ||
          !mask[y * w + x - 1] ||
          !mask[y * w + x + 1];
        if (border) edge++;
      }
    const score = fg ? edge / Math.sqrt(fg) : 0;
    return { edge, fg, score, complex: score >= 7.5 };
  }

  function simplifyMask(mask, w, h) {
    let m = erode(mask, w, h, 3);
    m = dilate(m, w, h, 6);
    m = erode(m, w, h, 2);
    m = dilate(m, w, h, 2);
    return keepLargest(m, w, h);
  }

  function boundsFromMask(mask, w, h) {
    let mx = w;
    let my = h;
    let Mx = 0;
    let My = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (mask[y * w + x]) {
          mx = Math.min(mx, x);
          my = Math.min(my, y);
          Mx = Math.max(Mx, x);
          My = Math.max(My, y);
        }
    if (Mx < mx) return null;
    return { mx, my, w: Mx - mx + 1, h: My - my + 1 };
  }

  function toCutoutImageData(mask, d, w, h) {
    const out = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (mask[i]) {
        out.data[o] = d[o];
        out.data[o + 1] = d[o + 1];
        out.data[o + 2] = d[o + 2];
        out.data[o + 3] = 255;
      }
    }
    return out;
  }

  function collectEdgePoints(imageData) {
    const { width, height, data } = imageData;
    const pts = [];
    const opaque = (x, y) =>
      x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] > 128;
    const edge = (x, y) =>
      opaque(x, y) &&
      (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) if (edge(x, y)) pts.push([x, y]);
    return pts;
  }

  function buildContourPath(imageData) {
    const { width, height, data } = imageData;
    const path = new Path2D();
    const opaque = (x, y) =>
      x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] > 128;
    const edge = (x, y) =>
      opaque(x, y) &&
      (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1));
    let sx = -1;
    let sy = -1;
    outer: for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (edge(x, y)) {
          sx = x;
          sy = y;
          break outer;
        }
    if (sx < 0) return path;
    const dirs = [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    let x = sx;
    let y = sy;
    let dir = 0;
    path.moveTo(x, y);
    let steps = 0;
    do {
      let found = false;
      for (let i = 0; i < 8; i++) {
        const d = (dir + i + 5) % 8;
        const nx = x + dirs[d][0];
        const ny = y + dirs[d][1];
        if (edge(nx, ny)) {
          x = nx;
          y = ny;
          dir = d;
          path.lineTo(x, y);
          found = true;
          break;
        }
      }
      if (!found) break;
      steps++;
    } while ((x !== sx || y !== sy) && steps < width * height * 4);
    path.closePath();
    return path;
  }

  function buildSummaryPath(mask, w, h) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    let mx = w;
    let my = h;
    let Mx = 0;
    let My = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (mask[y * w + x]) {
          sx += x;
          sy += y;
          n++;
          mx = Math.min(mx, x);
          my = Math.min(my, y);
          Mx = Math.max(Mx, x);
          My = Math.max(My, y);
        }
    const path = new Path2D();
    if (!n) return path;
    const cx = sx / n;
    const cy = sy / n;
    const rx = (Mx - mx) * 0.42 + 6;
    const ry = (My - my) * 0.46 + 8;
    path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    return path;
  }

  function cutoutToCanvas(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return c;
  }

  function addWhiteStrokeFromImageData(imageData, lineWidth = 3) {
    const pad = lineWidth + 6;
    const iw = imageData.width;
    const ih = imageData.height;
    const c = document.createElement('canvas');
    c.width = iw + pad * 2;
    c.height = ih + pad * 2;
    const ctx = c.getContext('2d');
    const contour = buildContourPath(imageData);
    const tmp = cutoutToCanvas(imageData);
    ctx.save();
    ctx.translate(pad, pad);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(contour);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    return c.toDataURL('image/png');
  }

  function addSilhouetteStroke(mask, w, h, lineWidth = 3, simplified = false) {
    const pad = lineWidth + 6;
    const c = document.createElement('canvas');
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    const ctx = c.getContext('2d');
    const id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      id.data[o] = PLANT[0];
      id.data[o + 1] = PLANT[1];
      id.data[o + 2] = PLANT[2];
      id.data[o + 3] = 255;
    }
    const contour = simplified ? buildSummaryPath(mask, w, h) : buildContourPath(id);
    ctx.save();
    ctx.translate(pad, pad);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(contour);
    ctx.fillStyle = `rgb(${PLANT.join(',')})`;
    if (simplified) {
      ctx.fill(contour);
    } else {
      const img = cutoutToCanvas(id);
      ctx.drawImage(img, 0, 0);
    }
    ctx.restore();
    return c.toDataURL('image/png');
  }

  function processImageData(id, w, h, lineWidth = 3, hooks) {
    let mask = buildMask(id.data, w, h);
    mask = dilate(mask, w, h, 1);
    mask = erode(mask, w, h, 2);
    mask = dilate(mask, w, h, 1);
    mask = keepLargest(mask, w, h);
    const complexity = measureComplexity(mask, w, h);
    const simplified = complexity.complex;
    if (simplified) mask = simplifyMask(mask, w, h);
    const b = boundsFromMask(mask, w, h);
    if (!b || b.w < 3) throw new Error('no subject');

    const croppedMask = new Uint8Array(b.w * b.h);
    const croppedData = new Uint8ClampedArray(b.w * b.h * 4);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const si = (b.my + y) * w + (b.mx + x);
        const di = y * b.w + x;
        croppedMask[di] = mask[si];
        const so = si * 4;
        const doo = di * 4;
        croppedData[doo] = id.data[so];
        croppedData[doo + 1] = id.data[so + 1];
        croppedData[doo + 2] = id.data[so + 2];
        croppedData[doo + 3] = mask[si] ? 255 : 0;
      }

    const cutout = new ImageData(croppedData, b.w, b.h);
    if (hooks?.onPreview) hooks.onPreview(cutoutToCanvas(cutout).toDataURL('image/png'), { simplified });

    return addWhiteStrokeFromImageData(cutout, lineWidth);
  }

  async function fromBlob(blob, options = {}) {
    const lineWidth = options.lineWidth ?? 3;
    const hooks = options.hooks;
    const resized = options.resize === false ? blob : await resizeBlob(blob, options.max ?? 1024);
    const url = URL.createObjectURL(resized);
    try {
      const img = await loadImg(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return processImageData(ctx.getImageData(0, 0, w, h), w, h, lineWidth, hooks);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function fromFile(file, options = {}) {
    return fromBlob(file, options);
  }

  async function fromCanvas(canvas, options = {}) {
    const lineWidth = options.lineWidth ?? 3;
    return processImageData(
      canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
      canvas.width,
      canvas.height,
      lineWidth,
      options.hooks,
    );
  }

  async function preset(type, options = {}) {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 280;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 240, 280);
    drawLeaf(ctx, 240, 280, type);
    return fromCanvas(c, options);
  }

  function drawLeaf(ctx, w, h, type) {
    ctx.fillStyle = '#3d6b52';
    if (type === 'pot') {
      ctx.fillStyle = '#c67b4e';
      ctx.beginPath();
      ctx.moveTo(w * 0.28, h * 0.72);
      ctx.lineTo(w * 0.72, h * 0.72);
      ctx.lineTo(w * 0.68, h * 0.88);
      ctx.lineTo(w * 0.32, h * 0.88);
      ctx.fill();
      ctx.fillStyle = '#3d6b52';
    }
    if (type === 'monstera' || type === 'pot') {
      const cx = w / 2;
      const cy = h * (type === 'pot' ? 0.42 : 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, cy - h * 0.28);
      ctx.bezierCurveTo(cx - w * 0.3, cy - h * 0.1, cx - w * 0.28, cy + h * 0.2, cx, cy + h * 0.28);
      ctx.bezierCurveTo(cx + w * 0.28, cy + h * 0.2, cx + w * 0.3, cy - h * 0.1, cx, cy - h * 0.28);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,50,38,.3)';
      [[-0.1, -0.05], [0.08, 0.02], [-0.02, 0.12]].forEach(([fx, fy]) => {
        ctx.beginPath();
        ctx.ellipse(cx + fx * w, cy + fy * h, 8, 14, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = '#3d6b52';
      if (type === 'pot') {
        ctx.beginPath();
        ctx.ellipse(cx - w * 0.15, cy + h * 0.05, 14, 22, -0.4, 0, Math.PI * 2);
        ctx.ellipse(cx + w * 0.12, cy + h * 0.02, 12, 20, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'succulent') {
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2, w * 0.35 + i * 16, 14 - i * 2, 28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'leaf') {
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.15);
      ctx.bezierCurveTo(w * 0.2, h * 0.4, w * 0.25, h * 0.75, w / 2, h * 0.85);
      ctx.bezierCurveTo(w * 0.75, h * 0.75, w * 0.8, h * 0.4, w / 2, h * 0.15);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.5, 40, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  global.PlantCutoutEngine = {
    fromBlob,
    fromFile,
    fromCanvas,
    preset,
    drawLeaf,
    PLANT,
  };
})(window);
