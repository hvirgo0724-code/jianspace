type Owner = Record<string, unknown> & { dispose?: () => void };
type Resource = {
  dispose?: () => void;
  isWebGLRenderTarget?: boolean;
  isTexture?: boolean;
  isMaterial?: boolean;
  material?: Resource;
};
const managed = new WeakSet<Owner>();

/** n8ao 2.0.1 inherits an empty Pass.dispose(). Release its owned GPU targets
 * when the quality switch removes it; do not traverse borrowed scenes/cameras. */
export function installAOResourceCleanup(pass: Owner) {
  if (managed.has(pass) || Object.hasOwn(Object.getPrototypeOf(pass), 'dispose')) return;
  managed.add(pass);
  const original = pass.dispose?.bind(pass);
  let disposed = false;
  pass.dispose = () => {
    if (disposed) return;
    disposed = true;
    const released = new Set<Resource>();
    const release = (resource?: Resource) => {
      if (!resource || released.has(resource)) return;
      released.add(resource);
      resource.dispose?.();
    };
    for (const value of Object.values(pass)) {
      if (!value || typeof value !== 'object') continue;
      const resource = value as Resource;
      if (resource.isWebGLRenderTarget || resource.isTexture || resource.isMaterial)
        release(resource);
      else if (resource.material?.isMaterial) release(resource.material);
    }
    release(pass.depthCopyPass as Resource | undefined);
    original?.();
  };
}
