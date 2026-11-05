import type { Item } from './types';

export const CATALOG_GROUPS = [
  ['living', '客厅'],
  ['bedroom', '卧室'],
  ['dining', '餐厨'],
  ['study', '书房'],
  ['storage', '收纳'],
  ['appliances', '家电'],
  ['bathroom', '卫浴'],
  ['decor', '灯饰绿植'],
] as const;
export const MODEL_KINDS = [
  'sofa',
  'bed',
  'coffee-table',
  'table',
  'chair',
  'wardrobe',
  'cabinet',
  'bookshelf',
  'chaise-sofa',
  'ottoman',
  'bench',
  'round-table',
  'dining-chair',
  'bar-stool',
  'dressing-table',
  'chest',
  'shoe-cabinet',
  'kitchen-cabinet',
  'sink-cabinet',
  'vanity',
  'toilet',
  'bathtub',
  'shower',
  'refrigerator',
  'washing-machine',
  'dryer',
  'dishwasher',
  'oven',
  'microwave',
  'range-hood',
  'cooktop',
  'wall-ac',
  'floor-ac',
  'television',
  'air-purifier',
  'floor-lamp',
  'table-lamp',
  'plant',
] as const;
export type FurnitureKind = (typeof MODEL_KINDS)[number];
export function filterCatalog(items: Item[], group: string, query: string) {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (group === 'all' || item.group === group) &&
      words.every((word) =>
        [item.name, item.category, item.modelKind || '', ...(item.keywords || [])]
          .join(' ')
          .normalize('NFKC')
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
}
