import { useMemo, useState } from 'react';
import {
  Search,
  X,
  Armchair,
  BedDouble,
  Table2,
  Refrigerator,
  WashingMachine,
  Tv,
  AirVent,
  CookingPot,
  Bath,
  ShowerHead,
  LampFloor,
  LampDesk,
  Sprout,
  Archive,
  Microwave,
  Sofa,
  type LucideIcon,
} from 'lucide-react';
import type { Item } from '../types';
import { CATALOG_GROUPS, filterCatalog } from '../catalog';
const ICONS: Record<string, LucideIcon> = {
  sofa: Sofa,
  'chaise-sofa': Sofa,
  bed: BedDouble,
  table: Table2,
  'coffee-table': Table2,
  'round-table': Table2,
  refrigerator: Refrigerator,
  'washing-machine': WashingMachine,
  dryer: WashingMachine,
  television: Tv,
  'wall-ac': AirVent,
  'floor-ac': AirVent,
  'air-purifier': AirVent,
  microwave: Microwave,
  oven: CookingPot,
  cooktop: CookingPot,
  'range-hood': CookingPot,
  dishwasher: WashingMachine,
  bathtub: Bath,
  shower: ShowerHead,
  vanity: Bath,
  toilet: Bath,
  'sink-cabinet': Bath,
  'floor-lamp': LampFloor,
  'table-lamp': LampDesk,
  plant: Sprout,
  cabinet: Archive,
  wardrobe: Archive,
  'shoe-cabinet': Archive,
  chest: Archive,
  bookshelf: Archive,
  'kitchen-cabinet': Archive,
};
export default function ItemLibrary({
  items,
  roomName,
  loading,
  error,
  onRetry,
  onAdd,
}: {
  items: Item[];
  roomName: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onAdd: (item: Item) => void;
}) {
  const [query, setQuery] = useState(''),
    [group, setGroup] = useState('all');
  const visible = useMemo(() => filterCatalog(items, group, query), [items, group, query]);
  return (
    <div className="catalog-library">
      <div className="panel-heading section-separator">
        <h3>家具与家电</h3>
        <span className="catalog-total">{items.length} 款</span>
      </div>
      <p className="panel-helper">点击添加到「{roomName}」</p>
      <div className="catalog-search">
        <Search size={13} />
        <input
          aria-label="搜索家具与家电"
          placeholder="搜索冰箱、沙发、台灯…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button aria-label="清空目录搜索" onClick={() => setQuery('')}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="catalog-groups" role="group" aria-label="家具家电分类">
        {[['all', '全部'], ...CATALOG_GROUPS].map(([value, label]) => (
          <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>
            {label}
            <span>
              {value === 'all' ? items.length : items.filter((i) => i.group === value).length}
            </span>
          </button>
        ))}
      </div>
      <div className="catalog-summary" role="status">
        {loading ? '正在加载目录…' : `找到 ${visible.length} 款 · 尺寸 mm，可修改`}
      </div>
      {error ? (
        <div className="catalog-empty">
          目录暂未加载成功。<button onClick={onRetry}>重新加载</button>
        </div>
      ) : (
        <div className="furniture-library">
          {visible.map((item) => {
            const Icon = ICONS[item.modelKind || item.category] || Armchair;
            return (
              <button
                key={item.id}
                aria-label={`添加${item.name}`}
                title={`${item.name} · ${item.sizeMm.join(' × ')} mm${item.baseZMm ? ` · 默认离地 ${item.baseZMm} mm` : ''}`}
                onClick={() => onAdd(item)}
              >
                <span className={`furniture-symbol ${item.group || ''}`}>
                  <Icon size={27} strokeWidth={1.15} />
                </span>
                <strong>{item.name}</strong>
                <small>{item.sizeMm.join(' × ')}</small>
                <span className="catalog-card-meta">
                  {item.placement === 'wall'
                    ? '壁挂'
                    : item.placement === 'surface'
                      ? '台面'
                      : '落地'}
                  <span>待询价</span>
                </span>
                <span className="add-item">+</span>
              </button>
            );
          })}
        </div>
      )}
      {!loading && !error && !visible.length && (
        <div className="catalog-empty">
          没有匹配的物品。
          <button
            onClick={() => {
              setQuery('');
              setGroup('all');
            }}
          >
            查看全部
          </button>
        </div>
      )}
      <p className="catalog-note">
        通用参考尺寸，非品牌商品。壁挂与台面物品可在属性中调整离地高度 Z。
      </p>
    </div>
  );
}
