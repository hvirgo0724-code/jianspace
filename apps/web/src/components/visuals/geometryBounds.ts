import { Box3, Matrix4, Mesh, type Object3D } from 'three';
/** Bounds in the authored model's local frame, independent of placement and parent scaling. */
export function localModelBounds(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(),
    result = new Box3();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox)
      result.union(
        node.geometry.boundingBox
          .clone()
          .applyMatrix4(new Matrix4().multiplyMatrices(inverse, node.matrixWorld)),
      );
  });
  return result;
}
