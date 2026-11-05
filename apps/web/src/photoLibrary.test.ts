import { describe, expect, it } from 'vitest';
import fixture from '../../../packages/scene/scene.example.json';
import type { Asset, Scene } from './types';
import {
  PHOTO_DIRECTIONS,
  directionLabel,
  filterPhotos,
  photoKind,
  photoKindLabel,
  photoNote,
  photoPosition,
  photoSummary,
  roomName,
  sourceAsset,
} from './photoLibrary';

const scene = () => structuredClone(fixture) as unknown as Scene;
const photo = (id: string, roomId: string | null, metadata: Record<string, unknown> = {}) =>
  ({
    id,
    name: id + '.jpg',
    kind: 'photo',
    mediaType: 'image/jpeg',
    bytes: 1024,
    roomId,
    url: '/api/assets/' + id + '/content',
    metadata,
  }) as Asset;

describe('photo library organisation', () => {
  it('labels known directions and marks missing or unknown values', () => {
    expect(PHOTO_DIRECTIONS).toHaveLength(8);
    expect(directionLabel('southwest')).toBe('朝西南');
    expect(directionLabel(undefined)).toBe('未标注方向');
    expect(directionLabel('upwards')).toBe('未标注方向');
  });

  it('reads trimmed position and note without inventing values', () => {
    expect(photoPosition(photo('a', null, { capturePosition: ' 窗边 ' }))).toBe('窗边');
    expect(photoPosition(photo('b', null))).toBe('');
    expect(photoNote(photo('c', null, { note: 42 }))).toBe('');
  });

  it('describes a photo by room, direction and position while omitting direction for generated images', () => {
    const s = scene();
    const room = s.floors[0].rooms[0];
    expect(photoSummary(photo('a', room.id, { direction: 'north' }), s)).toBe(
      room.name + ' · 朝北 · 未记录拍摄位置',
    );
    const generated = { ...photo('b', room.id), kind: 'generated' };
    expect(photoSummary(generated, s)).toBe(room.name);
    expect(roomName(s, 'gone')).toBe('已移除的房间');
  });

  it('filters by room and direction without mutating input order', () => {
    const s = scene();
    const [first, second] = s.floors[0].rooms;
    const rows = [
      photo('a', first.id, { direction: 'north' }),
      photo('b', first.id, { direction: 'south' }),
      photo('c', second.id, { direction: 'north' }),
    ];
    expect(filterPhotos(rows, { roomId: first.id }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterPhotos(rows, { direction: 'north' }).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filterPhotos(rows, { roomId: second.id, direction: 'north' }).map((p) => p.id)).toEqual([
      'c',
    ]);
    expect(filterPhotos(rows, {}).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('distinguishes photos, style renders and local edits and finds their source', () => {
    const room = scene().floors[0].rooms[0];
    const source = photo('source', room.id);
    const style = { ...photo('style', room.id), kind: 'generated', metadata: { referenceAssetIds: ['source'] } };
    const edit = { ...photo('edit', room.id), kind: 'generated', metadata: { maskAssetId: 'mask-1', sourceAssetId: 'style' } };
    expect(photoKind(source)).toBe('photo');
    expect(photoKind(style)).toBe('style');
    expect(photoKind(edit)).toBe('inpaint');
    expect(photoKindLabel(edit)).toBe('局部改图');
    expect(sourceAsset(style as Asset, [source])?.id).toBe('source');
    expect(sourceAsset(edit as Asset, [source, style as Asset])?.id).toBe('style');
    expect(
      filterPhotos([source, style as Asset, edit as Asset], { kind: 'inpaint' }).map((a) => a.id),
    ).toEqual(['edit']);
  });
});
