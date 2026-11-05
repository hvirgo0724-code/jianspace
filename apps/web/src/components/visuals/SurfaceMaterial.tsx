import { useMemo, useEffect } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three';
import { floorFinish } from '../../surfaces';
import type { useFloorTextures } from './materials';

function procedural(kind: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d')!;
  let seed = 2813;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  c.fillStyle = '#ddd9cf';
  c.fillRect(0, 0, 512, 512);
  const pixels = c.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      const noise = (random() - 0.5) * (kind === 'grass' ? 64 : kind === 'concrete' ? 16 : 6);
      const wave =
        kind === 'marble'
          ? Math.pow(
              Math.abs(
                Math.sin(
                  x * 0.012 +
                    y * 0.004 +
                    Math.sin(y * 0.006) * 2 +
                    Math.sin(x * 0.035 + y * 0.009) * 0.3,
                ),
              ),
              28,
            ) * -28
          : 0;
      const i = (y * 512 + x) * 4;
      for (let k = 0; k < 3; k++)
        pixels.data[i + k] = Math.max(0, Math.min(255, 242 + noise + wave));
      pixels.data[i + 3] = 255;
    }
  c.putImageData(pixels, 0, 0);
  if (['tile', 'paving'].includes(kind)) {
    c.strokeStyle = kind === 'paving' ? '#8a887f' : '#b5b2a8';
    c.lineWidth = 3;
    for (let i = 0; i <= 512; i += 256) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, 512);
      c.stroke();
      c.beginPath();
      c.moveTo(0, i);
      c.lineTo(512, i);
      c.stroke();
    }
  }
  if (kind === 'terrazzo')
    for (let i = 0; i < 1700; i++) {
      c.fillStyle = ['#9d9b91', '#f5f0e3', '#bcb09b', '#8e9490'][i % 4];
      c.beginPath();
      c.ellipse(
        random() * 512,
        random() * 512,
        random() * 3 + 1,
        random() * 2 + 1,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
  if (kind === 'grass')
    for (let i = 0; i < 7500; i++) {
      const x = random() * 512,
        y = random() * 512;
      c.strokeStyle = i % 2 ? '#7a8d57' : '#c0c99a';
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + random() * 5 - 2, y - 3 - random() * 5);
      c.stroke();
    }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  const metres = kind === 'marble' ? 3.5 : 1.2;
  texture.repeat.set(1 / metres, 1 / metres);
  texture.anisotropy = 8;
  return texture;
}
export default function SurfaceMaterial({
  id,
  roomType,
  wood,
}: {
  id?: string;
  roomType: string;
  wood: ReturnType<typeof useFloorTextures>;
}) {
  const finish = floorFinish(id, roomType);
  const map = useMemo(() => procedural(finish.kind), [finish.kind]);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <meshPhysicalMaterial
      key={finish.kind}
      {...(finish.kind === 'wood'
        ? wood
        : { map, normalMap: null, roughnessMap: null, aoMap: null })}
      color={finish.color}
      normalScale={new Vector2(0.2, 0.2)}
      roughness={finish.kind === 'marble' ? 0.26 : finish.kind === 'grass' ? 0.95 : 0.68}
      metalness={0}
      clearcoat={finish.kind === 'marble' ? 0.28 : finish.kind === 'wood' ? 0.1 : 0}
      clearcoatRoughness={finish.kind === 'marble' ? 0.22 : 0.5}
    />
  );
}
