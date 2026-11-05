export const MIN_MASK_COVERAGE = 0.002;
export const MAX_MASK_COVERAGE = 0.85;

export function clampPixel(value: number, size: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(size - 1, Math.round(value)));
}

export function pointerToPixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) return null;
  return {
    x: clampPixel(((clientX - rect.left) / rect.width) * width, width),
    y: clampPixel(((clientY - rect.top) / rect.height) * height, height),
  };
}

export function coverageRatio(whitePixels: number, totalPixels: number): number {
  if (!Number.isFinite(whitePixels) || !Number.isFinite(totalPixels) || totalPixels <= 0)
    return 0;
  return Math.min(1, Math.max(0, whitePixels / totalPixels));
}

export function formatCoverage(ratio: number): string {
  return (coverageRatio(ratio, 1) * 100).toFixed(1) + '%';
}

export function coverageIssue(ratio: number): string | null {
  if (ratio < MIN_MASK_COVERAGE)
    return '涂抹范围太小，请至少覆盖底图的 0.2%，便于模型识别修改范围。';
  if (ratio > MAX_MASK_COVERAGE)
    return '涂抹范围超过 85%，已接近整图重绘；请缩小局部范围或改用效果图生成。';
  return null;
}
