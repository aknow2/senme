import {
  directedTetraFaces,
  type BoundaryFace,
  type CanonicalVolumeComplex,
  type ComplexRegion,
  type FaceIntent,
} from './partSolid';
import type { SplitCell } from './splitCell';

export type Position3 = readonly [number, number, number];

export type ClipInputVertex = Readonly<{
  key: string;
  position: Position3;
  scalars: Readonly<Record<string, number>>;
}>;

export type ClipBoundary = Readonly<{
  id: string;
  scalar: string;
  keep: 'positive' | 'negative';
  side: 'lower' | 'upper';
}>;

export type FaceProvenance =
  | Readonly<{ kind: 'original'; originFaceKey: string; surface: BoundaryFace['surface']; intent: FaceIntent }>
  | Readonly<{ kind: 'interior'; originFaceKey: string }>
  | Readonly<{ kind: 'namedInterface'; originFaceKey: string; name: NamedInterfaceName }>
  | Readonly<{ kind: 'splitWall'; boundaryId: string; axis: 'u' | 'v'; side: 'lower' | 'upper'; intent: FaceIntent }>;

export type ClipInputFace = Readonly<{
  vertexKeys: readonly [string, string, string];
  provenance: FaceProvenance;
}>;

export type ClippedVertex = Readonly<{
  key: string;
  position: Position3;
  float32Position: Position3;
  lineage: Readonly<{ kind: 'canonical' } | { kind: 'cut'; boundaryId: string; endpoints: readonly [string, string] } | { kind: 'centroid'; sourceKey: string }>;
}>;

export type ClippedFace = Readonly<{
  vertexKeys: readonly [string, string, string];
  provenance: FaceProvenance;
  area2: number;
}>;

export type ClippedPrimitiveTetra = Readonly<{
  vertexKeys: readonly [string, string, string, string];
  signedVolume6: number;
  clipSides: readonly string[];
}>;

export type ClippedPolyhedron = Readonly<{
  vertices: readonly ClippedVertex[];
  faces: readonly ClippedFace[];
  tetrahedra: readonly ClippedPrimitiveTetra[];
  centroid: ClippedVertex;
  volume: number;
}>;

export type NamedInterfaceName = 'shellCollar' | 'collarTaper' | 'taperTube';

export type PartitionedFace = ClippedFace & Readonly<{
  vertexIds: readonly [number, number, number];
  sourceTetraIndex: number;
  order: number;
}>;

export type PartitionedTetrahedron = ClippedPrimitiveTetra & Readonly<{
  vertexIds: readonly [number, number, number, number];
  sourceTetraIndex: number;
  sourceUSegment: number;
  sourceVSegment: number | null;
  region: ComplexRegion;
  cellId: string;
  pieceIndex: number;
}>;

export type ClippedVolumeComplex = Readonly<{
  positions: Float64Array;
  vertices: readonly (ClippedVertex & Readonly<{ id: number }>)[];
  faces: readonly PartitionedFace[];
  tetrahedra: readonly PartitionedTetrahedron[];
  cell: SplitCell;
  diagnostics: Readonly<{
    namedInterfaces: Readonly<Record<NamedInterfaceName, Readonly<{ retained: number; valid: true }>>>;
    omittedDegeneratePieces: number;
  }>;
}>;

type WorkingVertex = {
  key: string;
  position: Position3;
  scalars: Record<string, number>;
  lineage: ClippedVertex['lineage'];
};

type WorkingFace = { keys: string[]; provenance: FaceProvenance };

const WALL_INTENT: FaceIntent = Object.freeze({ kind: 'wall', materialIndex: 2, uv: Object.freeze({ kind: 'neutral' }) });

function generationFailure(message: string): never {
  const error = new Error(message) as Error & { code: 'GENERATION_FAILED' };
  error.code = 'GENERATION_FAILED';
  throw error;
}

function determinant(a: Position3, b: Position3, c: Position3, d: Position3): number {
  const bax = b[0] - a[0]; const bay = b[1] - a[1]; const baz = b[2] - a[2];
  const cax = c[0] - a[0]; const cay = c[1] - a[1]; const caz = c[2] - a[2];
  const dax = d[0] - a[0]; const day = d[1] - a[1]; const daz = d[2] - a[2];
  return bax * (cay * daz - caz * day) - bay * (cax * daz - caz * dax) + baz * (cax * day - cay * dax);
}

