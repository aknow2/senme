import type { LithophaneParams } from '../domain/params';
import { brightnessToThicknessMm } from './thickness';
import { createImageSampler } from './imageSampler';
import type { SplitCell } from './splitCell';

export type RadialLayer = 'inner' | 'outer';
export type ComplexRegion = 'shell' | 'collar' | 'taper' | 'tube';
export type DirectedFace = readonly [number, number, number];
export type TetraVertexIds = readonly [number, number, number, number];
export type RingKind = 'I' | 'O' | 'CI' | 'CO' | 'SI' | 'SO' | 'BI' | 'BO';

export type FaceIntent = Readonly<{
  kind: 'outer' | 'inner' | 'wall';
  materialIndex: 0 | 1 | 2;
  uv: Readonly<{ kind: 'image' | 'neutral' }>;
}>;

export type CanonicalVertex = Readonly<{
  id: number;
  key: string;
  kind:
    | 'shell'
    | 'collar-inner'
    | 'collar-outer'
    | 'stand-inner-top'
    | 'stand-outer-top'
    | 'stand-inner-bottom'
    | 'stand-outer-bottom';
  radialLayer: RadialLayer | null;
  uGrid: number;
  vGrid: number | null;
  sample:
    | Readonly<{ kind: 'image'; finalU: number; finalV: number; brightness: number }>
    | Readonly<{ kind: 'neutral' }>;
}>;

export type CanonicalTetrahedron = Readonly<{
  vertexIds: TetraVertexIds;
  signedVolume6: number;
  sourceUSegment: number;
  sourceVSegment: number | null;
  region: ComplexRegion;
  cellId: string;
}>;

export type BoundaryFace = Readonly<{
  vertexIds: DirectedFace;
  intent: FaceIntent;
  surface:
    | 'shell-outer'
    | 'shell-inner'
    | 'hole-rim'
    | 'stand-transition'
    | 'stand-outer-wall'
    | 'stand-inner-wall'
    | 'stand-bottom-annulus'
    | 'bottom-lumen-disk'
    | 'top-lumen-disk'
    | 'split-or-interior-wall';
  sourceUSegment: number;
  sourceVSegment: number | null;
  region: ComplexRegion;
}>;

export type StandScalars = Readonly<{
  theta: number;
  s: number;
  y0: number;
  delta: number;
  halfDelta: number;
  q: number;
  w: number;
  h: number;
  tau: readonly number[];
  tauMin: number;
  j: number;
  Yradial: number;
  YcutMin: number;
  Yc: number;
  Ys: number;
  Yb: number;
}>;

export type CellDiagnostic = Readonly<{
  id: string;
  region: ComplexRegion;
  sourceUSegment: number;
  tetraIndices: readonly number[];
  tetraVolume: number;
  boundaryVolume: number;
}>;

export type CanonicalVolumeComplex = Readonly<{
  positions: Float64Array;
  vertices: readonly CanonicalVertex[];
  tetrahedra: readonly CanonicalTetrahedron[];
  boundaryFaces: readonly BoundaryFace[];
  cell: SplitCell;
  canonicalIds: Readonly<{
    shell(layer: RadialLayer, vGrid: number, uGrid: number): number;
    ring(kind: RingKind, uGrid: number): number;
  }>;
  diagnostics: Readonly<{
    bottomHole: Readonly<{ enabled: boolean; ringVGrid: number; removedVSegments: readonly number[] }>;
    topHole: Readonly<{ enabled: boolean; ringVGrid: number; removedVSegments: readonly number[] }>;
    stand: Readonly<{
      enabled: boolean;
      scalars: StandScalars | null;
      float64Rings: Readonly<Record<RingKind, Float64Array>>;
      float32Rings: Readonly<Record<RingKind, Float32Array>>;
    }>;
    interfaces: Readonly<{
      shellCollar: readonly string[];
      collarTaper: readonly string[];
      taperTube: readonly string[];
    }>;
    cells: readonly CellDiagnostic[];
    provenanceConflicts: readonly string[];
    overlappingInterfaceFaces: readonly string[];
  }>;
}>;

