import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, PerspectiveCamera } from 'three';
import type { Scene, Room, Vec2 } from '../../types';
import { roomCamera } from './sceneMath';
import { findWalkSpawn, roomAt, walkDelta, WALK_SPEED } from './walkMath';
import { moveWalker, canStandMulti, type MultiWorld, type Walker } from './multiWalk';
import { floorScene } from '../../scene';

export type WalkInput = { forward: number; strafe: number; step: Vec2 | null; turn: number };
export type WalkLocation = {
  point: Vec2;
  yaw: number;
  roomId: string | null;
  roomName: string;
  distance: number;
  blocked: boolean;
  available: boolean;
  floorId: string;
  floorName: string;
  elevation: number;
  stairId?: string;
};
const MOVEMENT = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const inputTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName));

export default function WalkControls({
  scene,
  world,
  room,
  active,
  reset,
  input,
  wake,
  onLocation,
  onPause,
  entry,
}: {
  scene: Scene;
  world: MultiWorld;
  room: Room;
  active: boolean;
  reset: number;
  input: RefObject<WalkInput>;
  onLocation: (value: WalkLocation) => void;
  onPause: () => void;
  wake: RefObject<() => void>;
  entry?: { point: Vec2; floorId: string; yaw: number } | null;
}) {
  const { camera, gl, invalidate } = useThree();
  wake.current = invalidate;
  const position = useRef<Vec2>([0, 0]);
  const body = useRef<Walker>({ point: [0, 0], elevation: 0, floorId: scene.floors[0].id });
  const rotation = useRef(new Euler(0, 0, 0, 'YXZ'));
  const held = useRef(new Set<string>());
  const ready = useRef(false),
    distance = useRef(0),
    lastEmit = useRef(0),
    blocked = useRef(false);
  const stepRemaining = useRef<Vec2>([0, 0]);
  const wasMoving = useRef(false);
  const current = useRef({ world, onLocation, onPause });
  current.current = { world, onLocation, onPause };
  const apply = () => {
    camera.position.set(position.current[0], body.current.elevation + 1.6, -position.current[1]);
    camera.quaternion.setFromEuler(rotation.current);
  };
  const emit = () => {
    const local =
      current.current.world.floors.get(body.current.floorId) ||
      current.current.world.floors.values().next().value!;
    const where = roomAt(local, position.current);
    current.current.onLocation({
      point: [...position.current],
      yaw: rotation.current.y,
      roomId: where?.id || null,
      roomName: where?.name || '门洞通道',
      distance: distance.current,
      blocked: blocked.current,
      available: ready.current,
      floorId: body.current.floorId,
      floorName: scene.floors.find((f) => f.id === body.current.floorId)?.name || '',
      elevation: body.current.elevation,
      stairId: body.current.stairId,
    });
    lastEmit.current = performance.now();
  };
  useEffect(() => {
    const floor =
      scene.floors.find((f) => f.rooms.some((r) => r.id === room.id)) || scene.floors[0];
    const requested =
      entry &&
      entry.floorId === floor.id &&
      canStandMulti(current.current.world, {
        point: entry.point,
        elevation: floor.elevationMm / 1000,
        floorId: floor.id,
      })
        ? entry
        : null;
    const spawn =
      requested?.point ||
      findWalkSpawn(floorScene(scene, floor.id), current.current.world.floors.get(floor.id)!, room);
    ready.current = !!spawn;
    held.current.clear();
    input.current = { forward: 0, strafe: 0, step: null, turn: 0 };
    distance.current = 0;
    stepRemaining.current = [0, 0];
    wasMoving.current = false;
    blocked.current = false;
    if (spawn) {
      position.current = spawn;
      body.current = { point: spawn, elevation: floor.elevationMm / 1000, floorId: floor.id };
      const pose = roomCamera(scene, room),
        dx = pose.target[0] - spawn[0],
        dz = pose.target[2] + spawn[1];
      rotation.current.set(-0.06, Math.atan2(-dx, -dz), 0, 'YXZ');
      if (requested) rotation.current.set(-0.05, requested.yaw, 0, 'YXZ');
      if (camera instanceof PerspectiveCamera) {
        camera.fov = 70;
        camera.updateProjectionMatrix();
      }
      apply();
    }
    emit();
    invalidate();
    // Only an explicit room request/reset relocates the visitor, not HUD updates.
  }, [room.id, reset, scene.floors, scene.layout.furniture, camera, invalidate, input, entry]);

  useEffect(() => {
    const canvas = gl.domElement;
    const region = canvas.closest<HTMLElement>('[data-walk-region]');
    let drag: { id: number; x: number; y: number } | null = null;
    const clear = () => {
      held.current.clear();
      input.current.forward = input.current.strafe = input.current.turn = 0;
      input.current.step = null;
      stepRemaining.current = [0, 0];
      wasMoving.current = false;
      drag = null;
      blocked.current = false;
      if (active && ready.current) emit();
    };
    const keydown = (e: KeyboardEvent) => {
      if (
        !active ||
        !(region?.contains(document.activeElement) || document.pointerLockElement === canvas)
      )
        return;
      if (e.code === 'Escape') {
        clear();
        current.current.onPause();
        return;
      }
      if (inputTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (MOVEMENT.has(e.code)) {
        e.preventDefault();
        held.current.add(e.code);
        invalidate();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (held.current.delete(e.code)) {
        e.preventDefault();
        emit();
        invalidate();
      }
    };
    const down = (e: PointerEvent) => {
      if (!active || !ready.current || e.button !== 0 || (drag && drag.id !== e.pointerId)) return;
      e.preventDefault();
      region?.focus({ preventScroll: true });
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!active || !ready.current) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && (!drag || drag.id !== e.pointerId)) return;
      const dx = locked ? e.movementX : e.clientX - drag!.x,
        dy = locked ? e.movementY : e.clientY - drag!.y;
      rotation.current.y -= dx * 0.0032;
      rotation.current.x = Math.max(-1.25, Math.min(1.25, rotation.current.x - dy * 0.0028));
      if (drag) {
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
      blocked.current = false;
      apply();
      invalidate();
      if (performance.now() - lastEmit.current > 120) emit();
    };
    const up = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      emit();
    };
    const visibility = () => {
      if (document.hidden) {
        clear();
        current.current.onPause();
      }
    };
    const blur = () => {
      clear();
      if (active) current.current.onPause();
    };
    canvas.style.touchAction = active ? 'none' : '';
    canvas.style.cursor = active ? 'grab' : '';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      canvas.style.touchAction = '';
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, gl, camera, input, invalidate]);

  useFrame((_, dt) => {
    if (!active || !ready.current) return;
    const keys = held.current;
    const forward =
      Number(keys.has('KeyW') || keys.has('ArrowUp')) -
      Number(keys.has('KeyS') || keys.has('ArrowDown')) +
      input.current.forward;
    const strafe =
      Number(keys.has('KeyD') || keys.has('ArrowRight')) -
      Number(keys.has('KeyA') || keys.has('ArrowLeft')) +
      input.current.strafe;
    const step = input.current.step;
    const turn = input.current.turn;
    input.current.step = null;
    input.current.turn = 0;
    if (turn) {
      rotation.current.y += turn;
      stepRemaining.current = [0, 0];
    }
    if (step) {
      const next = walkDelta(rotation.current.y, step[0], step[1], 0.35);
      stepRemaining.current = next.map((v, i) => v + stepRemaining.current[i]) as Vec2;
      const length = Math.hypot(...stepRemaining.current);
      if (length > 0.7)
        stepRemaining.current = stepRemaining.current.map((v) => (v / length) * 0.7) as Vec2;
    }
    const remaining = Math.hypot(...stepRemaining.current),
      stride = WALK_SPEED * Math.min(dt, 0.05);
    let delta: Vec2;
    if (forward || strafe) {
      stepRemaining.current = [0, 0];
      delta = walkDelta(rotation.current.y, forward, strafe, stride);
    } else if (remaining > 0.0001) {
      delta = stepRemaining.current.map(
        (v) => (v / remaining) * Math.min(remaining, stride),
      ) as Vec2;
      stepRemaining.current = stepRemaining.current.map((v, i) => v - delta[i]) as Vec2;
    } else delta = [0, 0];
    if (remaining > 0.0001 || forward || strafe) {
      wasMoving.current = true;
      const result = moveWalker(current.current.world, body.current, delta);
      distance.current += Math.hypot(
        result.body.point[0] - position.current[0],
        result.body.point[1] - position.current[1],
      );
      body.current = result.body;
      position.current = result.body.point;
      blocked.current = result.blocked;
      apply();
      if (
        (!forward && !strafe && Math.hypot(...stepRemaining.current) < 0.0001) ||
        performance.now() - lastEmit.current > 120
      )
        emit();
      invalidate();
    } else if (turn || wasMoving.current) {
      wasMoving.current = false;
      if (turn) {
        blocked.current = false;
        apply();
      }
      emit();
    }
  });
  return null;
}