function crossLength(a: Position3, b: Position3, c: Position3): number {
  const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2];
  const acx = c[0] - a[0]; const acy = c[1] - a[1]; const acz = c[2] - a[2];
  return Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
}

function maxScale(vertices: Iterable<WorkingVertex>): number {
  let scale = 1;
  for (const vertex of vertices) for (const coordinate of vertex.position) scale = Math.max(scale, Math.abs(coordinate));
  return scale;
}

function sortedPair(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

function edgeKey(a: string, b: string): string {
  const pair = sortedPair(a, b);
  return `${pair[0]}\u0000${pair[1]}`;
}

function rotateSmallest<T extends readonly string[]>(values: T): T {
  let smallest = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i] < values[smallest]) smallest = i;
  return [...values.slice(smallest), ...values.slice(0, smallest)] as unknown as T;
}

function sameCycle(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.some((_, offset) => a.every((value, index) => value === b[(index + offset) % b.length]));
}

function oppositeCycle(a: readonly string[], b: readonly string[]): boolean {
  return sameCycle(a, [...b].reverse());
}

function stableFaceKey(keys: readonly string[]): string {
  return [...keys].sort().join('\u0001');
}

function normalizePolygon(keys: readonly string[], vertices: ReadonlyMap<string, WorkingVertex>, areaGate: number): string[] {
  const result: string[] = [];
  for (const key of keys) if (result[result.length - 1] !== key) result.push(key);
  if (result.length > 1 && result[0] === result[result.length - 1]) result.pop();
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let i = 0; i < result.length; i += 1) {
      const previous = vertices.get(result[(i + result.length - 1) % result.length])!;
      const current = vertices.get(result[i])!;
      const next = vertices.get(result[(i + 1) % result.length])!;
      if (previous.key === next.key || crossLength(previous.position, current.position, next.position) <= areaGate) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function centroidOf(keys: readonly string[], vertices: ReadonlyMap<string, WorkingVertex>): Position3 {
  const sum = [0, 0, 0];
  for (const key of keys) {
    const point = vertices.get(key)!.position;
    sum[0] += point[0]; sum[1] += point[1]; sum[2] += point[2];
  }
  return [sum[0] / keys.length, sum[1] / keys.length, sum[2] / keys.length];
}

function orientOutward(keys: string[], center: Position3, vertices: ReadonlyMap<string, WorkingVertex>, areaGate: number): string[] | null {
  if (keys.length < 3) return null;
  const a = vertices.get(keys[0])!.position;
  const b = vertices.get(keys[1])!.position;
  const c = vertices.get(keys[2])!.position;
  const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2];
  const acx = c[0] - a[0]; const acy = c[1] - a[1]; const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy; const ny = abz * acx - abx * acz; const nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz);
  if (length <= areaGate) return null;
  const dot = nx * (a[0] - center[0]) + ny * (a[1] - center[1]) + nz * (a[2] - center[2]);
  if (dot === 0) return null;
  return dot > 0 ? keys : [...keys].reverse();
}

function defaultFaces(vertices: readonly ClipInputVertex[]): ClipInputFace[] {
  const keys = vertices.map((vertex) => vertex.key) as [string, string, string, string];
  return directedTetraFaces([0, 1, 2, 3]).map((face) => {
    const vertexKeys = face.map((id) => keys[id]) as [string, string, string];
    return { vertexKeys, provenance: { kind: 'interior', originFaceKey: stableFaceKey(vertexKeys) } };
  });
}