type MutableVertex = Omit<CanonicalVertex, never>;
type Position = readonly [number, number, number];
type HoleCut = { enabled: boolean; ringRow: number; ringVGrid: number };
type MutableCell = { id: string; region: ComplexRegion; sourceUSegment: number; tetraIndices: number[] };

const OUTER_INTENT: FaceIntent = Object.freeze({ kind: 'outer', materialIndex: 0, uv: Object.freeze({ kind: 'image' }) });
const INNER_INTENT: FaceIntent = Object.freeze({ kind: 'inner', materialIndex: 1, uv: Object.freeze({ kind: 'neutral' }) });
const WALL_INTENT: FaceIntent = Object.freeze({ kind: 'wall', materialIndex: 2, uv: Object.freeze({ kind: 'neutral' }) });

function generationFailure(message: string): never {
  const error = new Error(message) as Error & { code: 'GENERATION_FAILED' };
  error.code = 'GENERATION_FAILED';
  throw error;
}

function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function makeBottomHoleCut(diameterMm: number, baseRadius: number, heightSegments: number): HoleCut {
  const radiusMm = clamp(diameterMm / 2, 0, baseRadius);
  const enabled = radiusMm > 0;
  if (!enabled) return { enabled, ringRow: heightSegments, ringVGrid: 0 };
  const desiredV = Math.asin(clamp(radiusMm / baseRadius, 0, 1)) / Math.PI;
  const ringRow = Math.max(0, Math.min(heightSegments - 1, Math.floor((1 - desiredV) * heightSegments)));
  return { enabled, ringRow, ringVGrid: heightSegments - ringRow };
}

function makeTopHoleCut(diameterMm: number, baseRadius: number, heightSegments: number): HoleCut {
  const radiusMm = clamp(diameterMm / 2, 0, baseRadius);
  const enabled = radiusMm > 0;
  if (!enabled) return { enabled, ringRow: 0, ringVGrid: heightSegments };
  const alpha = Math.asin(clamp(radiusMm / baseRadius, 0, 1)) / Math.PI;
  const ringRow = Math.max(1, Math.min(heightSegments, Math.ceil(alpha * heightSegments)));
  return { enabled, ringRow, ringVGrid: heightSegments - ringRow };
}

