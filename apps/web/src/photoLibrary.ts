import type { Asset, Scene } from './types';

export const PHOTO_DIRECTIONS: { code: string; label: string }[] = [
  { code: 'north', label: '朝北' },
  { code: 'northeast', label: '朝东北' },
  { code: 'east', label: '朝东' },
  { code: 'southeast', label: '朝东南' },
  { code: 'south', label: '朝南' },
  { code: 'southwest', label: '朝西南' },
  { code: 'west', label: '朝西' },
  { code: 'northwest', label: '朝西北' },
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function directionLabel(code: unknown): string {
  return PHOTO_DIRECTIONS.find((d) => d.code === code)?.label ?? '未标注方向';
}

export function photoPosition(asset: Asset): string {
  return text(asset.metadata.capturePosition);
}

export function photoNote(asset: Asset): string {
  return text(asset.metadata.note);
}

export function roomName(scene: Scene, roomId: string | null): string {
  if (!roomId) return '未关联房间';
  for (const floor of scene.floors)
    for (const room of floor.rooms)
      if (room.id === roomId)
        return scene.floors.length > 1 ? floor.name + ' / ' + room.name : room.name;
  return '已移除的房间';
}

export function photoSummary(asset: Asset, scene: Scene): string {
  const parts = [roomName(scene, asset.roomId)];
  if (asset.kind === 'photo') {
    parts.push(directionLabel(asset.metadata.direction));
    parts.push(photoPosition(asset) || '未记录拍摄位置');
  }
  return parts.join(' · ');
}

export type PhotoKind = 'photo' | 'style' | 'inpaint';

export function photoKind(asset: Asset): PhotoKind {
  if (asset.kind === 'photo') return 'photo';
  return typeof asset.metadata.maskAssetId === 'string' ? 'inpaint' : 'style';
}

export function photoKindLabel(asset: Asset): string {
  return { photo: '房间照片', style: 'AI 效果图', inpaint: '局部改图' }[photoKind(asset)];
}

export function sourceAsset(asset: Asset, assets: Asset[]): Asset | null {
  const direct =
    typeof asset.metadata.sourceAssetId === 'string'
      ? asset.metadata.sourceAssetId
      : Array.isArray(asset.metadata.referenceAssetIds)
        ? asset.metadata.referenceAssetIds.find((id) => typeof id === 'string')
        : undefined;
  return assets.find((candidate) => candidate.id === direct) ?? null;
}

export function filterPhotos(
  photos: Asset[],
  filters: { roomId?: string; direction?: string; kind?: PhotoKind | '' },
): Asset[] {
  return photos.filter((a) => {
    if (filters.roomId && a.roomId !== filters.roomId) return false;
    if (filters.direction && a.metadata.direction !== filters.direction) return false;
    if (filters.kind && photoKind(a) !== filters.kind) return false;
    return true;
  });
}