export function clipTetrahedronDeterministically(input: Readonly<{
  sourceKey: string;
  vertices: readonly [ClipInputVertex, ClipInputVertex, ClipInputVertex, ClipInputVertex];
  boundaries: readonly ClipBoundary[];
  faces?: readonly ClipInputFace[];
}>): ClippedPolyhedron | null {
  const working = new Map<string, WorkingVertex>();
  for (const vertex of input.vertices) {
    if (working.has(vertex.key)) generationFailure(`Degenerate tetra ${input.sourceKey}: duplicate canonical key ${vertex.key}`);
    if (!vertex.position.every(Number.isFinite) || !Object.values(vertex.scalars).every(Number.isFinite)) {
      generationFailure(`Nonfinite tetra input ${input.sourceKey}/${vertex.key}`);
    }
    working.set(vertex.key, { key: vertex.key, position: vertex.position, scalars: { ...vertex.scalars }, lineage: { kind: 'canonical' } });
  }
  const originalVolume6 = determinant(...input.vertices.map((vertex) => vertex.position) as [Position3, Position3, Position3, Position3]);
  const originalScale = maxScale(working.values());
  const originalVolumeGate = (originalScale * 1e-10) ** 3;
  if (!Number.isFinite(originalVolume6) || originalVolume6 <= originalVolumeGate) {
    generationFailure(`Degenerate or non-positive source tetra ${input.sourceKey}: ${originalVolume6}`);
  }
  let faces: WorkingFace[] = (input.faces ?? defaultFaces(input.vertices)).map((face) => ({ keys: [...face.vertexKeys], provenance: face.provenance }));
  const appliedSides: string[] = [];

  for (const boundary of input.boundaries) {
    const isInside = (value: number): boolean => boundary.keep === 'positive' ? value >= 0 : value <= 0;
    const clippedFaces: WorkingFace[] = [];
    const intersection = (leftKey: string, rightKey: string): string => {
      const endpoints = sortedPair(leftKey, rightKey);
      const left = working.get(endpoints[0])!; const right = working.get(endpoints[1])!;
      const leftG = left.scalars[boundary.scalar]; const rightG = right.scalars[boundary.scalar];
      if (leftG === 0) return left.key;
      if (rightG === 0) return right.key;
      const key = `cut:${boundary.id}:[${endpoints[0]}|${endpoints[1]}]`;
      if (working.has(key)) return key;
      const denominator = leftG - rightG;
      if (!Number.isFinite(denominator) || denominator === 0) generationFailure(`Invalid cut denominator ${input.sourceKey}/${boundary.id}`);
      const t = leftG / denominator;
      const position: Position3 = [
        left.position[0] + t * (right.position[0] - left.position[0]),
        left.position[1] + t * (right.position[1] - left.position[1]),
        left.position[2] + t * (right.position[2] - left.position[2]),
      ];
      const scalarNames = new Set([...Object.keys(left.scalars), ...Object.keys(right.scalars)]);
      const scalars: Record<string, number> = {};
      for (const name of scalarNames) scalars[name] = name === boundary.scalar
        ? 0
        : left.scalars[name] + t * (right.scalars[name] - left.scalars[name]);
      working.set(key, { key, position, scalars, lineage: { kind: 'cut', boundaryId: boundary.id, endpoints } });
      return key;
    };

    for (const face of faces) {
      const output: string[] = [];
      for (let i = 0; i < face.keys.length; i += 1) {
        const a = face.keys[i]; const b = face.keys[(i + 1) % face.keys.length];
        const ga = working.get(a)!.scalars[boundary.scalar];
        const gb = working.get(b)!.scalars[boundary.scalar];
        if (!Number.isFinite(ga) || !Number.isFinite(gb)) generationFailure(`Missing cut scalar ${boundary.scalar} on ${input.sourceKey}`);
        const aInside = isInside(ga); const bInside = isInside(gb);
        if (aInside && bInside) output.push(b);
        else if (aInside && !bInside) output.push(intersection(a, b));
        else if (!aInside && bInside) output.push(intersection(a, b), b);
      }
      if (output.length >= 3) clippedFaces.push({ keys: output, provenance: face.provenance });
    }
    const boundaryScale = maxScale(working.values());
    const boundaryAreaGate = (boundaryScale * 1e-10) ** 2;
    faces = clippedFaces.flatMap((face) => {
      const normalized = normalizePolygon(face.keys, working, boundaryAreaGate);
      return normalized.length >= 3 ? [{ keys: normalized, provenance: face.provenance }] : [];
    });
    if (faces.length === 0) return null;

    // Boundary segments are the once-occurring edges whose endpoint scalar is exactly zero.
    const boundaryEdges = new Map<string, { pair: readonly [string, string]; count: number }>();
    for (const face of faces) for (let i = 0; i < face.keys.length; i += 1) {
      const a = face.keys[i]; const b = face.keys[(i + 1) % face.keys.length];
      if (working.get(a)!.scalars[boundary.scalar] !== 0 || working.get(b)!.scalars[boundary.scalar] !== 0 || a === b) continue;
      const key = edgeKey(a, b); const present = boundaryEdges.get(key);
      boundaryEdges.set(key, { pair: sortedPair(a, b), count: (present?.count ?? 0) + 1 });
    }
    const capEdges = [...boundaryEdges.values()].filter((edge) => edge.count === 1).map((edge) => edge.pair);
    if (capEdges.length > 0) {
      const neighbors = new Map<string, string[]>();
      for (const [a, b] of capEdges) {
        neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
        neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
      }
      if ([...neighbors.values()].some((list) => list.length !== 2)) generationFailure(`Invalid cut cap topology ${input.sourceKey}/${boundary.id}`);
      const start = [...neighbors.keys()].sort()[0];
      const loop = [start];
      let previous = ''; let current = start;
      do {
        const options = neighbors.get(current)!.filter((key) => key !== previous).sort();
        const next = options[0];
        if (!next) generationFailure(`Open cut cap ${input.sourceKey}/${boundary.id}`);
        previous = current; current = next;
        if (current !== start) loop.push(current);
        if (loop.length > neighbors.size) generationFailure(`Non-simple cut cap ${input.sourceKey}/${boundary.id}`);
      } while (current !== start);
      if (loop.length === neighbors.size) {
        faces.push({
          keys: loop,
          provenance: { kind: 'splitWall', boundaryId: boundary.id, axis: 'v', side: boundary.side, intent: WALL_INTENT },
        });
      }
    }
    appliedSides.push(`${boundary.id}:${boundary.side}:${boundary.keep}`);
  }

  const usedKeys = [...new Set(faces.flatMap((face) => face.keys))].sort();
  if (usedKeys.length < 4) return null;
  const scale = maxScale(usedKeys.map((key) => working.get(key)!));
  const areaGate = (scale * 1e-10) ** 2;
  const volumeGate = (scale * 1e-10) ** 3;
  const center = centroidOf(usedKeys, working);
  const normalizedFaces: { keys: string[]; provenance: FaceProvenance }[] = [];
  for (const face of faces) {
    const normalized = normalizePolygon(face.keys, working, areaGate);
    const oriented = orientOutward(normalized, center, working, areaGate);
    if (oriented) normalizedFaces.push({ keys: rotateSmallest(oriented), provenance: face.provenance });
  }
  if (normalizedFaces.length < 4) return null;

  const centroidKey = `centroid:${input.sourceKey}:${appliedSides.join('|') || 'uncut'}`;
  const centroidVertex: WorkingVertex = { key: centroidKey, position: center, scalars: {}, lineage: { kind: 'centroid', sourceKey: input.sourceKey } };
  working.set(centroidKey, centroidVertex);
  const outputFaces: ClippedFace[] = [];
  const outputTetra: ClippedPrimitiveTetra[] = [];
  for (const face of normalizedFaces) for (let i = 1; i + 1 < face.keys.length; i += 1) {
    const triangle = rotateSmallest([face.keys[0], face.keys[i], face.keys[i + 1]] as const);
    const a = working.get(triangle[0])!.position; const b = working.get(triangle[1])!.position; const c = working.get(triangle[2])!.position;
    const area2 = crossLength(a, b, c);
    if (area2 <= areaGate) continue;
    const vertexKeys = [centroidKey, ...triangle] as const;
    const signedVolume6 = determinant(center, a, b, c);
    if (!Number.isFinite(signedVolume6) || signedVolume6 <= volumeGate) {
      generationFailure(`Degenerate clipped tetra ${input.sourceKey}/${triangle.join(':')}: ${signedVolume6}`);
    }
    outputFaces.push(Object.freeze({ vertexKeys: triangle, provenance: face.provenance, area2 }));
    outputTetra.push(Object.freeze({ vertexKeys, signedVolume6, clipSides: Object.freeze([...appliedSides]) }));
  }
  if (outputTetra.length === 0) return null;
  const volume = outputTetra.reduce((sum, tetra) => sum + tetra.signedVolume6 / 6, 0);
  const publishedKeys = new Set(outputTetra.flatMap((tetra) => tetra.vertexKeys));
  const outputVertices = [...publishedKeys].sort().map((key): ClippedVertex => {
    const vertex = working.get(key)!;
    return Object.freeze({
      key,
      position: Object.freeze([...vertex.position]) as unknown as Position3,
      float32Position: Object.freeze([...new Float32Array(vertex.position)]) as unknown as Position3,
      lineage: vertex.lineage,
    });
  });
  const centroid = outputVertices.find((vertex) => vertex.key === centroidKey)!;
  return Object.freeze({
    vertices: Object.freeze(outputVertices), faces: Object.freeze(outputFaces), tetrahedra: Object.freeze(outputTetra), centroid, volume,
  });
}

