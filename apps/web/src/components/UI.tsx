import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, CheckCircle2, TriangleAlert, House } from 'lucide-react';
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-icon">
        <House size={small ? 18 : 23} strokeWidth={1.4} />
      </span>
      <span>
        筑见<small>ZHÙ JIÀN</small>
      </span>
    </span>
  );
}
export function Spinner({ label = '正在载入…' }: { label?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark">↗</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>('input,button,select,textarea');
    first?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href]',
        );
        if (!nodes?.length) return;
        const a = nodes[0],
          b = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Toast({
  message,
  error,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div className={'toast ' + (error ? 'error' : '')} role="status">
      {error ? <TriangleAlert size={19} /> : <CheckCircle2 size={19} />}
      <span>{message}</span>
      <button aria-label="关闭通知" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
export function Money({ value }: { value: number | null | undefined }) {
  return (
    <>
      {value == null
        ? '待询价'
        : '¥ ' +
          (value / 100).toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
    </>
  );
}
