import type { LithophaneParams } from '../domain/params';

export type SegmentRange = {
  /** Inclusive, zero-based segment index. */
  start: number;
  /** Exclusive segment index. */
  end: number;
  count: number;
};

export type SplitCell = {
  /** 1-based, south to north. */
  row: number;
  /** 1-based, splitU=0 to 1. */
  column: number;
  /** 1-based row-major index. */
  index: number;
  horizontalCount: number;
  verticalCount: number;
  uSegments: SegmentRange;
  vSegments: SegmentRange;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
};

export function allocateSegmentRange(total: number, parts: number, ordinal: number): SegmentRange {
  const quotient = Math.floor(total / parts);
  const remainder = total % parts;
  const start = (ordinal - 1) * quotient + Math.min(ordinal - 1, remainder);
  const count = quotient + (ordinal <= remainder ? 1 : 0);
  return { start, end: start + count, count };
}

export function resolveSplitCell(params: LithophaneParams): SplitCell {
  const horizontalCount = params.horizontalSplitCount;
  const verticalCount = params.verticalSplitCount;
  const index = params.splitIndex;
  const row = Math.floor((index - 1) / horizontalCount) + 1;
  const column = ((index - 1) % horizontalCount) + 1;
  const uSegments = allocateSegmentRange(params.widthSegments, horizontalCount, column);
  const vSegments = allocateSegmentRange(params.heightSegments, verticalCount, row);

  return {
    row,
    column,
    index,
    horizontalCount,
    verticalCount,
    uSegments,
    vSegments,
    uMin: uSegments.start / params.widthSegments,
    uMax: uSegments.end / params.widthSegments,
    vMin: vSegments.start / params.heightSegments,
    vMax: vSegments.end / params.heightSegments,
  };
}
