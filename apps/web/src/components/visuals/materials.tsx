import { useMemo, useEffect } from 'react';
import { useTexture } from '@react-three/drei';
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  Color,
  Vector2,
  DoubleSide,
} from 'three';

/** A tiny deterministic weave normal, generated locally rather than fetched at runtime. */
function weave() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(128, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      pixels.data[i] = 128 + Math.round(Math.sin((x * Math.PI) / 2) * 14);
      pixels.data[i + 1] = 128 + Math.round(Math.sin((y * Math.PI) / 2) * 14);
      pixels.data[i + 2] = 254;
      pixels.data[i + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(32, 32);
  texture.anisotropy = 4;
  return texture;
}
export function usePalette(accent: string) {
  const normal = useMemo(weave, []);
  const originalWood = useTexture('/visuals/textures/wood-color.jpg');
  const woodMap = useMemo(() => {
    const map = originalWood.clone();
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(0.09, 0.75);
    map.offset.set(0.018, 0.08);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return map;
  }, [originalWood]);
  const palette = useMemo(
    () => ({
      fabric: new MeshPhysicalMaterial({
        color: accent,
        roughness: 0.88,
        normalMap: normal,
        normalScale: new Vector2(0.17, 0.17),
        sheen: 1,
        sheenColor: new Color(accent).lerp(new Color('#fff9e7'), 0.45),
        sheenRoughness: 0.72,
      }),
      linen: new MeshPhysicalMaterial({
        color: '#e7e2d8',
        roughness: 0.93,
        normalMap: normal,
        normalScale: new Vector2(0.15, 0.15),
        sheen: 0.55,
        sheenColor: new Color('#fff9eb'),
        sheenRoughness: 0.9,
      }),
      pillow: new MeshPhysicalMaterial({
        color: '#f7f1e5',
        roughness: 0.97,
        normalMap: normal,
        normalScale: new Vector2(0.12, 0.12),
        sheen: 0.6,
      }),
      wood: new MeshStandardMaterial({
        color: '#efe8dc',
        map: woodMap,
        roughness: 0.4,
        metalness: 0,
      }),
      woodDark: new MeshStandardMaterial({ color: '#786953', map: woodMap, roughness: 0.5 }),
      metal: new MeshStandardMaterial({ color: '#7e7768', roughness: 0.28, metalness: 0.85 }),
      black: new MeshStandardMaterial({ color: '#333632', roughness: 0.5, metalness: 0.3 }),
      enamel: new MeshPhysicalMaterial({
        color: '#e8ece9',
        roughness: 0.28,
        metalness: 0.08,
        clearcoat: 0.4,
      }),
      steel: new MeshStandardMaterial({ color: '#a9b6b4', roughness: 0.28, metalness: 0.8 }),
      rubber: new MeshStandardMaterial({ color: '#25312f', roughness: 0.85 }),
      screen: new MeshPhysicalMaterial({
        color: '#162d35',
        roughness: 0.12,
        metalness: 0.18,
        clearcoat: 1,
        emissive: '#23404b',
        emissiveIntensity: 0.07,
      }),
      glass: new MeshPhysicalMaterial({
        color: '#badbd6',
        roughness: 0.1,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: DoubleSide,
      }),
      ceramic: new MeshPhysicalMaterial({ color: '#f8f4eb', roughness: 0.17, clearcoat: 0.9 }),
      leaf: new MeshStandardMaterial({ color: '#567748', roughness: 0.76, side: DoubleSide }),
      glow: new MeshStandardMaterial({
        color: '#fff0ce',
        emissive: '#ffe7ab',
        emissiveIntensity: 0.8,
        roughness: 0.6,
      }),
    }),
    [accent, normal, woodMap],
  );
  useEffect(
    () => () => {
      Object.values(palette).forEach((m) => m.dispose());
    },
    [palette],
  );
  useEffect(() => () => normal.dispose(), [normal]);
  useEffect(() => () => woodMap.dispose(), [woodMap]);
  return palette;
}
export type Palette = ReturnType<typeof usePalette>;
export function useFloorTextures() {
  const originals = useTexture([
    '/visuals/textures/wood-color.jpg',
    '/visuals/textures/wood-normal.jpg',
    '/visuals/textures/wood-arm.jpg',
  ]);
  const maps = useMemo(
    () =>
      originals.map((original, i) => {
        const texture = original.clone();
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.set(1 / 1.7, 1 / 1.7);
        texture.anisotropy = 8;
        if (i === 0) texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      }),
    [...originals],
  );
  useEffect(() => () => maps.forEach((t) => t.dispose()), [maps]);
  return { map: maps[0], normalMap: maps[1], roughnessMap: maps[2], aoMap: maps[2] };
}