function directedKeyFace(face: readonly number[], complex: CanonicalVolumeComplex): readonly string[] {
  return face.map((id) => complex.vertices[id].key);
}

function inferTotal(start: number, end: number, min: number, max: number): number {
  const candidates = [min > 0 ? start / min : NaN, max > 0 ? end / max : NaN].filter(Number.isFinite);
  const total = Math.round(candidates[0]);
  if (!Number.isInteger(total) || total <= 0) generationFailure(`Cannot infer canonical segment total from ${start}:${end}/${min}:${max}`);
  return total;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a); let y = Math.abs(b);
  while (y !== 0) { const next = x % y; x = y; y = next; }
  return x;
}

function rationalBoundary(axis: 'u' | 'v', numerator: number, denominator: number): string {
  const divisor = gcd(numerator, denominator);
  return `${axis}:${numerator / divisor}/${denominator / divisor}`;
}

function faceIncidences(complex: CanonicalVolumeComplex): Map<string, { keys: readonly string[]; tetraIndex: number }[]> {
  const result = new Map<string, { keys: readonly string[]; tetraIndex: number }[]>();
  complex.tetrahedra.forEach((tetra, tetraIndex) => {
    for (const face of directedTetraFaces(tetra.vertexIds)) {
      const keys = directedKeyFace(face, complex); const key = stableFaceKey(keys); const list = result.get(key) ?? [];
      list.push({ keys, tetraIndex }); result.set(key, list);
    }
  });
  return result;
}