function localDirection(width: number, height: number, uGrid: number, vGrid: number): Position {
  if (vGrid === 0) return [0, -1, 0];
  if (vGrid === height) return [0, 1, 0];
  const theta = Math.PI * (1 - vGrid / height);
  const phi = Math.PI * 2 * (1 - (((uGrid % width) + width) % width) / width);
  return [-Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
}

function finalImageUv(direction: Position, params: LithophaneParams): { u: number; v: number } {
  const tilt = ((params.holeLatitude ?? 0) / 100) * Math.PI;
  const spin = ((params.holeLongitude ?? 0) / 100) * Math.PI * 2;
  const tiltedY = direction[1] * Math.cos(tilt) - direction[2] * Math.sin(tilt);
  const tiltedZ = direction[1] * Math.sin(tilt) + direction[2] * Math.cos(tilt);
  const finalX = direction[0] * Math.cos(spin) + tiltedZ * Math.sin(spin);
  const finalZ = -direction[0] * Math.sin(spin) + tiltedZ * Math.cos(spin);
  const theta = Math.acos(clamp(tiltedY, -1, 1));
  let phi = Math.atan2(finalZ, -finalX);
  if (phi < 0) phi += Math.PI * 2;
  return { u: 1 - phi / (Math.PI * 2), v: 1 - theta / Math.PI };
}

function signedVolume6(a: Position, b: Position, c: Position, d: Position): number {
  const bax = b[0] - a[0]; const bay = b[1] - a[1]; const baz = b[2] - a[2];
  const cax = c[0] - a[0]; const cay = c[1] - a[1]; const caz = c[2] - a[2];
  const dax = d[0] - a[0]; const day = d[1] - a[1]; const daz = d[2] - a[2];
  return bax * (cay * daz - caz * day) - bay * (cax * daz - caz * dax) + baz * (cax * day - cay * dax);
}

export function assertCellVolumeAgreement(cellId: string, tetraVolume: number, boundaryVolume: number): void {
  const scale = Math.max(1, Math.abs(tetraVolume));
  if (!Number.isFinite(boundaryVolume) || Math.abs(boundaryVolume - tetraVolume) > scale * 2e-12) {
    generationFailure(`Cell volume mismatch ${cellId}: tetra=${tetraVolume}, boundary=${boundaryVolume}`);
  }
}

export function directedTetraFaces(ids: TetraVertexIds): readonly DirectedFace[] {
  const [a, b, c, d] = ids;
  return [[b, c, d], [a, d, c], [a, b, d], [a, c, b]];
}

function undirectedFaceKey(face: DirectedFace): string {
  return [...face].sort((a, b) => a - b).join(':');
}

function sameDirectedCycle(a: DirectedFace, b: DirectedFace): boolean {
  return (a[0] === b[0] && a[1] === b[1] && a[2] === b[2])
    || (a[0] === b[1] && a[1] === b[2] && a[2] === b[0])
    || (a[0] === b[2] && a[1] === b[0] && a[2] === b[1]);
}

function oppositeDirected(a: DirectedFace, b: DirectedFace): boolean {
  return sameDirectedCycle(a, [b[0], b[2], b[1]]);
}

// Prescribed raw-positive patterns. No tetra is reoriented after generation.
const SOUTH_SHELL_STAIRCASE: readonly TetraVertexIds[] = [[0, 1, 2, 5], [0, 1, 5, 4], [0, 3, 4, 5]];
const NORTH_SHELL_STAIRCASE: readonly TetraVertexIds[] = [[0, 1, 5, 2], [0, 1, 4, 5], [0, 3, 5, 4]];
const SHELL_HEXA_STAIRCASE: readonly TetraVertexIds[] = [
  [0, 1, 6, 2], [0, 2, 6, 3], [0, 3, 6, 7],
  [0, 7, 6, 4], [0, 4, 6, 5], [0, 5, 6, 1],
];
// For each mandated +Y annular triangle, vertices 0..2 are the upper triangle
// and 3..5 are corresponding lower vertices. This is the fixed 3-tetra staircase.
const ANNULAR_PRISM_STAIRCASE: readonly TetraVertexIds[] = [[0, 1, 5, 2], [0, 1, 4, 5], [0, 3, 5, 4]];
const EMPTY_RINGS = (): Record<RingKind, Float64Array> => ({
  I: new Float64Array(), O: new Float64Array(), CI: new Float64Array(), CO: new Float64Array(),
  SI: new Float64Array(), SO: new Float64Array(), BI: new Float64Array(), BO: new Float64Array(),
});

export function buildPartSolidComplex(imageData: ImageData, params: LithophaneParams, cell: SplitCell): CanonicalVolumeComplex {
  const requiredInputs = [
    params.radiusMm,
    params.widthSegments,
    params.heightSegments,
    params.holeDiameterMm,
    params.topHoleDiameterMm,
    params.standWallThicknessMm,
  ];
  if (!requiredInputs.every(Number.isFinite) || params.radiusMm <= 0) {
    generationFailure(`Invalid split complex input scalar: ${requiredInputs.join(',')}`);
  }
  const sampler = createImageSampler(imageData);
  const vertices: MutableVertex[] = [];
  const positionValues: number[] = [];
  const vertexByKey = new Map<string, number>();
  const shellIds = new Map<string, number>();
  const ringIds = new Map<string, number>();
  const tetrahedra: CanonicalTetrahedron[] = [];
  const mutableCells: MutableCell[] = [];
  const mutableCellById = new Map<string, MutableCell>();
  const width = params.widthSegments;
  const height = params.heightSegments;
  const bottomHole = makeBottomHoleCut(params.holeDiameterMm, params.radiusMm, height);
  const topHole = makeTopHoleCut(params.topHoleDiameterMm, params.radiusMm, height);

  const addVertex = (key: string, p: Position, metadata: Omit<CanonicalVertex, 'id' | 'key'>): number => {
    const present = vertexByKey.get(key);
    if (present !== undefined) return present;
    if (!p.every(Number.isFinite)) generationFailure(`Nonfinite canonical vertex ${key}: ${p.join(',')}`);
    const id = vertices.length;
    vertexByKey.set(key, id);
    vertices.push({ id, key, ...metadata });
    positionValues.push(...p);
    return id;
  };
  const getPosition = (id: number): Position => [positionValues[id * 3], positionValues[id * 3 + 1], positionValues[id * 3 + 2]];
  const shellKey = (layer: RadialLayer, v: number, u: number): string => {
    if (v === 0) return `shell:${layer}:south-pole`;
    if (v === height) return `shell:${layer}:north-pole`;
    return `shell:${layer}:v${v}:u${((u % width) + width) % width}`;
  };
  const shellVertex = (layer: RadialLayer, v: number, u: number): number => {
    const key = shellKey(layer, v, u);
    const existing = shellIds.get(key);
    if (existing !== undefined) return existing;
    const canonicalU = ((u % width) + width) % width;
    const direction = localDirection(width, height, canonicalU, v);
    const uv = finalImageUv(direction, params);
    const brightness = sampler.sampleBrightness(uv.u, uv.v);
    const baseThickness = brightnessToThicknessMm(brightness, params);
    const factor = Math.max(direction[2], clamp(params.minCos, 0, 1));
    const thickness = clamp(baseThickness * factor, params.minThicknessMm, params.maxThicknessMm);
    const radius = layer === 'inner'
      ? (params.thicknessDirection === 'inward' ? params.radiusMm - thickness : params.radiusMm)
      : (params.thicknessDirection === 'inward' ? params.radiusMm : params.radiusMm + thickness);
    const id = addVertex(key, [direction[0] * radius, direction[1] * radius, direction[2] * radius], {
      kind: 'shell', radialLayer: layer, uGrid: canonicalU, vGrid: v,
      sample: layer === 'outer' ? { kind: 'image', finalU: uv.u, finalV: uv.v, brightness } : { kind: 'neutral' },
    });
    shellIds.set(key, id);
    return id;
  };

  const addTetra = (ids: TetraVertexIds, sourceU: number, sourceV: number | null, region: ComplexRegion, cellId: string): void => {
    if (new Set(ids).size !== 4) generationFailure(`Degenerate prescribed tetra ${cellId}: ${ids.join(':')}`);
    const volume6 = signedVolume6(getPosition(ids[0]), getPosition(ids[1]), getPosition(ids[2]), getPosition(ids[3]));
    if (!Number.isFinite(volume6) || volume6 <= 0) {
      generationFailure(`Non-positive prescribed determinant ${volume6} for ${cellId} at ${ids.join(':')}`);
    }
    const tetraIndex = tetrahedra.length;
    tetrahedra.push({ vertexIds: ids, signedVolume6: volume6, sourceUSegment: sourceU, sourceVSegment: sourceV, region, cellId });
    const diagnostic = mutableCellById.get(cellId);
    if (!diagnostic) generationFailure(`Missing cell diagnostic ${cellId}`);
    diagnostic.tetraIndices.push(tetraIndex);
  };
  const addPatternCell = (ids: readonly number[], pattern: readonly TetraVertexIds[], sourceU: number, sourceV: number | null, region: ComplexRegion, cellId: string): void => {
    if (mutableCellById.has(cellId)) generationFailure(`Duplicate cell diagnostic ${cellId}`);
    const diagnostic: MutableCell = { id: cellId, region, sourceUSegment: sourceU, tetraIndices: [] };
    mutableCells.push(diagnostic);
    mutableCellById.set(cellId, diagnostic);
    for (const p of pattern) addTetra([ids[p[0]], ids[p[1]], ids[p[2]], ids[p[3]]], sourceU, sourceV, region, cellId);
  };

  const retainedStart = bottomHole.enabled ? bottomHole.ringVGrid : 0;
  const retainedEnd = topHole.enabled ? topHole.ringVGrid : height;
  for (let v = Math.max(cell.vSegments.start, retainedStart); v < Math.min(cell.vSegments.end, retainedEnd); v += 1) {
    for (let u = cell.uSegments.start; u < cell.uSegments.end; u += 1) {
      const cellId = `shell:u${u}:v${v}`;
      if (v === 0) {
        addPatternCell([
          shellVertex('inner', 0, 0), shellVertex('inner', 1, u), shellVertex('inner', 1, u + 1),
          shellVertex('outer', 0, 0), shellVertex('outer', 1, u), shellVertex('outer', 1, u + 1),
        ], SOUTH_SHELL_STAIRCASE, u, v, 'shell', cellId);
      } else if (v === height - 1) {
        addPatternCell([
          shellVertex('inner', height - 1, u), shellVertex('inner', height - 1, u + 1), shellVertex('inner', height, 0),
          shellVertex('outer', height - 1, u), shellVertex('outer', height - 1, u + 1), shellVertex('outer', height, 0),
        ], NORTH_SHELL_STAIRCASE, u, v, 'shell', cellId);
      } else {
        addPatternCell([
          shellVertex('inner', v, u), shellVertex('inner', v, u + 1), shellVertex('inner', v + 1, u + 1), shellVertex('inner', v + 1, u),
          shellVertex('outer', v, u), shellVertex('outer', v, u + 1), shellVertex('outer', v + 1, u + 1), shellVertex('outer', v + 1, u),
        ], SHELL_HEXA_STAIRCASE, u, v, 'shell', cellId);
      }
    }
  }

  let scalarDiagnostics: StandScalars | null = null;
  const float64Rings = EMPTY_RINGS();
  const float32Rings: Record<RingKind, Float32Array> = {
    I: new Float32Array(), O: new Float32Array(), CI: new Float32Array(), CO: new Float32Array(),
    SI: new Float32Array(), SO: new Float32Array(), BI: new Float32Array(), BO: new Float32Array(),
  };
  const clampedW = clamp(params.standWallThicknessMm, 0, params.radiusMm * 2);
  const standEnabled = bottomHole.enabled && bottomHole.ringRow < height && clampedW > 0;

  if (standEnabled) {
    const g = bottomHole.ringVGrid;
    const theta = Math.PI * (1 - g / height);
    const s = Math.sin(theta);
    const y0 = Math.cos(theta);
    const delta = Math.PI * 2 / width;
    const halfDelta = delta / 2;
    const cosHalf = Math.cos(halfDelta);
    if (!Number.isFinite(s) || s === 0 || !Number.isFinite(cosHalf) || cosHalf <= 0 || g === 0 || g === height) {
      generationFailure(`Invalid split stand join: g=${g}, s=${s}, cosHalfDelta=${cosHalf}`);
    }

    const tau: number[] = [];
    const I: Position[] = [];
    const O: Position[] = [];
    for (let k = 0; k < width; k += 1) {
      const innerId = shellVertex('inner', g, k);
      const outerId = shellVertex('outer', g, k);
      ringIds.set(`I:${k}`, innerId);
      ringIds.set(`O:${k}`, outerId);
      const inner = getPosition(innerId); const outer = getPosition(outerId);
      const thickness = Math.hypot(...outer) - Math.hypot(...inner);
      if (!Number.isFinite(thickness) || thickness <= 0) generationFailure(`Invalid sampled tau_${k}: ${thickness}`);
      tau.push(thickness); I.push(inner); O.push(outer);
    }
    const q = params.radiusMm * s;
    const w = clampedW;
    const h = clamp(params.holeDiameterMm * 0.25, 3, 12);
    const tauMin = tau.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
    const j = Math.min(h, tauMin);
    const qCritical = y0 < 0 ? q + w : q;
    const Yradial = y0 * qCritical / s;
    const YcutMin = I.reduce((minimum, p, k) => Math.min(minimum, p[1], O[k][1]), Number.POSITIVE_INFINITY);
    const Yc = YcutMin - j;
    const Ys = Math.min(Yc, Yradial) - j;
    const Yb = Ys - h;
    const required = [theta, s, y0, delta, halfDelta, q, w, h, tauMin, j, Yradial, YcutMin, Yc, Ys, Yb];
    if (!required.every(Number.isFinite) || !(YcutMin > Yc && Yc > Ys && Ys > Yb)) {
      generationFailure(`Invalid split stand scalars: ${required.join(',')}`);
    }
    scalarDiagnostics = Object.freeze({ theta, s, y0, delta, halfDelta, q, w, h, tau: Object.freeze(tau), tauMin, j, Yradial, YcutMin, Yc, Ys, Yb });

    const ringPoints: Record<RingKind, Position[]> = { I, O, CI: [], CO: [], SI: [], SO: [], BI: [], BO: [] };
    const kindMetadata: Record<Exclude<RingKind, 'I' | 'O'>, CanonicalVertex['kind']> = {
      CI: 'collar-inner', CO: 'collar-outer', SI: 'stand-inner-top', SO: 'stand-outer-top',
      BI: 'stand-inner-bottom', BO: 'stand-outer-bottom',
    };
    for (let k = 0; k < width; k += 1) {
      const direction = localDirection(width, height, k, g);
      const radialLength = Math.hypot(direction[0], direction[2]);
      const ex = direction[0] / radialLength; const ez = direction[2] / radialLength;
      ringPoints.CI.push([I[k][0], Yc, I[k][2]]); ringPoints.CO.push([O[k][0], Yc, O[k][2]]);
      ringPoints.SI.push([q * ex, Ys, q * ez]); ringPoints.SO.push([(q + w) * ex, Ys, (q + w) * ez]);
      ringPoints.BI.push([q * ex, Yb, q * ez]); ringPoints.BO.push([(q + w) * ex, Yb, (q + w) * ez]);
      for (const kind of ['CI', 'CO', 'SI', 'SO', 'BI', 'BO'] as const) {
        const id = addVertex(`ring:${kind}:u${k}`, ringPoints[kind][k], {
          kind: kindMetadata[kind], radialLayer: null, uGrid: k, vGrid: null, sample: { kind: 'neutral' },
        });
        ringIds.set(`${kind}:${k}`, id);
      }
    }
    for (const kind of Object.keys(ringPoints) as RingKind[]) {
      float64Rings[kind] = new Float64Array(ringPoints[kind].flat());
      float32Rings[kind] = new Float32Array(float64Rings[kind]);
    }
    const f32 = (x: number) => Math.fround(x);
    if (!(f32(YcutMin) > f32(Yc) && f32(Yc) > f32(Ys) && f32(Ys) > f32(Yb))) {
      generationFailure(`Float32 stand layer collapse: ${[YcutMin, Yc, Ys, Yb].join(',')}`);
    }
    for (let k = 0; k < width; k += 1) for (const [inner, outer] of [['CI', 'CO'], ['SI', 'SO'], ['BI', 'BO']] as const) {
      const offset = k * 3;
      if (float32Rings[inner][offset] === float32Rings[outer][offset]
        && float32Rings[inner][offset + 2] === float32Rings[outer][offset + 2]) {
        generationFailure(`Float32 ${inner}/${outer} collapse at u${k}`);
      }
    }

    const ids = (kind: RingKind, u: number): number => {
      const key = `${kind}:${((u % width) + width) % width}`;
      const id = ringIds.get(key);
      if (id === undefined) generationFailure(`Missing canonical ring ${key}`);
      return id;
    };
    const addAnnularLayer = (region: 'collar' | 'taper' | 'tube', upperInner: RingKind, upperOuter: RingKind, lowerInner: RingKind, lowerOuter: RingKind, u: number): void => {
      const next = u + 1;
      const upperTriangles = [
        [ids(upperInner, u), ids(upperInner, next), ids(upperOuter, next)],
        [ids(upperInner, u), ids(upperOuter, next), ids(upperOuter, u)],
      ] as const;
      const lowerTriangles = [
        [ids(lowerInner, u), ids(lowerInner, next), ids(lowerOuter, next)],
        [ids(lowerInner, u), ids(lowerOuter, next), ids(lowerOuter, u)],
      ] as const;
      for (let triangle = 0; triangle < 2; triangle += 1) {
        addPatternCell([...upperTriangles[triangle], ...lowerTriangles[triangle]], ANNULAR_PRISM_STAIRCASE, u, null, region, `${region}:u${u}:t${triangle}`);
      }
    };
    for (let u = cell.uSegments.start; u < cell.uSegments.end; u += 1) {
      addAnnularLayer('collar', 'I', 'O', 'CI', 'CO', u);
      addAnnularLayer('taper', 'CI', 'CO', 'SI', 'SO', u);
      addAnnularLayer('tube', 'SI', 'SO', 'BI', 'BO', u);
    }
  }

  type Incident = { face: DirectedFace; tetra: CanonicalTetrahedron };
  const faceIncidences = new Map<string, Incident[]>();
  for (const tetra of tetrahedra) for (const face of directedTetraFaces(tetra.vertexIds)) {
    const key = undirectedFaceKey(face); const list = faceIncidences.get(key) ?? [];
    list.push({ face, tetra }); faceIncidences.set(key, list);
  }
  const provenanceConflicts: string[] = [];
  const overlappingInterfaceFaces: string[] = [];
  const shellCollar: string[] = []; const collarTaper: string[] = []; const taperTube: string[] = [];
  const boundaryFaces: BoundaryFace[] = [];
  const boundaryIntent = (face: DirectedFace, tetra: CanonicalTetrahedron): FaceIntent => {
    const vs = face.map((id) => vertices[id]);
    if (tetra.region === 'shell' && vs.every((v) => v.kind === 'shell' && v.radialLayer === 'outer')) return OUTER_INTENT;
    if (tetra.region === 'shell' && vs.every((v) => v.kind === 'shell' && v.radialLayer === 'inner')) return INNER_INTENT;
    return WALL_INTENT;
  };
  const surfaceName = (face: DirectedFace, tetra: CanonicalTetrahedron, intent: FaceIntent): BoundaryFace['surface'] => {
    if (intent.kind === 'outer') return 'shell-outer';
    if (intent.kind === 'inner') return 'shell-inner';
    const kinds = face.map((id) => vertices[id].kind);
    if (kinds.every((kind) => kind === 'stand-inner-bottom' || kind === 'stand-outer-bottom')) return 'stand-bottom-annulus';
    if (kinds.some((kind) => kind === 'collar-inner' || kind === 'stand-inner-top' || kind === 'stand-inner-bottom')) return 'stand-inner-wall';
    if (kinds.some((kind) => kind === 'collar-outer' || kind === 'stand-outer-top' || kind === 'stand-outer-bottom')) return 'stand-outer-wall';
    if (tetra.region === 'collar' || tetra.region === 'taper') return 'stand-transition';
    if (tetra.region === 'shell' && (bottomHole.enabled || topHole.enabled)) return 'hole-rim';
    return 'split-or-interior-wall';
  };
  for (const [key, list] of faceIncidences) {
    if (list.length === 1) {
      const [{ face, tetra }] = list; const intent = boundaryIntent(face, tetra);
      boundaryFaces.push({ vertexIds: face, intent, surface: surfaceName(face, tetra, intent), sourceUSegment: tetra.sourceUSegment, sourceVSegment: tetra.sourceVSegment, region: tetra.region });
    } else if (list.length !== 2) {
      provenanceConflicts.push(key); overlappingInterfaceFaces.push(key);
    } else {
      if (!oppositeDirected(list[0].face, list[1].face)) provenanceConflicts.push(key);
      const regions = new Set(list.map((entry) => entry.tetra.region));
      if (regions.has('shell') && regions.has('collar')) shellCollar.push(key);
      if (regions.has('collar') && regions.has('taper')) collarTaper.push(key);
      if (regions.has('taper') && regions.has('tube')) taperTube.push(key);
    }
  }
  if (provenanceConflicts.length > 0) generationFailure(`Canonical face incidence failure: ${provenanceConflicts[0]}`);

  const cellDiagnostics = mutableCells.map((entry): CellDiagnostic => {
    const localFaces = new Map<string, DirectedFace[]>();
    let tetraVolume = 0;
    for (const index of entry.tetraIndices) {
      const tetra = tetrahedra[index]; tetraVolume += tetra.signedVolume6 / 6;
      for (const face of directedTetraFaces(tetra.vertexIds)) {
        const key = undirectedFaceKey(face); const list = localFaces.get(key) ?? []; list.push(face); localFaces.set(key, list);
      }
    }
    let boundaryVolume = 0;
    const reference = getPosition(tetrahedra[entry.tetraIndices[0]].vertexIds[0]);
    for (const list of localFaces.values()) if (list.length === 1) {
      const [a, b, c] = list[0].map(getPosition) as [Position, Position, Position];
      // A closed oriented boundary has the same volume about any reference point.
      // A cell-local vertex keeps all determinant operands at cell scale instead of
      // subtracting large origin-based face terms for small cells far from the origin.
      boundaryVolume += signedVolume6(reference, a, b, c) / 6;
    }
    assertCellVolumeAgreement(entry.id, tetraVolume, boundaryVolume);
    return Object.freeze({ ...entry, tetraIndices: Object.freeze([...entry.tetraIndices]), tetraVolume, boundaryVolume });
  });

  const bottomRemoved = Array.from({ length: bottomHole.ringVGrid }, (_, i) => i);
  const topRemoved = Array.from({ length: height - topHole.ringVGrid }, (_, i) => topHole.ringVGrid + i);
  return Object.freeze({
    positions: new Float64Array(positionValues),
    vertices: Object.freeze(vertices.map((v) => Object.freeze({ ...v }))),
    tetrahedra: Object.freeze(tetrahedra.map((v) => Object.freeze({ ...v }))),
    boundaryFaces: Object.freeze(boundaryFaces.map((v) => Object.freeze({ ...v }))),
    cell,
    canonicalIds: Object.freeze({
      shell(layer: RadialLayer, v: number, u: number): number {
        const id = shellIds.get(shellKey(layer, v, u));
        if (id === undefined) throw new Error(`Canonical shell vertex is outside the built source range: ${layer}/${v}/${u}`);
        return id;
      },
      ring(kind: RingKind, u: number): number {
        const id = ringIds.get(`${kind}:${((u % width) + width) % width}`);
        if (id === undefined) throw new Error(`Canonical ring vertex is unavailable: ${kind}/${u}`);
        return id;
      },
    }),
    diagnostics: Object.freeze({
      bottomHole: Object.freeze({ enabled: bottomHole.enabled, ringVGrid: bottomHole.ringVGrid, removedVSegments: Object.freeze(bottomRemoved) }),
      topHole: Object.freeze({ enabled: topHole.enabled, ringVGrid: topHole.ringVGrid, removedVSegments: Object.freeze(topRemoved) }),
      stand: Object.freeze({ enabled: standEnabled, scalars: scalarDiagnostics, float64Rings: Object.freeze(float64Rings), float32Rings: Object.freeze(float32Rings) }),
      interfaces: Object.freeze({ shellCollar: Object.freeze(shellCollar), collarTaper: Object.freeze(collarTaper), taperTube: Object.freeze(taperTube) }),
      cells: Object.freeze(cellDiagnostics),
      provenanceConflicts: Object.freeze(provenanceConflicts),
      overlappingInterfaceFaces: Object.freeze(overlappingInterfaceFaces),
    }),
  });
}
