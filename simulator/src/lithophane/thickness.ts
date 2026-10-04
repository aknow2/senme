import type { LithophaneParams } from '../domain/params';

function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export function applyBrightnessCurve(brightness01: number, curve: number): number {
  const b = clamp(brightness01, 0, 1);
  return clamp(Math.pow(b, curve), 0, 1);
}

export function applyContrast(brightness01: number, contrast: number): number {
  // Contrast around mid-gray (0.5). 1 = unchanged, 0 = flat mid-gray.
  const b = clamp(brightness01, 0, 1);
  return clamp((b - 0.5) * contrast + 0.5, 0, 1);
}

export function brightnessToThicknessMm(brightness01: number, params: LithophaneParams): number {
  const contrasted = applyContrast(brightness01, params.contrast);
  const curved = applyBrightnessCurve(contrasted, params.brightnessCurve);
  const t =
    params.minThicknessMm +
    (1 - curved) * (params.maxThicknessMm - params.minThicknessMm);
  return clamp(t, params.minThicknessMm, params.maxThicknessMm);
}
