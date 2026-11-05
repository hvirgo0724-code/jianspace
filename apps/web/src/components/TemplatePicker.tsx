import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { HomeTemplate } from '../types';
import { PlanThumbnail } from './Plan2D';
import { Spinner } from './UI';
export default function TemplatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const templates = useQuery({
    queryKey: ['home-templates'],
    queryFn: () => api<{ items: HomeTemplate[] }>('/home-templates'),
  });
  if (templates.isPending) return <Spinner label="正在准备户型模板…" />;
  if (templates.isError)
    return (
      <div className="inline-note">
        户型加载失败。
        <button type="button" onClick={() => void templates.refetch()}>
          重新加载
        </button>
      </div>
    );
  return (
    <fieldset className="template-picker">
      <legend>选择户型起点</legend>
      <div className="template-grid">
        {templates.data.items.map((t) => (
          <label key={t.id} className={'template-card ' + (value === t.id ? 'selected' : '')}>
            <input
              type="radio"
              aria-label={t.name}
              name="template"
              value={t.id}
              checked={value === t.id}
              onChange={() => onChange(t.id)}
            />
            <div className="template-plan">
              <PlanThumbnail scene={t.scenePreview} />
              <span>{t.tag}</span>
            </div>
            <strong>{t.name}</strong>
            <small>
              {t.areaM2.toFixed(2)} m² 室内 · {t.floorCount} 层 · {t.roomCount} 个空间
              {t.outdoorAreaM2 ? ` · 小院 ${t.outdoorAreaM2.toFixed(1)} m²` : ''}
            </small>
            <p>{t.description}</p>
          </label>
        ))}
      </div>
      <p className="fine-print">
        面积为各层室内净面积之和，未计墙体与挑空；示例尺寸需替换为实测值。
      </p>
    </fieldset>
  );
}
