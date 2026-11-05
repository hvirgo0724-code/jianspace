import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Scene, HomeTemplate } from '../types';
import TemplatePicker from './TemplatePicker';
export default function TemplateReset({
  scene,
  onApply,
}: {
  scene: Scene;
  onApply: (scene: Scene) => void;
}) {
  const [selected, setSelected] = useState('three-bedroom'),
    [ack, setAck] = useState(false);
  const templates = useQuery({
    queryKey: ['home-templates'],
    queryFn: () => api<{ items: HomeTemplate[] }>('/home-templates'),
  });
  return (
    <>
      <p className="muted">
        选择重新整理的户型框架。房间、门窗和参考家具将替换当前草稿；已保存设计版本保留，本次替换可撤销。所有模板均为虚构尺寸，需要重新量房确认。
      </p>
      <TemplatePicker value={selected} onChange={setSelected} />
      <label className="floorplan-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        我已了解这会替换当前草稿的结构和家具。
      </label>
      <button
        className="button primary full"
        disabled={!ack || !templates.data}
        onClick={() => {
          const template = templates.data?.items.find((t) => t.id === selected);
          if (!template) return;
          const next = structuredClone(template.scenePreview);
          next.sceneId = scene.sceneId;
          next.geometryVersionId = scene.geometryVersionId;
          next.confirmation = {
            status: 'draft',
            measurementRevision: scene.confirmation.measurementRevision + 1,
          };
          onApply(next);
        }}
      >
        应用新户型框架
      </button>
    </>
  );
}