function namedOrigins(complex: CanonicalVolumeComplex): Map<string, NamedInterfaceName> {
  const result = new Map<string, NamedInterfaceName>();
  for (const name of ['shellCollar', 'collarTaper', 'taperTube'] as const) for (const numericKey of complex.diagnostics.interfaces[name]) {
    const ids = numericKey.split(':').map(Number);
    if (ids.length !== 3 || ids.some((id) => !complex.vertices[id])) generationFailure(`Invalid named interface ${name}/${numericKey}`);
    const stable = stableFaceKey(ids.map((id) => complex.vertices[id].key));
    if (result.has(stable)) generationFailure(`Multiply declared named interface ${name}/${stable}`);
    result.set(stable, name);
  }
  const incidences = faceIncidences(complex);
  for (const [key, name] of result) {
    const pair = incidences.get(key);
    if (!pair || pair.length !== 2 || !oppositeCycle(pair[0].keys, pair[1].keys)) {
      generationFailure(`Invalid named interface ${name}/${key}: expected exactly twice/opposite`);
    }
  }
  return result;
}

function boundaryOrigins(complex: CanonicalVolumeComplex): Map<string, BoundaryFace> {
  return new Map(complex.boundaryFaces.map((face) => [stableFaceKey(directedKeyFace(face.vertexIds, complex)), face]));
}

