import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import type { Vec3 } from '../../types';

/** One DOM label projected from the model, without creating a nested React root. */
export default function ProjectedLabel({
  position,
  name,
  size,
}: {
  position: Vec3;
  name: string;
  size: string;
}) {
  const anchor = useRef<Group>(null);
  const label = useRef<HTMLDivElement | null>(null);
  const point = useMemo(() => new Vector3(), []);
  const { gl, camera, invalidate } = useThree();
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const element = document.createElement('div');
    element.className = 'model-dimension';
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      zIndex: '15',
      visibility: 'hidden',
    });
    const title = document.createElement('strong');
    title.textContent = name;
    const dimensions = document.createElement('span');
    dimensions.textContent = size;
    element.append(title, dimensions);
    parent.appendChild(element);
    label.current = element;
    invalidate();
    return () => {
      element.remove();
      label.current = null;
    };
  }, [gl, name, size, invalidate]);
  useFrame(() => {
    if (!anchor.current || !label.current) return;
    anchor.current.getWorldPosition(point);
    point.project(camera);
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1;
    label.current.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) return;
    const x = (point.x * 0.5 + 0.5) * gl.domElement.clientWidth;
    const y = (-point.y * 0.5 + 0.5) * gl.domElement.clientHeight;
    label.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  });
  return <group ref={anchor} position={position} />;
}
