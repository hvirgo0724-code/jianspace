import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Brush, Eraser, Trash2, Undo2 } from 'lucide-react';
import type { Asset } from '../types';
import {
  coverageIssue,
  coverageRatio,
  formatCoverage,
  pointerToPixel,
} from '../maskMath';
import { Modal } from './UI';

export type MaskSubmission = {
  assetId: string;
  maskDataUrl: string;
  instruction: string;
};

type Point = { x: number; y: number };
type Command = { points: Point[]; tool: 'brush' | 'erase'; size: number };

export default function MaskEditor({
  asset,
  cost,
  aiEnabled,
  onClose,
  onSubmit,
}: {
  asset: Asset;
  cost: number;
  aiEnabled: boolean;
  onClose: () => void;
  onSubmit: (payload: MaskSubmission) => Promise<void>;
}) {
  const imageRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const active = useRef<Command | null>(null);
  const commands = useRef<Command[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tool, setTool] = useState<'brush' | 'erase'>('brush');
  const [brushSize, setBrushSize] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [coverage, setCoverage] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const target = imageRef.current;
      const mask = maskRef.current;
      if (!target || !mask || !width || !height) {
        setLoadError('底图尺寸无效，请关闭后重试。');
        return;
      }
      target.width = width;
      target.height = height;
      mask.width = width;
      mask.height = height;
      target.getContext('2d')?.drawImage(image, 0, 0, width, height);
      mask.getContext('2d')?.clearRect(0, 0, width, height);
      commands.current = [];
      setCanUndo(false);
      setCoverage(0);
      setReady(true);
    };
    image.onerror = () => {
      if (!cancelled) setLoadError('底图载入失败，请关闭后重试。');
    };
    image.src = asset.url;
    return () => {
      cancelled = true;
    };
  }, [asset.url]);

  function measureCoverage() {
    const mask = maskRef.current;
    if (!mask) return 0;
    const pixels = mask.getContext('2d')?.getImageData(0, 0, mask.width, mask.height).data;
    if (!pixels) return 0;
    let white = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] >= 128) white += 1;
    return coverageRatio(white, mask.width * mask.height);
  }

  function strokeSegment(previous: Point | null, point: Point, command: Command) {
    const ctx = maskRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation =
      command.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = command.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (previous) {
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, command.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function replay() {
    const mask = maskRef.current;
    const ctx = mask?.getContext('2d');
    if (!mask || !ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, mask.width, mask.height);
    for (const command of commands.current)
      command.points.forEach((point, index) =>
        strokeSegment(index ? command.points[index - 1] : null, point, command),
      );
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const target = event.currentTarget;
    const mask = maskRef.current;
    if (!mask) return;
    const point = pointerToPixel(
      event.clientX,
      event.clientY,
      target.getBoundingClientRect(),
      mask.width,
      mask.height,
    );
    if (!point) return;
    event.preventDefault();
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers and some touch browsers cannot capture; drawing still works.
    }
    drawing.current = true;
    last.current = null;
    active.current = { points: [point], tool, size: brushSize };
    strokeSegment(null, point, active.current);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !active.current) return;
    const mask = maskRef.current;
    if (!mask) return;
    const point = pointerToPixel(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      mask.width,
      mask.height,
    );
    if (!point) return;
    const previous = last.current;
    active.current.points.push(point);
    strokeSegment(previous, point, active.current);
    last.current = point;
  }

  function end() {
    if (!drawing.current) return;
    if (active.current) {
      commands.current.push(active.current);
      setCanUndo(true);
    }
    active.current = null;
    drawing.current = false;
    last.current = null;
    setCoverage(measureCoverage());
  }

  function clear() {
    commands.current = [];
    const mask = maskRef.current;
    if (mask) mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
    setCanUndo(false);
    setCoverage(0);
  }

  function undo() {
    if (!commands.current.length) return;
    commands.current.pop();
    replay();
    setCanUndo(commands.current.length > 0);
    setCoverage(measureCoverage());
  }

  function exportMask() {
    const mask = maskRef.current;
    if (!mask) return '';
    const flat = document.createElement('canvas');
    flat.width = mask.width;
    flat.height = mask.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(mask, 0, 0);
    return flat.toDataURL('image/png');
  }

  const issue = coverageIssue(coverage);
  const disabled =
    !aiEnabled || !ready || busy || !!issue || instruction.trim().length < 2;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        assetId: asset.id,
        maskDataUrl: exportMask(),
        instruction: instruction.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="带蒙版局部改图" onClose={onClose} wide>
      <p className="muted">
        在底图上涂抹允许修改的区域，模型只重绘涂抹部分；未涂抹的像素由服务端锁定为原图。
      </p>
      {!aiEnabled && (
        <div className="inline-note warning" role="status">
          <p>AI 服务未启用：可以先在本地准备蒙版，但暂时不能提交任务。</p>
        </div>
      )}
      {loadError && <p role="alert">{loadError}</p>}
      <div className="mask-viewport">
        <div
          className="mask-stage"
          style={{
            width: `${zoom * 100}%`,
            aspectRatio: ready
              ? `${maskRef.current?.width} / ${maskRef.current?.height}`
              : '4 / 3',
          }}
        >
          <canvas ref={imageRef} className="mask-image" aria-label="局部改图底图" />
          <canvas
            ref={maskRef}
            className="mask-ink"
            role="application"
            aria-label="蒙版涂抹区域"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {!ready && !loadError && <div className="mask-loading">正在载入底图…</div>}
        </div>
      </div>
      <div className="mask-tools">
        <div className="segmented" role="group" aria-label="蒙版工具">
          <button
            type="button"
            aria-pressed={tool === 'brush'}
            className={tool === 'brush' ? 'active' : ''}
            onClick={() => setTool('brush')}
          >
            <Brush size={14} />
            画笔
          </button>
          <button
            type="button"
            aria-pressed={tool === 'erase'}
            className={tool === 'erase' ? 'active' : ''}
            onClick={() => setTool('erase')}
          >
            <Eraser size={14} />
            擦除
          </button>
        </div>
        <button
          type="button"
          className="button ghost compact"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={14} />
          撤销
        </button>
        <label className="mask-size">
          笔刷
          <input
            type="range"
            min={8}
            max={200}
            step={2}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <span>{brushSize}px</span>
        </label>
        <label className="mask-size">
          缩放
          <input
            type="range"
            min={1}
            max={3}
            step={0.25}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span>{zoom.toFixed(2)}×</span>
        </label>
        <button type="button" className="button ghost compact" onClick={clear}>
          <Trash2 size={14} />
          清除
        </button>
        <span className="mask-coverage">已覆盖 {formatCoverage(coverage)}</span>
      </div>
      <p className={issue ? 'inline-note warning' : 'fine-print'} role={issue ? 'alert' : 'status'}>
        {issue ||
          '建议只涂抹需要替换的家具、墙面或灯具，避免包含门窗边框；蒙版外不会产生任何像素变化。'}
      </p>
      <form onSubmit={submit}>
        <label>
          修改要求
          <textarea
            maxLength={300}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例如：把圈出的沙发换成浅灰布艺，保留地面与窗边光线"
          />
        </label>
        <p className="fine-print">
          本次最多 {cost} 应用积分，成功后结算、失败释放；结果保存为新图片，原图与蒙版均保留。服务商用量另计。
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={disabled}>
            {busy ? '正在提交…' : `提交局部改图 · ${cost} 应用积分`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
