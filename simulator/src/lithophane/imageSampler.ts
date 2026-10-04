export type ImageSampler = {
  sampleBrightness(u: number, v: number): number;
};

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function wrap01(x: number): number {
  const t = x % 1;
  return t < 0 ? t + 1 : t;
}

function luminance01(r: number, g: number, b: number): number {
  // sRGB-ish luma coefficients (not linearized); sufficient for v1 mapping.
  return clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
}

export function createImageSampler(imageData: ImageData): ImageSampler {
  const { width, height, data } = imageData;

  function getLumAt(x: number, y: number): number {
    const ix = Math.max(0, Math.min(width - 1, x));
    const iy = Math.max(0, Math.min(height - 1, y));
    const idx = (iy * width + ix) * 4;
    return luminance01(data[idx], data[idx + 1], data[idx + 2]);
  }

  return {
    sampleBrightness(u: number, v: number) {
      const uu = wrap01(u);
      const vv = clamp01(v);

      const x = uu * (width - 1);
      const y = vv * (height - 1);

      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);

      const tx = x - x0;
      const ty = y - y0;

      const b00 = getLumAt(x0, y0);
      const b10 = getLumAt(x1, y0);
      const b01 = getLumAt(x0, y1);
      const b11 = getLumAt(x1, y1);

      const b0 = b00 * (1 - tx) + b10 * tx;
      const b1 = b01 * (1 - tx) + b11 * tx;

      return b0 * (1 - ty) + b1 * ty;
    },
  };
}