function originalFaceProvenance(
  complex: CanonicalVolumeComplex,
  numericFace: readonly number[],
  named: ReadonlyMap<string, NamedInterfaceName>,
  boundary: ReadonlyMap<string, BoundaryFace>,
  width: number,
  height: number,
): FaceProvenance {
  const keys = directedKeyFace(numericFace, complex);
  const originFaceKey = stableFaceKey(keys);
  const metadata = numericFace.map((id) => complex.vertices[id]);
  const namedInterface = named.get(originFaceKey);
  if (namedInterface && complex.cell.verticalCount > 1) {
    for (const [grid, side] of [[complex.cell.vSegments.start, 'lower'], [complex.cell.vSegments.end, 'upper']] as const) {
      if (metadata.every((vertex) => vertex.vGrid === grid)) {
        return { kind: 'splitWall', boundaryId: rationalBoundary('v', grid, height), axis: 'v', side, intent: WALL_INTENT };
      }
    }
  }
  if (namedInterface) return { kind: 'namedInterface', originFaceKey, name: namedInterface };
  const exterior = boundary.get(originFaceKey);
  if (!exterior) return { kind: 'interior', originFaceKey };
  if (complex.cell.horizontalCount > 1) {
    for (const [grid, side] of [[complex.cell.uSegments.start, 'lower'], [complex.cell.uSegments.end, 'upper']] as const) {
      const canonical = ((grid % width) + width) % width;
      if (metadata.every((vertex) => vertex.uGrid === canonical)) {
        return { kind: 'splitWall', boundaryId: rationalBoundary('u', grid, width), axis: 'u', side, intent: WALL_INTENT };
      }
    }
  }
  if (complex.cell.verticalCount > 1) {
    for (const [grid, side] of [[complex.cell.vSegments.start, 'lower'], [complex.cell.vSegments.end, 'upper']] as const) {
      if (metadata.every((vertex) => vertex.vGrid === grid)) {
        return { kind: 'splitWall', boundaryId: rationalBoundary('v', grid, height), axis: 'v', side, intent: WALL_INTENT };
      }
    }
  }
  return { kind: 'original', originFaceKey, surface: exterior.surface, intent: exterior.intent };
}

