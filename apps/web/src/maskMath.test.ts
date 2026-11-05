import { describe, expect, it } from 'vitest';
import {
  MAX_MASK_COVERAGE,
  MIN_MASK_COVERAGE,
  clampPixel,
  coverageIssue,
  coverageRatio,
  formatCoverage,
  pointerToPixel,
} from './maskMath';

describe('mask geometry and coverage', () => {
  it('maps pointer coordinates into natural image pixels at any display scale', () => {
    const rect = { left: 100, top: 50, width: 600, height: 300 };
    expect(pointerToPixel(100, 50, rect, 1200, 600)).toEqual({ x: 0, y: 0 });
    expect(pointerToPixel(400, 200, rect, 1200, 600)).toEqual({ x: 600, y: 300 });
    expect(pointerToPixel(1000, 400, rect, 1200, 600)).toEqual({ x: 1199, y: 599 });
  });

  it('returns null for collapsed canvases and clamps out-of-range coordinates', () => {
    expect(pointerToPixel(10, 10, { left: 0, top: 0, width: 0, height: 10 }, 10, 10)).toBeNull();
    expect(pointerToPixel(-50, -50, { left: 0, top: 0, width: 100, height: 100 }, 10, 10)).toEqual({
      x: 0,
      y: 0,
    });
    expect(clampPixel(Number.NaN, 10)).toBe(0);
    expect(clampPixel(3.4, 10)).toBe(3);
  });

  it('computes bounded coverage ratios and formats one decimal place', () => {
    expect(coverageRatio(1, 4)).toBe(0.25);
    expect(coverageRatio(5, 0)).toBe(0);
    expect(coverageRatio(Number.NaN, 10)).toBe(0);
    expect(coverageRatio(2, 1)).toBe(1);
    expect(formatCoverage(0.0668)).toBe('6.7%');
  });

  it('rejects masks that are too small or effectively full-image', () => {
    expect(coverageIssue(0)).toContain('0.2%');
    expect(coverageIssue(MIN_MASK_COVERAGE)).toBeNull();
    expect(coverageIssue(0.3)).toBeNull();
    expect(coverageIssue(MAX_MASK_COVERAGE)).toBeNull();
    expect(coverageIssue(0.9)).toContain('85%');
  });
});
