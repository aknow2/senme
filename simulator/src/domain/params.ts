export type LithophaneParams = {
  radiusMm: number;
  minThicknessMm: number;
  maxThicknessMm: number;
  holeDiameterMm: number;
  topHoleDiameterMm: number;
  holeLatitude: number;
  holeLongitude: number;
  standWallThicknessMm: number;
  widthSegments: number;
  heightSegments: number;
  contrast: number;
  brightnessCurve: number;
  minCos: number;
  imageScale: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  paddingMode: 'pad' | 'stretch';
  thicknessDirection: 'outward' | 'inward';
  horizontalSplitCount: number;
  verticalSplitCount: number;
  splitIndex: number;
};

export type SplitField = 'horizontalSplitCount' | 'verticalSplitCount' | 'splitIndex';

export type SplitInputDraft = Record<SplitField, string>;

export const DEFAULT_PARAMS: LithophaneParams = {
  radiusMm: 60,
  minThicknessMm: 2.8,
  maxThicknessMm: 5.5,
  holeDiameterMm: 0,
  topHoleDiameterMm: 0,
  holeLatitude: 0,
  holeLongitude: 0,
  standWallThicknessMm: 2,
  widthSegments: 256,
  heightSegments: 128,
  contrast: 1,
  brightnessCurve: 0.6,
  minCos: 1.00,
  imageScale: 1,
  flipHorizontal: false,
  flipVertical: false,
  paddingMode: 'pad',
  thicknessDirection: 'outward',
  horizontalSplitCount: 1,
  verticalSplitCount: 1,
  splitIndex: 1,
};
