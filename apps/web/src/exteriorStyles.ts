export const EXTERIOR_STYLES = [
  {
    id: 'modern',
    name: '现代平顶 · 石材',
    roof: 'flat',
    wall: '#eeeae2',
    lower: '#a9a89e',
    accent: '#454b48',
    roofColor: '#7b8078',
    frame: '#414c4d',
    overhang: 0.32,
    rise: 0,
    description: '平屋顶、女儿墙、石材基座与悬挑门廊',
  },
  {
    id: 'nordic',
    name: '北欧双坡 · 木饰面',
    roof: 'gable',
    wall: '#eeeae0',
    lower: '#ac8055',
    accent: '#3c4845',
    roofColor: '#414d4d',
    frame: '#424a46',
    overhang: 0.5,
    rise: 2.1,
    description: '双坡金属屋面、木饰面与深色窗框',
  },
  {
    id: 'mediterranean',
    name: '地中海四坡 · 陶瓦',
    roof: 'hip',
    wall: '#f1e2c9',
    lower: '#c5b08e',
    accent: '#b4a081',
    roofColor: '#b16b4e',
    frame: '#716451',
    overhang: 0.55,
    rise: 1.7,
    description: '四坡陶瓦屋面、暖色灰泥与浅石材立面',
  },
  {
    id: 'chinese',
    name: '新中式四坡 · 深檐',
    roof: 'hip',
    wall: '#e8e5d9',
    lower: '#8d9288',
    accent: '#3c4640',
    roofColor: '#4e5751',
    frame: '#41483f',
    overhang: 0.8,
    rise: 1.4,
    description: '四坡深檐、叠层檐口与深色横向线条',
  },
] as const;
export type ExteriorStyleId = (typeof EXTERIOR_STYLES)[number]['id'];
export type ExteriorStyle = (typeof EXTERIOR_STYLES)[number];
export function exteriorStyle(id?: string) {
  return EXTERIOR_STYLES.find((p) => p.id === id) || EXTERIOR_STYLES[0];
}