export function clipCanonicalVolumeComplex(complex: CanonicalVolumeComplex): ClippedVolumeComplex {
  const width = inferTotal(complex.cell.uSegments.start, complex.cell.uSegments.end, complex.cell.uMin, complex.cell.uMax);
  const height = inferTotal(complex.cell.vSegments.start, complex.cell.vSegments.end, complex.cell.vMin, complex.cell.vMax);
  const named = namedOrigins(complex);
  const boundaries = boundaryOrigins(complex);
  const outputVertexByKey = new Map<string, ClippedVertex & { id: number }>();
  const outputFaces: PartitionedFace[] = [];
  const outputTetra: PartitionedTetrahedron[] = [];
  let omittedDegeneratePieces = 0;

  const addVertex = (vertex: ClippedVertex): number => {
    const present = outputVertexByKey.get(vertex.key);
    if (present) {
      if (present.position.some((value, index) => value !== vertex.position[index])
        || present.float32Position.some((value, index) => value !== vertex.float32Position[index])) {
        generationFailure(`Canonical cut identity coordinate mismatch ${vertex.key}`);
      }
      return present.id;
    }
    const id = outputVertexByKey.size;
    outputVertexByKey.set(vertex.key, Object.freeze({ ...vertex, id }));
    return id;
  };

  complex.tetrahedra.forEach((tetra, sourceTetraIndex) => {
    if (tetra.sourceUSegment < complex.cell.uSegments.start || tetra.sourceUSegment >= complex.cell.uSegments.end) return;
    if (tetra.region === 'shell' && (tetra.sourceVSegment === null
      || tetra.sourceVSegment < complex.cell.vSegments.start || tetra.sourceVSegment >= complex.cell.vSegments.end)) return;
    const clipBoundaries: ClipBoundary[] = [];
    if (tetra.sourceVSegment === null && complex.cell.verticalCount > 1) {
      if (complex.cell.vSegments.start > 0) clipBoundaries.push({
        id: rationalBoundary('v', complex.cell.vSegments.start, height), scalar: 'lower', keep: 'positive', side: 'lower',
      });
      if (complex.cell.vSegments.end < height) clipBoundaries.push({
        id: rationalBoundary('v', complex.cell.vSegments.end, height), scalar: 'upper', keep: 'negative', side: 'upper',
      });
    }
    const inputVertices = tetra.vertexIds.map((id): ClipInputVertex => {
      const metadata = complex.vertices[id];
      const position: Position3 = [complex.positions[id * 3], complex.positions[id * 3 + 1], complex.positions[id * 3 + 2]];
      const radius = Math.hypot(...position);
      const scalars: Record<string, number> = {};
      if (clipBoundaries.some((boundary) => boundary.scalar === 'lower')) {
        const theta = Math.PI * (1 - complex.cell.vSegments.start / height);
        scalars.lower = position[1] - radius * Math.cos(theta);
      }
      if (clipBoundaries.some((boundary) => boundary.scalar === 'upper')) {
        const theta = Math.PI * (1 - complex.cell.vSegments.end / height);
        scalars.upper = position[1] - radius * Math.cos(theta);
      }
      return { key: metadata.key, position, scalars };
    }) as [ClipInputVertex, ClipInputVertex, ClipInputVertex, ClipInputVertex];
    const inputFaces = directedTetraFaces(tetra.vertexIds).map((face): ClipInputFace => ({
      vertexKeys: directedKeyFace(face, complex) as [string, string, string],
      provenance: originalFaceProvenance(complex, face, named, boundaries, width, height),
    }));
    const result = clipTetrahedronDeterministically({
      sourceKey: `${tetra.cellId}:tetra:${sourceTetraIndex}`, vertices: inputVertices, boundaries: clipBoundaries, faces: inputFaces,
    });
    if (!result) { omittedDegeneratePieces += 1; return; }
    for (const vertex of result.vertices) addVertex(vertex);
    result.faces.forEach((face, order) => {
      const vertexIds = face.vertexKeys.map((key) => outputVertexByKey.get(key)!.id) as [number, number, number];
      outputFaces.push(Object.freeze({ ...face, vertexIds, sourceTetraIndex, order }));
    });
    result.tetrahedra.forEach((piece, pieceIndex) => {
      const vertexIds = piece.vertexKeys.map((key) => outputVertexByKey.get(key)!.id) as [number, number, number, number];
      outputTetra.push(Object.freeze({
        ...piece, vertexIds, sourceTetraIndex, sourceUSegment: tetra.sourceUSegment, sourceVSegment: tetra.sourceVSegment,
        region: tetra.region, cellId: tetra.cellId, pieceIndex,
      }));
    });
  });
  if (outputTetra.length === 0) generationFailure('Selected clip cell has no positive volume');

  // Every subdivided internal or named face must still be paired exactly and oppositely.
  const paired = new Map<string, PartitionedFace[]>();
  for (const face of outputFaces) if (face.provenance.kind === 'interior' || face.provenance.kind === 'namedInterface') {
    const key = stableFaceKey(face.vertexKeys); const list = paired.get(key) ?? []; list.push(face); paired.set(key, list);
  }
  const retained: Record<NamedInterfaceName, number> = { shellCollar: 0, collarTaper: 0, taperTube: 0 };
  for (const [key, list] of paired) {
    if (list.length !== 2 || !oppositeCycle(list[0].vertexKeys, list[1].vertexKeys)) {
      const namedFace = list.find((face) => face.provenance.kind === 'namedInterface');
      generationFailure(`${namedFace ? 'Invalid named interface' : 'Invalid clipped interior'} ${key}: expected exactly twice/opposite`);
    }
    const provenance = list[0].provenance;
    if (provenance.kind === 'namedInterface') retained[provenance.name] += 1;
  }
  const vertices = [...outputVertexByKey.values()].sort((a, b) => a.id - b.id);
  return Object.freeze({
    positions: new Float64Array(vertices.flatMap((vertex) => [...vertex.position])),
    vertices: Object.freeze(vertices), faces: Object.freeze(outputFaces), tetrahedra: Object.freeze(outputTetra), cell: complex.cell,
    diagnostics: Object.freeze({
      namedInterfaces: Object.freeze({
        shellCollar: Object.freeze({ retained: retained.shellCollar, valid: true as const }),
        collarTaper: Object.freeze({ retained: retained.collarTaper, valid: true as const }),
        taperTube: Object.freeze({ retained: retained.taperTube, valid: true as const }),
      }),
      omittedDegeneratePieces,
    }),
  });
}
