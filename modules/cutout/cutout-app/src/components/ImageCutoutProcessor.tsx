import { useCallback, useRef, useState } from 'react';
import type { CutoutProvider } from '../lib/removeBackground';
import { processImageCutout } from '../lib/removeBackground';
import { resizeImageFile } from '../lib/imageUtils';

type Step = 'idle' | 'processing' | 'done' | 'error';

export function ImageCutoutProcessor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('idle');
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<CutoutProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerChoice, setProviderChoice] = useState<CutoutProvider | 'auto'>('auto');
  const [lineWidth, setLineWidth] = useState(3);

  const processFile = useCallback(async (file: File) => {
    setStep('processing');
    setError(null);
    setResultUrl(null);
    setProvider(null);

    const preview = URL.createObjectURL(file);
    setOriginalUrl(preview);

    try {
      const { blob } = await resizeImageFile(file, 1024);
      const result = await processImageCutout(blob, {
        provider: providerChoice === 'auto' ? undefined : providerChoice,
        lineWidth,
      });
      setResultUrl(result.cutoutUrl);
      setProvider(result.provider);
      setStep('done');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : '处理失败');
    }
  }, [lineWidth, providerChoice]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = '';
  };

  const download = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'plant-sticker.png';
    a.click();
  };

  return (
    <div className="processor">
      <header className="processor__header">
        <h1>植物贴纸抠图</h1>
        <p>BiRefNet / remove.bg 抠图 + Canvas 白描边</p>
      </header>

      <div className="processor__controls">
        <label className="field">
          <span>抠图引擎</span>
          <select
            value={providerChoice}
            onChange={(e) => setProviderChoice(e.target.value as CutoutProvider | 'auto')}
          >
            <option value="auto">自动（BiRefNet 优先）</option>
            <option value="birefnet">BiRefNet (HuggingFace)</option>
            <option value="removebg">remove.bg</option>
          </select>
        </label>
        <label className="field">
          <span>描边宽度 (lineWidth)</span>
          <input
            type="range"
            min={1}
            max={8}
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
          />
          <strong>{lineWidth}px</strong>
        </label>
      </div>

      <div className="processor__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => inputRef.current?.click()}
          disabled={step === 'processing'}
        >
          {step === 'processing' ? '处理中…' : '选择图片'}
        </button>
        {resultUrl && (
          <button type="button" className="btn btn--secondary" onClick={download}>
            下载贴纸
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFileChange}
      />

      {step === 'processing' && (
        <div className="processor__status">
          <div className="spinner" />
          <p>BiRefNet 抠图中，随后添加白色描边…</p>
        </div>
      )}

      {error && <div className="processor__error">{error}</div>}

      <div className="processor__preview">
        <figure>
          <figcaption>原图</figcaption>
          <div className="preview-box preview-box--checkered">
            {originalUrl ? (
              <img src={originalUrl} alt="原图" />
            ) : (
              <span className="placeholder">等待上传</span>
            )}
          </div>
        </figure>
        <figure>
          <figcaption>
            抠图 + 白描边
            {provider && <em> · {provider === 'birefnet' ? 'BiRefNet' : 'remove.bg'}</em>}
          </figcaption>
          <div className="preview-box preview-box--checkered">
            {resultUrl ? (
              <img src={resultUrl} alt="抠图结果" />
            ) : (
              <span className="placeholder">等待处理</span>
            )}
          </div>
        </figure>
      </div>

      <section className="processor__code">
        <h3>描边实现</h3>
        <pre>{`ctx.strokeStyle = "white";
ctx.lineWidth = ${lineWidth};
ctx.lineJoin = "round";
ctx.lineCap = "round";
ctx.stroke(contourPath);
ctx.drawImage(cutoutImage, 0, 0);`}</pre>
      </section>
    </div>
  );
}
