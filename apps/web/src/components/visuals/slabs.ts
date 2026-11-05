import polygonClipping from 'polygon-clipping';
import { Shape, Path } from 'three';
import type { Vec2 } from '../../types';

/** A stairwell intersecting the room edge is a notch, not an invalid exterior hole. */
export function subtractSlab(boundary: Vec2[], cuts: Vec2[][]) {
  let result: polygonClipping.MultiPolygon = [[[...boundary, boundary[0]]]];
  if (cuts.length)
    result = polygonClipping.difference(
      result,
      ...cuts.map((p) => [[...p, p[0]]] as polygonClipping.Polygon),
    );
  return result;
}
export function slabShapes(boundary: Vec2[], cuts: Vec2[][]) {
  return polygonShapes(subtractSlab(boundary, cuts));
}
export function polygonShapes(polygons: polygonClipping.MultiPolygon) {
  return polygons.map((rings) => {
    const shape = new Shape();
    rings[0].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    for (const ring of rings.slice(1)) {
      const hole = new Path();
      ring.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
      hole.closePath();
      shape.holes.push(hole);
    }
    return shape;
  });
}
