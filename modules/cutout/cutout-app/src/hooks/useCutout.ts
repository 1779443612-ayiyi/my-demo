import { useCallback, useState } from 'react';
import type { CutoutProvider, CutoutResult } from '../lib/removeBackground';
import { processImageCutout } from '../lib/removeBackground';
import { resizeImageFile } from '../lib/imageUtils';

interface UseCutoutOptions {
  provider?: CutoutProvider;
  lineWidth?: number;
  maxSide?: number;
}

export function useCutout(options: UseCutoutOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CutoutResult | null>(null);

  const process = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { blob } = await resizeImageFile(file, options.maxSide ?? 1024);
      const cutout = await processImageCutout(blob, {
        provider: options.provider,
        lineWidth: options.lineWidth ?? 3,
      });
      setResult(cutout);
      return cutout;
    } catch (err) {
      const message = err instanceof Error ? err.message : '抠图失败';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [options.lineWidth, options.maxSide, options.provider]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return { loading, error, result, process, reset };
}
