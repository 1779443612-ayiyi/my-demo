import { blobToDataUrl, loadImage } from './imageUtils';

export type CutoutProvider = 'birefnet' | 'removebg';

export interface CutoutResult {
  cutoutUrl: string;
  provider: CutoutProvider;
  width: number;
  height: number;
}

const BIREFNET_MODEL = 'ZhengPeng7/BiRefNet';
const HF_API = `https://api-inference.huggingface.co/models/${BIREFNET_MODEL}`;
const REMOVEBG_API = 'https://api.remove.bg/v1.0/removebg';

async function hfRequest(imageBlob: Blob, token: string): Promise<Blob> {
  const response = await fetch(HF_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': imageBlob.type || 'image/jpeg',
    },
    body: imageBlob,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`BiRefNet 请求失败 (${response.status}): ${errText.slice(0, 200)}`);
  }

  return response.blob();
}

async function removeBgRequest(imageBlob: Blob, apiKey: string): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', imageBlob, 'photo.jpg');
  form.append('size', 'auto');
  form.append('format', 'png');

  const response = await fetch(REMOVEBG_API, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`remove.bg 请求失败 (${response.status}): ${errText.slice(0, 200)}`);
  }

  return response.blob();
}

/** 将 BiRefNet 灰度 mask 应用到原图 alpha 通道 */
async function applyMaskToOriginal(
  originalBlob: Blob,
  maskBlob: Blob,
): Promise<HTMLImageElement> {
  const [originalUrl, maskUrl] = await Promise.all([
    blobToDataUrl(originalBlob),
    blobToDataUrl(maskBlob),
  ]);

  const [original, mask] = await Promise.all([loadImage(originalUrl), loadImage(maskUrl)]);

  const canvas = document.createElement('canvas');
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  ctx.drawImage(original, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = canvas.width;
  maskCanvas.height = canvas.height;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('Canvas 不可用');

  maskCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const maskAlpha = maskData.data[i];
    imageData.data[i + 3] = maskAlpha;
  }

  ctx.putImageData(imageData, 0, 0);
  return loadImage(canvas.toDataURL('image/png'));
}

async function cutoutWithBiRefNet(imageBlob: Blob, token: string): Promise<HTMLImageElement> {
  const maskOrCutout = await hfRequest(imageBlob, token);

  if (maskOrCutout.type === 'image/png') {
    const url = await blobToDataUrl(maskOrCutout);
    const img = await loadImage(url);
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth;
    probe.height = img.naturalHeight;
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(img, 0, 0);
    const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
    let hasColor = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== px[i + 1] || px[i + 1] !== px[i + 2]) {
        hasColor = true;
        break;
      }
    }
    if (hasColor && px[3] < 250) return img;
  }

  return applyMaskToOriginal(imageBlob, maskOrCutout);
}

async function cutoutWithRemoveBg(imageBlob: Blob, apiKey: string): Promise<HTMLImageElement> {
  const pngBlob = await removeBgRequest(imageBlob, apiKey);
  const url = await blobToDataUrl(pngBlob);
  return loadImage(url);
}

export interface RemoveBackgroundOptions {
  provider?: CutoutProvider;
  hfToken?: string;
  removeBgKey?: string;
}

export async function removeBackground(
  imageBlob: Blob,
  options: RemoveBackgroundOptions = {},
): Promise<{ image: HTMLImageElement; provider: CutoutProvider }> {
  const hfToken = options.hfToken ?? import.meta.env.VITE_HF_TOKEN;
  const removeBgKey = options.removeBgKey ?? import.meta.env.VITE_REMOVEBG_API_KEY;
  const preferred = options.provider ?? (hfToken ? 'birefnet' : 'removebg');

  if (preferred === 'birefnet') {
    if (!hfToken) throw new Error('请配置 VITE_HF_TOKEN 以使用 BiRefNet');
    try {
      const image = await cutoutWithBiRefNet(imageBlob, hfToken);
      return { image, provider: 'birefnet' };
    } catch (error) {
      if (!removeBgKey) throw error;
      console.warn('BiRefNet 失败，回退到 remove.bg', error);
      const image = await cutoutWithRemoveBg(imageBlob, removeBgKey);
      return { image, provider: 'removebg' };
    }
  }

  if (!removeBgKey) throw new Error('请配置 VITE_REMOVEBG_API_KEY 以使用 remove.bg');
  const image = await cutoutWithRemoveBg(imageBlob, removeBgKey);
  return { image, provider: 'removebg' };
}

export async function processImageCutout(
  imageBlob: Blob,
  options: RemoveBackgroundOptions & { lineWidth?: number } = {},
): Promise<CutoutResult> {
  const { image, provider } = await removeBackground(imageBlob, options);

  const { addWhiteStroke } = await import('./addWhiteStroke');
  const cutoutUrl = addWhiteStroke(image, { lineWidth: options.lineWidth ?? 3 });

  return {
    cutoutUrl,
    provider,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}
