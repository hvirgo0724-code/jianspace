import { it, expect, vi } from 'vitest';
import { installAOResourceCleanup } from './aoResources';

it('releases owned AO buffers/materials once when toggling quality without disposing the scene', () => {
  const target = { isWebGLRenderTarget: true, dispose: vi.fn() },
    material = { isMaterial: true, dispose: vi.fn() },
    scene = { dispose: vi.fn(), children: [{ material }] },
    original = vi.fn(),
    pass = { target, duplicateTarget: target, quad: { material }, scene, dispose: original };
  installAOResourceCleanup(pass);
  installAOResourceCleanup(pass);
  pass.dispose();
  pass.dispose();
  expect(target.dispose).toHaveBeenCalledTimes(1);
  expect(material.dispose).toHaveBeenCalledTimes(1);
  expect(original).toHaveBeenCalledTimes(1);
  expect(scene.dispose).not.toHaveBeenCalled();
});

it('preserves a future upstream implementation that already owns resource disposal', () => {
  class CompletePass {
    [key: string]: unknown;
    dispose() {}
  }
  const pass = new CompletePass(),
    original = pass.dispose;
  installAOResourceCleanup(pass);
  expect(pass.dispose).toBe(original);
});
