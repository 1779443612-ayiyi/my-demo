const ALPHA_THRESHOLD = 128;

function isOpaque(data: Uint8ClampedArray, width: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width) return false;
  const height = data.length / (width * 4);
  if (y >= height) return false;
  return data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD;
}

function isEdgePixel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): boolean {
  if (!isOpaque(data, width, x, y)) return false;
  return (
    !isOpaque(data, width, x - 1, y) ||
    !isOpaque(data, width, x + 1, y) ||
    !isOpaque(data, width, x, y - 1) ||
    !isOpaque(data, width, x, y + 1)
  );
}

/** Moore-neighbor contour tracing → Path2D */
function buildContourPath(imageData: ImageData): Path2D {
  const { width, height, data } = imageData;
  const path = new Path2D();

  let startX = -1;
  let startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isEdgePixel(data, width, height, x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }

  if (startX < 0) return path;

  const dirs: [number, number][] = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ];

  let x = startX;
  let y = startY;
  let dir = 0;
  path.moveTo(x, y);

  const maxSteps = width * height * 4;
  let steps = 0;

  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + i + 5) % 8;
      const nx = x + dirs[checkDir][0];
      const ny = y + dirs[checkDir][1];
      if (isEdgePixel(data, width, height, nx, ny)) {
        x = nx;
        y = ny;
        dir = checkDir;
        path.lineTo(x, y);
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);

  path.closePath();
  return path;
}

export interface StrokeOptions {
  lineWidth?: number;
  strokeStyle?: string;
  padding?: number;
}

/**
 * 对透明背景抠图结果加白色描边
 * 使用 ctx.strokeStyle = "white" + ctx.lineWidth = 3
 */
export function addWhiteStroke(
  source: HTMLImageElement,
  options: StrokeOptions = {},
): string {
  const lineWidth = options.lineWidth ?? 3;
  const strokeStyle = options.strokeStyle ?? 'white';
  const padding = options.padding ?? lineWidth + 4;

  const w = source.naturalWidth;
  const h = source.naturalHeight;

  const temp = document.createElement('canvas');
  temp.width = w;
  temp.height = h;
  const tempCtx = temp.getContext('2d');
  if (!tempCtx) throw new Error('Canvas 不可用');

  tempCtx.drawImage(source, 0, 0);
  const imageData = tempCtx.getImageData(0, 0, w, h);
  const contour = buildContourPath(imageData);

  const canvas = document.createElement('canvas');
  canvas.width = w + padding * 2;
  canvas.height = h + padding * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  ctx.save();
  ctx.translate(padding, padding);

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(contour);

  ctx.drawImage(source, 0, 0);
  ctx.restore();

  return canvas.toDataURL('image/png');
}
