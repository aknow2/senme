import { directedTetraFaces } from './partSolid';
import type { FaceIntent } from './partSolid';
import type {
  ClippedVolumeComplex,
  FaceProvenance,
  NamedInterfaceName,
  PartitionedFace,
  PartitionedTetrahedron,
} from './tetraClip';

export type MeshGroup = Readonly<{ start: number; count: number; materialIndex: 0 | 1 | 2 }>;

export type BoundaryTriangleMetadata = Readonly<{
  materialIndex: 0 | 1 | 2;
  stableFaceKey: string;
  sourceCellId: string;
  sourceTetraIndex: number;
  sourceUSegment: number;
  sourceVSegment: number | null;
  pieceIndex: number;
  boundaryKey: string;
  provenanceKey: string;
  provenance: FaceProvenance;
  canonicalVertexKeys: readonly [string, string, string];
}>;

export type ClosedSolidInput = Readonly<{
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}>;

export type TrianglePairClassification = 'proper intersection' | 'coplanar overlap' | 'coplanar contact';

export type ClosedSolidDiagnostics = Readonly<{
  vertexCount: number;
  weldedVertexCount: number;
  triangleCount: number;
  connectedComponents: number;
  signedVolume: number;
  broadPhase: 'longest-axis-bvh';
  bvhNodeCount: number;
  bvhLeafCount: number;
  bvhMaxDepth: number;
  broadPhaseNodePairsTested: number;
  intersectionCandidates: number;
  intersectionPairsTested: number;
}>;

export type GroupedBoundaryMesh = Readonly<{
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups: readonly [MeshGroup, MeshGroup, MeshGroup];
  triangles: readonly BoundaryTriangleMetadata[];
  stableVertexKeys: readonly string[];
  counts: Readonly<{
    vertices: number;
    triangles: number;
    outerTriangles: number;
    innerTriangles: number;
    wallTriangles: number;
  }>;
  diagnostics: ClosedSolidDiagnostics;
}>;

type Point = readonly [number, number, number];
type Triangle = Readonly<{
  index: number;
  vertices: readonly [number, number, number];
  points: readonly [Point, Point, Point];
  min: Point;
  max: Point;
}>;

type AabbNode = Readonly<{
  min: Point;
  max: Point;
  count: number;
  depth: number;
  triangle: Triangle | null;
  left: AabbNode | null;
  right: AabbNode | null;
}>;

type FaceIncident = Readonly<{
  keys: readonly [string, string, string];
  tetra: PartitionedTetrahedron;
}>;

type RetainedFace = Readonly<{
  keys: readonly [string, string, string];
  tetra: PartitionedTetrahedron;
  face: PartitionedFace;
  intent: FaceIntent;
}>;

const NAMED_INTERFACES = ['shellCollar', 'collarTaper', 'taperTube'] as const;

function generationFailure(message: string, cause?: unknown): never {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & { code: 'GENERATION_FAILED' };
  error.code = 'GENERATION_FAILED';
  throw error;
}

function guarded<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'GENERATION_FAILED') throw error;
    generationFailure(`${operation} failed because geometry resources could not be completed`, error);
  }
}

function stableFaceKey(keys: readonly string[]): string {
  return [...keys].sort().join('\u0001');
}

function sameCycle(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.some((_, offset) => a.every((value, index) => value === b[(index + offset) % b.length]));
}

function oppositeCycle(a: readonly string[], b: readonly string[]): boolean {
  return sameCycle(a, [...b].reverse());
}

function provenanceKey(provenance: FaceProvenance): string {
  if (provenance.kind === 'original') return `original:${provenance.surface}:${provenance.intent.kind}:${provenance.originFaceKey}`;
  if (provenance.kind === 'splitWall') return `splitWall:${provenance.axis}:${provenance.side}:${provenance.boundaryId}`;
  if (provenance.kind === 'namedInterface') return `namedInterface:${provenance.name}:${provenance.originFaceKey}`;
  return `interior:${provenance.originFaceKey}`;
}

function boundaryKey(provenance: FaceProvenance): string {
  if (provenance.kind === 'splitWall') return `${provenance.axis}:${provenance.side}:${provenance.boundaryId}`;
  if (provenance.kind === 'original') return `${provenance.surface}:${provenance.originFaceKey}`;
  return provenanceKey(provenance);
}

function compareNullableNumber(a: number | null, b: number | null): number {
  return (a ?? -1) - (b ?? -1);
}

function compareRetained(a: RetainedFace, b: RetainedFace): number {
  const material = a.intent.materialIndex - b.intent.materialIndex;
  if (material !== 0) return material;
  const cell = a.tetra.cellId.localeCompare(b.tetra.cellId);
  if (cell !== 0) return cell;
  const boundary = boundaryKey(a.face.provenance).localeCompare(boundaryKey(b.face.provenance));
  if (boundary !== 0) return boundary;
  const stableFace = stableFaceKey(a.keys).localeCompare(stableFaceKey(b.keys));
  if (stableFace !== 0) return stableFace;
  const provenance = provenanceKey(a.face.provenance).localeCompare(provenanceKey(b.face.provenance));
  if (provenance !== 0) return provenance;
  const source = a.tetra.sourceTetraIndex - b.tetra.sourceTetraIndex;
  if (source !== 0) return source;
  const sourceU = a.tetra.sourceUSegment - b.tetra.sourceUSegment;
  if (sourceU !== 0) return sourceU;
  const sourceV = compareNullableNumber(a.tetra.sourceVSegment, b.tetra.sourceVSegment);
  if (sourceV !== 0) return sourceV;
  const piece = a.tetra.pieceIndex - b.tetra.pieceIndex;
  if (piece !== 0) return piece;
  return a.face.order - b.face.order;
}

function intentOf(provenance: FaceProvenance): FaceIntent {
  if (provenance.kind === 'original' || provenance.kind === 'splitWall') return provenance.intent;
  generationFailure(`Surviving ${provenance.kind} face ${provenanceKey(provenance)} is not an exterior boundary`);
}

function validateFaceRecord(face: PartitionedFace, complex: ClippedVolumeComplex): void {
  const named = face.provenance.kind === 'namedInterface' ? ` for named interface ${face.provenance.name}` : '';
  const ids = face.vertexIds;
  if (new Set(ids).size !== 3 || ids.some((id) => !Number.isInteger(id) || id < 0 || id >= complex.vertices.length)) {
    generationFailure(`Malformed provenance face${named} ${face.sourceTetraIndex}/${face.order}: invalid vertex IDs`);
  }
  const keys = ids.map((id) => complex.vertices[id].key);
  if (!sameCycle(keys, face.vertexKeys)) generationFailure(`Malformed provenance face${named} ${stableFaceKey(face.vertexKeys)}: key/ID mismatch`);
}

function extractionImplementation(complex: ClippedVolumeComplex): GroupedBoundaryMesh {
  if (complex.tetrahedra.length === 0) generationFailure('Selected clip cell has no positive tetrahedra');
  if (complex.vertices.length === 0 || complex.positions.length !== complex.vertices.length * 3) {
    generationFailure('Malformed clipped complex vertex storage');
  }
  const vertexByKey = new Map<string, ClippedVolumeComplex['vertices'][number]>();
  for (const vertex of complex.vertices) {
    if (vertexByKey.has(vertex.key)) generationFailure(`Duplicate stable vertex key ${vertex.key}`);
    if (vertex.id < 0 || vertex.id >= complex.vertices.length) generationFailure(`Invalid clipped vertex ID ${vertex.id}`);
    const stored: Point = [complex.positions[vertex.id * 3], complex.positions[vertex.id * 3 + 1], complex.positions[vertex.id * 3 + 2]];
    if (stored.some((value, index) => value !== vertex.position[index])) generationFailure(`Position storage mismatch for ${vertex.key}`);
    vertexByKey.set(vertex.key, vertex);
  }

  const faceRecords = new Map<string, PartitionedFace[]>();
  for (const face of complex.faces) {
    validateFaceRecord(face, complex);
    const key = stableFaceKey(face.vertexKeys);
    faceRecords.set(key, [...(faceRecords.get(key) ?? []), face]);
  }
  const incidences = new Map<string, FaceIncident[]>();
  for (const tetra of complex.tetrahedra) {
    if (!Number.isFinite(tetra.signedVolume6) || tetra.signedVolume6 <= 0) {
      generationFailure(`Non-positive clipped tetra ${tetra.cellId}/${tetra.sourceTetraIndex}/${tetra.pieceIndex}`);
    }
    if (new Set(tetra.vertexKeys).size !== 4) generationFailure(`Degenerate clipped tetra identity ${tetra.cellId}`);
    for (const key of tetra.vertexKeys) if (!vertexByKey.has(key)) generationFailure(`Missing clipped tetra vertex ${key}`);
    for (const numericFace of directedTetraFaces([0, 1, 2, 3])) {
      const keys = numericFace.map((index) => tetra.vertexKeys[index]) as [string, string, string];
      const stable = stableFaceKey(keys);
      incidences.set(stable, [...(incidences.get(stable) ?? []), { keys, tetra }]);
    }
  }

  const usedRecords = new Set<PartitionedFace>();
  const retained: RetainedFace[] = [];
  const namedCounts: Record<NamedInterfaceName, number> = { shellCollar: 0, collarTaper: 0, taperTube: 0 };
  for (const [stable, list] of incidences) {
    const records = faceRecords.get(stable) ?? [];
    if (list.length === 1) {
      if (records.length === 0) generationFailure(`Missing boundary provenance for ${stable}`);
      if (records.length !== 1) generationFailure(`Ambiguous boundary provenance for ${stable}: ${records.length} owners`);
      const record = records[0];
      if (!sameCycle(list[0].keys, record.vertexKeys)) generationFailure(`Boundary provenance winding mismatch for ${stable}`);
      if (record.sourceTetraIndex !== list[0].tetra.sourceTetraIndex) {
        generationFailure(`Boundary provenance source mismatch for ${stable}${record.provenance.kind === 'namedInterface'
          ? ` (invalid named interface ${record.provenance.name})`
          : ''}`);
      }
      const intent = intentOf(record.provenance);
      if (intent.materialIndex !== 0 && intent.materialIndex !== 1 && intent.materialIndex !== 2) {
        generationFailure(`Invalid material group for ${stable}`);
      }
      usedRecords.add(record);
      retained.push({ keys: record.vertexKeys, tetra: list[0].tetra, face: record, intent });
      continue;
    }
    if (list.length > 2) generationFailure(`Non-manifold canonical face ${stable}: ${list.length} tetra incidents`);
    if (!oppositeCycle(list[0].keys, list[1].keys)) generationFailure(`Same-directed canonical face ${stable}`);
    if (records.length === 0) continue;
    if (records.length !== 2) {
      const named = records.find((record) => record.provenance.kind === 'namedInterface');
      generationFailure(`${named?.provenance.kind === 'namedInterface' ? `Invalid named interface ${named.provenance.name}` : 'Ambiguous interior provenance'} ${stable}: ${records.length} owners`);
    }
    const unmatched = [...list];
    for (const record of records) {
      const match = unmatched.findIndex((incident) => incident.tetra.sourceTetraIndex === record.sourceTetraIndex
        && sameCycle(incident.keys, record.vertexKeys));
      if (match < 0) generationFailure(`Provenance source mismatch for ${stable}${record.provenance.kind === 'namedInterface'
        ? ` (invalid named interface ${record.provenance.name})`
        : ''}`);
      unmatched.splice(match, 1);
    }
    if (unmatched.length !== 0) generationFailure(`Interior provenance ownership mismatch for ${stable}`);
    if (!oppositeCycle(records[0].vertexKeys, records[1].vertexKeys)) {
      const named = records.find((record) => record.provenance.kind === 'namedInterface');
      generationFailure(`${named?.provenance.kind === 'namedInterface' ? `Invalid named interface ${named.provenance.name}` : 'Same-directed interior provenance'} ${stable}`);
    }
    const first = records[0].provenance; const second = records[1].provenance;
    if (first.kind !== second.kind || provenanceKey(first) !== provenanceKey(second)
      || (first.kind !== 'interior' && first.kind !== 'namedInterface')) {
      const named = records.find((record) => record.provenance.kind === 'namedInterface');
      generationFailure(`Interior provenance conflict for ${stable}${named?.provenance.kind === 'namedInterface'
        ? ` (invalid named interface ${named.provenance.name})`
        : ''}`);
    }
    if (first.kind === 'namedInterface') namedCounts[first.name] += 1;
    usedRecords.add(records[0]); usedRecords.add(records[1]);
  }
  if (usedRecords.size !== complex.faces.length) {
    const orphan = complex.faces.find((face) => !usedRecords.has(face));
    generationFailure(`Orphan or multiply-owned provenance face does not match a positive tetra face${orphan?.provenance.kind === 'namedInterface'
      ? ` (invalid named interface ${orphan.provenance.name})`
      : ''}`);
  }
  for (const name of NAMED_INTERFACES) {
    const diagnostic = complex.diagnostics.namedInterfaces[name];
    if (!diagnostic || diagnostic.valid !== true || diagnostic.retained !== namedCounts[name]) {
      generationFailure(`Invalid named interface ${name} evidence: expected ${diagnostic?.retained ?? 'missing'}, found ${namedCounts[name]}`);
    }
  }

  retained.sort(compareRetained);
  const compactId = new Map<string, number>();
  const stableVertexKeys: string[] = [];
  const positionValues: number[] = [];
  const indexValues: number[] = [];
  const triangles: BoundaryTriangleMetadata[] = [];
  const triangleCounts = [0, 0, 0];
  for (const item of retained) {
    for (const key of item.keys) {
      let id = compactId.get(key);
      if (id === undefined) {
        const vertex = vertexByKey.get(key);
        if (!vertex) generationFailure(`Missing retained boundary vertex ${key}`);
        id = compactId.size;
        compactId.set(key, id);
        stableVertexKeys.push(key);
        positionValues.push(...vertex.float32Position);
      }
      indexValues.push(id);
    }
    const materialIndex = item.intent.materialIndex;
    triangleCounts[materialIndex] += 1;
    triangles.push(Object.freeze({
      materialIndex,
      stableFaceKey: stableFaceKey(item.keys),
      sourceCellId: item.tetra.cellId,
      sourceTetraIndex: item.tetra.sourceTetraIndex,
      sourceUSegment: item.tetra.sourceUSegment,
      sourceVSegment: item.tetra.sourceVSegment,
      pieceIndex: item.tetra.pieceIndex,
      boundaryKey: boundaryKey(item.face.provenance),
      provenanceKey: provenanceKey(item.face.provenance),
      provenance: item.face.provenance,
      canonicalVertexKeys: Object.freeze([...item.keys]) as unknown as readonly [string, string, string],
    }));
  }
  if (triangles.length === 0) generationFailure('Selected clip cell has no boundary triangles');
  const positions = new Float32Array(positionValues);
  const indices = chooseMeshIndexArray(stableVertexKeys.length, indexValues);
  const group0: MeshGroup = Object.freeze({ start: 0, count: triangleCounts[0] * 3, materialIndex: 0 });
  const group1: MeshGroup = Object.freeze({ start: group0.count, count: triangleCounts[1] * 3, materialIndex: 1 });
  const group2: MeshGroup = Object.freeze({ start: group0.count + group1.count, count: triangleCounts[2] * 3, materialIndex: 2 });
  const diagnostics = validateClosedSolid({ positions, indices });
  const groups: readonly [MeshGroup, MeshGroup, MeshGroup] = Object.freeze([group0, group1, group2]);
  return Object.freeze({
    positions,
    indices,
    groups,
    triangles: Object.freeze(triangles),
    stableVertexKeys: Object.freeze(stableVertexKeys),
    counts: Object.freeze({
      vertices: stableVertexKeys.length,
      triangles: triangles.length,
      outerTriangles: triangleCounts[0],
      innerTriangles: triangleCounts[1],
      wallTriangles: triangleCounts[2],
    }),
    diagnostics,
  });
}

export function chooseMeshIndexArray(vertexCount: number, values: Iterable<number>): Uint16Array | Uint32Array {
  return guarded('Index allocation', () => {
    if (!Number.isInteger(vertexCount) || vertexCount < 0) generationFailure(`Invalid final vertex count ${vertexCount}`);
    const collected = Array.from(values);
    if (collected.some((value) => !Number.isInteger(value) || value < 0 || value >= vertexCount)) {
      generationFailure(`Index is outside final vertex count ${vertexCount}`);
    }
    return vertexCount <= 65_535 ? new Uint16Array(collected) : new Uint32Array(collected);
  });
}

function floatBitsKey(index: number, view: DataView): string {
  const offset = index * 12;
  return `${view.getUint32(offset, true).toString(16)}:${view.getUint32(offset + 4, true).toString(16)}:${view.getUint32(offset + 8, true).toString(16)}`;
}

function weldFloat32Positions(positions: Float32Array): Readonly<{
  weldedForVertex: readonly number[];
  weldedPoints: readonly Point[];
}> {
  const view = new DataView(positions.buffer, positions.byteOffset, positions.byteLength);
  const weldedByBits = new Map<string, number>();
  const weldedForVertex: number[] = [];
  const weldedPoints: Point[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const key = floatBitsKey(vertex, view);
    let welded = weldedByBits.get(key);
    if (welded === undefined) {
      welded = weldedByBits.size;
      weldedByBits.set(key, welded);
      weldedPoints.push([positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]);
    }
    weldedForVertex.push(welded);
  }
  return { weldedForVertex, weldedPoints };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function triangleKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((left, right) => left - right).join(':');
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function segmentTriangleHit(a: Point, b: Point, triangle: readonly [Point, Point, Point], lengthEpsilon: number): Point | null {
  const direction = subtract(b, a);
  const edge1 = subtract(triangle[1], triangle[0]);
  const edge2 = subtract(triangle[2], triangle[0]);
  const p = cross(direction, edge2);
  const determinantValue = dot(edge1, p);
  const determinantScale = Math.hypot(...direction) * Math.hypot(...edge1) * Math.hypot(...edge2);
  const determinantEpsilon = determinantScale * Number.EPSILON * 64;
  if (Math.abs(determinantValue) <= determinantEpsilon) return null;
  const inverse = 1 / determinantValue;
  const tVector = subtract(a, triangle[0]);
  const u = dot(tVector, p) * inverse;
  const barycentricEpsilon = Number.EPSILON * 128;
  if (u < -barycentricEpsilon || u > 1 + barycentricEpsilon) return null;
  const q = cross(tVector, edge1);
  const v = dot(direction, q) * inverse;
  if (v < -barycentricEpsilon || u + v > 1 + barycentricEpsilon) return null;
  const t = dot(edge2, q) * inverse;
  const parameterEpsilon = lengthEpsilon / Math.max(Math.hypot(...direction), lengthEpsilon);
  if (t < -parameterEpsilon || t > 1 + parameterEpsilon) return null;
  return [a[0] + t * direction[0], a[1] + t * direction[1], a[2] + t * direction[2]];
}

type Point2 = readonly [number, number];

function project(point: Point, axis: number): Point2 {
  return axis === 0 ? [point[1], point[2]] : axis === 1 ? [point[0], point[2]] : [point[0], point[1]];
}

function cross2(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function polygonArea2(polygon: readonly Point2[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return area;
}

function lineIntersection(a: Point2, b: Point2, c: Point2, d: Point2): Point2 {
  const abx = b[0] - a[0]; const aby = b[1] - a[1];
  const cdx = d[0] - c[0]; const cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  if (denominator === 0) return b;
  const t = ((c[0] - a[0]) * cdy - (c[1] - a[1]) * cdx) / denominator;
  return [a[0] + t * abx, a[1] + t * aby];
}

function coplanarOverlapArea(left: Triangle, right: Triangle, normal: Point, areaEpsilon: number): number {
  const absolute = normal.map(Math.abs);
  const axis = absolute[0] >= absolute[1] && absolute[0] >= absolute[2] ? 0 : absolute[1] >= absolute[2] ? 1 : 2;
  let subject = left.points.map((point) => project(point, axis));
  const clip = right.points.map((point) => project(point, axis));
  const orientation = Math.sign(polygonArea2(clip)) || 1;
  for (let edge = 0; edge < 3 && subject.length > 0; edge += 1) {
    const a = clip[edge]; const b = clip[(edge + 1) % 3];
    const input = subject; subject = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i]; const previous = input[(i + input.length - 1) % input.length];
      const currentInside = orientation * cross2(a, b, current) >= -areaEpsilon;
      const previousInside = orientation * cross2(a, b, previous) >= -areaEpsilon;
      if (currentInside !== previousInside) subject.push(lineIntersection(previous, current, a, b));
      if (currentInside) subject.push(current);
    }
  }
  return Math.abs(polygonArea2(subject)) / 2;
}

function sharedVertices(left: Triangle, right: Triangle): number[] {
  return left.vertices.filter((vertex) => right.vertices.includes(vertex));
}

function pointOnSegment2(point: Point2, a: Point2, b: Point2, lengthEpsilon: number, areaEpsilon: number): boolean {
  if (Math.abs(cross2(a, b, point)) > areaEpsilon) return false;
  return point[0] >= Math.min(a[0], b[0]) - lengthEpsilon && point[0] <= Math.max(a[0], b[0]) + lengthEpsilon
    && point[1] >= Math.min(a[1], b[1]) - lengthEpsilon && point[1] <= Math.max(a[1], b[1]) + lengthEpsilon;
}

function coplanarContactVertices(
  left: Triangle,
  right: Triangle,
  normal: Point,
  lengthEpsilon: number,
  areaEpsilon: number,
): number[] {
  const absolute = normal.map(Math.abs);
  const axis = absolute[0] >= absolute[1] && absolute[0] >= absolute[2] ? 0 : absolute[1] >= absolute[2] ? 1 : 2;
  const contacts: number[] = [];
  for (const [source, target] of [[left, right], [right, left]] as const) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point2 = project(source.points[vertex], axis);
      for (let edge = 0; edge < 3; edge += 1) {
        if (pointOnSegment2(point2, project(target.points[edge], axis), project(target.points[(edge + 1) % 3], axis), lengthEpsilon, areaEpsilon)) {
          contacts.push(source.vertices[vertex]);
        }
      }
    }
  }
  return contacts;
}

function trianglesConflict(
  left: Triangle,
  right: Triangle,
  lengthEpsilon: number,
  areaEpsilon: number,
): TrianglePairClassification | null {
  const leftNormal = cross(subtract(left.points[1], left.points[0]), subtract(left.points[2], left.points[0]));
  const rightNormal = cross(subtract(right.points[1], right.points[0]), subtract(right.points[2], right.points[0]));
  const normalCross = cross(leftNormal, rightNormal);
  const leftNormalLength = Math.hypot(...leftNormal); const rightNormalLength = Math.hypot(...rightNormal);
  const angularEpsilon = Number.EPSILON * 128;
  const coplanar = Math.hypot(...normalCross) <= angularEpsilon * leftNormalLength * rightNormalLength
    && Math.abs(dot(leftNormal, subtract(right.points[0], left.points[0]))) <= lengthEpsilon * leftNormalLength;
  const shared = sharedVertices(left, right);
  if (coplanar) {
    if (coplanarOverlapArea(left, right, leftNormal, areaEpsilon) > areaEpsilon) return 'coplanar overlap';
    const contacts = coplanarContactVertices(left, right, leftNormal, lengthEpsilon, areaEpsilon);
    if (contacts.some((vertex) => !shared.includes(vertex))) return 'coplanar contact';
    return null;
  }
  // Two non-coplanar triangle planes intersect on the line containing their
  // exact shared welded edge, so convex triangles cannot meet beyond it.
  if (shared.length === 2) return null;
  for (const [source, target] of [[left, right], [right, left]] as const) {
    for (let edge = 0; edge < 3; edge += 1) {
      const next = (edge + 1) % 3;
      if (shared.length === 1 && (source.vertices[edge] === shared[0] || source.vertices[next] === shared[0])) continue;
      if (segmentTriangleHit(source.points[edge], source.points[next], target.points, lengthEpsilon)) return 'proper intersection';
    }
  }
  return null;
}

function triangleCentroid(triangle: Triangle, axis: number): number {
  return (triangle.points[0][axis] + triangle.points[1][axis] + triangle.points[2][axis]) / 3;
}

function longestAxis(extents: readonly number[]): number {
  return extents[0] >= extents[1] && extents[0] >= extents[2] ? 0 : extents[1] >= extents[2] ? 1 : 2;
}

function compareTriangleOnAxis(a: Triangle, b: Triangle, axis: number): number {
  return triangleCentroid(a, axis) - triangleCentroid(b, axis)
    || a.min[axis] - b.min[axis]
    || a.max[axis] - b.max[axis]
    || a.index - b.index;
}

function quickselect(items: Triangle[], start: number, end: number, target: number, axis: number): void {
  let left = start; let right = end - 1;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    const candidates = [items[left], items[middle], items[right]].sort((a, b) => compareTriangleOnAxis(a, b, axis));
    const pivot = candidates[1];
    let store = left;
    const pivotIndex = items.indexOf(pivot, left);
    [items[pivotIndex], items[right]] = [items[right], items[pivotIndex]];
    for (let index = left; index < right; index += 1) if (compareTriangleOnAxis(items[index], pivot, axis) < 0) {
      [items[index], items[store]] = [items[store], items[index]];
      store += 1;
    }
    [items[store], items[right]] = [items[right], items[store]];
    if (store === target) return;
    if (store < target) left = store + 1;
    else right = store - 1;
  }
}

function buildAabbTree(triangles: readonly Triangle[]): Readonly<{
  root: AabbNode;
  nodeCount: number;
  leafCount: number;
  maxDepth: number;
}> {
  const items = [...triangles];
  let nodeCount = 0; let leafCount = 0; let maxDepth = 0;
  const build = (start: number, end: number, depth: number): AabbNode => {
    nodeCount += 1; maxDepth = Math.max(maxDepth, depth);
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as number[];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as number[];
    const centroidMin = [...min]; const centroidMax = [...max];
    for (let index = start; index < end; index += 1) for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], items[index].min[axis]);
      max[axis] = Math.max(max[axis], items[index].max[axis]);
      const centroid = triangleCentroid(items[index], axis);
      centroidMin[axis] = Math.min(centroidMin[axis], centroid);
      centroidMax[axis] = Math.max(centroidMax[axis], centroid);
    }
    const count = end - start;
    if (count === 1) {
      leafCount += 1;
      return Object.freeze({ min: min as unknown as Point, max: max as unknown as Point, count, depth, triangle: items[start], left: null, right: null });
    }
    const centroidExtents = centroidMax.map((value, axis) => value - centroidMin[axis]);
    const boundsExtents = max.map((value, axis) => value - min[axis]);
    const axis = longestAxis(centroidExtents.some((extent) => extent > 0) ? centroidExtents : boundsExtents);
    const middle = start + Math.floor(count / 2);
    quickselect(items, start, end, middle, axis);
    const left = build(start, middle, depth + 1); const right = build(middle, end, depth + 1);
    return Object.freeze({ min: min as unknown as Point, max: max as unknown as Point, count, depth, triangle: null, left, right });
  };
  const root = build(0, items.length, 0);
  return Object.freeze({ root, nodeCount, leafCount, maxDepth });
}

function aabbOverlaps(left: AabbNode, right: AabbNode, lengthEpsilon: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) if (left.max[axis] + lengthEpsilon < right.min[axis]
    || right.max[axis] + lengthEpsilon < left.min[axis]) return false;
  return true;
}

function collectAabbPairs(root: AabbNode, lengthEpsilon: number): Readonly<{
  pairs: readonly (readonly [Triangle, Triangle])[];
  nodePairsTested: number;
}> {
  const pairs: [Triangle, Triangle][] = [];
  let nodePairsTested = 0;
  const visitPair = (left: AabbNode, right: AabbNode): void => {
    nodePairsTested += 1;
    if (!aabbOverlaps(left, right, lengthEpsilon)) return;
    if (left.triangle && right.triangle) {
      pairs.push(left.triangle.index < right.triangle.index ? [left.triangle, right.triangle] : [right.triangle, left.triangle]);
      return;
    }
    if (!right.triangle && (left.triangle || right.count >= left.count)) {
      visitPair(left, right.left!); visitPair(left, right.right!);
    } else {
      visitPair(left.left!, right); visitPair(left.right!, right);
    }
  };
  const visitSame = (node: AabbNode): void => {
    nodePairsTested += 1;
    if (node.triangle) return;
    visitSame(node.left!); visitPair(node.left!, node.right!); visitSame(node.right!);
  };
  visitSame(root);
  return Object.freeze({ pairs: Object.freeze(pairs), nodePairsTested });
}

function triangleFromBuffer(
  triangleIndex: number,
  source: readonly [number, number, number],
  positions: Float32Array,
  identities: readonly number[],
): Triangle {
  const points = source.map((index) => [
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2],
  ] as Point) as [Point, Point, Point];
  return {
    index: triangleIndex,
    vertices: source.map((index) => identities[index]) as [number, number, number],
    points,
    min: [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.min(...points.map((point) => point[2]))],
    max: [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])), Math.max(...points.map((point) => point[2]))],
  };
}

function finiteFloat32Scale(positions: Float32Array): number {
  if (!(positions instanceof Float32Array) || positions.length === 0 || positions.length % 3 !== 0) {
    generationFailure('Malformed Float32 position buffer');
  }
  let scale = 1;
  for (const coordinate of positions) {
    if (!Number.isFinite(coordinate)) generationFailure('Nonfinite Float32 coordinate');
    scale = Math.max(scale, Math.abs(coordinate));
  }
  return scale;
}

function validateTriangleIndices(indices: readonly number[], vertexCount: number): void {
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    generationFailure('Triangle index is outside the position buffer');
  }
}

export function classifyTrianglePair(
  positions: Float32Array,
  leftIndices: readonly [number, number, number],
  rightIndices: readonly [number, number, number],
): TrianglePairClassification | null {
  return guarded('Triangle-pair classification', () => {
    const scale = finiteFloat32Scale(positions);
    const vertexCount = positions.length / 3;
    validateTriangleIndices([...leftIndices, ...rightIndices], vertexCount);
    const { weldedForVertex } = weldFloat32Positions(positions);
    const left = triangleFromBuffer(0, leftIndices, positions, weldedForVertex);
    const right = triangleFromBuffer(1, rightIndices, positions, weldedForVertex);
    const areaGate = (scale * 1e-10) ** 2;
    for (const triangle of [left, right]) {
      if (new Set(triangle.vertices).size !== 3
        || Math.hypot(...cross(subtract(triangle.points[1], triangle.points[0]), subtract(triangle.points[2], triangle.points[0]))) <= areaGate) {
        generationFailure('Malformed zero-area triangle pair input');
      }
    }
    const lengthEpsilon = Math.max(scale * Number.EPSILON * 2048, Number.MIN_VALUE);
    const predicateAreaEpsilon = Math.max(scale * scale * Number.EPSILON * 4096, Number.MIN_VALUE);
    return trianglesConflict(left, right, lengthEpsilon, predicateAreaEpsilon);
  });
}

export function collectAabbCandidatePairs(input: ClosedSolidInput): readonly (readonly [number, number])[] {
  return guarded('AABB candidate collection', () => {
    const scale = finiteFloat32Scale(input.positions);
    if (!(input.indices instanceof Uint16Array || input.indices instanceof Uint32Array)
      || input.indices.length === 0 || input.indices.length % 3 !== 0) {
      generationFailure('Malformed triangle index buffer');
    }
    validateTriangleIndices([...input.indices], input.positions.length / 3);
    const identity = Array.from({ length: input.positions.length / 3 }, (_, index) => index);
    const triangles = Array.from({ length: input.indices.length / 3 }, (_, triangle) => triangleFromBuffer(
      triangle,
      [input.indices[triangle * 3], input.indices[triangle * 3 + 1], input.indices[triangle * 3 + 2]],
      input.positions,
      identity,
    ));
    const lengthEpsilon = Math.max(scale * Number.EPSILON * 2048, Number.MIN_VALUE);
    const tree = buildAabbTree(triangles);
    return Object.freeze(collectAabbPairs(tree.root, lengthEpsilon).pairs.map(([left, right]) => Object.freeze([left.index, right.index] as const)));
  });
}

function validateImplementation(input: ClosedSolidInput): ClosedSolidDiagnostics {
  const { positions, indices } = input;
  if (!(positions instanceof Float32Array) || !(indices instanceof Uint16Array || indices instanceof Uint32Array)) {
    generationFailure('Closed-solid validation requires Float32 positions and Uint16/Uint32 indices');
  }
  if (positions.length === 0 || positions.length % 3 !== 0 || indices.length === 0 || indices.length % 3 !== 0) {
    generationFailure('Malformed triangle buffers');
  }
  const scale = finiteFloat32Scale(positions);
  const vertexCount = positions.length / 3;
  for (const index of indices) if (index >= vertexCount) generationFailure('Triangle index is outside the position buffer');
  const { weldedForVertex, weldedPoints } = weldFloat32Positions(positions);
  const triangleCount = indices.length / 3;
  const areaGate = (scale * 1e-10) ** 2;
  const edgeIncidents = new Map<string, { triangle: number; from: number; to: number }[]>();
  const duplicateTriangles = new Set<string>();
  const triangles: Triangle[] = [];
  let signedVolume = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const source = [indices[triangle * 3], indices[triangle * 3 + 1], indices[triangle * 3 + 2]] as const;
    const built = triangleFromBuffer(triangle, source, positions, weldedForVertex);
    const { vertices, points } = built;
    const normal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
    const area2 = Math.hypot(...normal);
    if (!Number.isFinite(area2) || area2 <= areaGate) generationFailure(`Zero-area triangle ${triangle} at Float32 scale gate ${areaGate}`);
    const key = triangleKey(...vertices);
    if (duplicateTriangles.has(key)) generationFailure(`Duplicate triangle ${triangle}/${key}`);
    duplicateTriangles.add(key);
    for (const [from, to] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]] as const) {
      const keyValue = edgeKey(from, to);
      edgeIncidents.set(keyValue, [...(edgeIncidents.get(keyValue) ?? []), { triangle, from, to }]);
    }
    signedVolume += dot(points[0], cross(points[1], points[2])) / 6;
    triangles.push(built);
  }
  const adjacency = Array.from({ length: triangleCount }, () => [] as number[]);
  for (const [key, incidents] of edgeIncidents) {
    if (incidents.length === 1) generationFailure(`Open edge ${key}`);
    if (incidents.length > 2) generationFailure(`Non-manifold edge ${key}: ${incidents.length} incidents`);
    const [left, right] = incidents;
    if (left.from === right.from && left.to === right.to) generationFailure(`Same winding on welded edge ${key}`);
    adjacency[left.triangle].push(right.triangle); adjacency[right.triangle].push(left.triangle);
  }
  let connectedComponents = 0;
  const visited = new Uint8Array(triangleCount);
  for (let start = 0; start < triangleCount; start += 1) if (visited[start] === 0) {
    connectedComponents += 1;
    const pending = [start]; visited[start] = 1;
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of adjacency[current]) if (visited[neighbor] === 0) { visited[neighbor] = 1; pending.push(neighbor); }
    }
  }
  if (connectedComponents !== 1) generationFailure(`Expected exactly one connected component, found ${connectedComponents}`);
  const volumeGate = (scale * 1e-8) ** 3;
  if (!Number.isFinite(signedVolume) || signedVolume <= volumeGate) {
    generationFailure(`Expected finite positive signed volume above ${volumeGate}, found ${signedVolume}`);
  }

  // These dimensional error bounds cover only accumulated Float64 predicate
  // roundoff. They remain orders of magnitude below one Float32 coordinate ULP
  // and never participate in vertex identity or welding.
  const lengthEpsilon = Math.max(scale * Number.EPSILON * 2048, Number.MIN_VALUE);
  const predicateAreaEpsilon = Math.max(scale * scale * Number.EPSILON * 4096, Number.MIN_VALUE);
  const tree = buildAabbTree(triangles);
  const broadPhase = collectAabbPairs(tree.root, lengthEpsilon);
  const intersectionCandidates = broadPhase.pairs.length;
  let firstProperConflict: { conflict: string; left: number; right: number } | null = null;
  for (const [candidate, current] of broadPhase.pairs) {
    const conflict = trianglesConflict(candidate, current, lengthEpsilon, predicateAreaEpsilon);
    if (conflict === 'coplanar overlap') generationFailure(`Triangle ${conflict}: ${candidate.index}/${current.index}`);
    if (conflict && !firstProperConflict) firstProperConflict = { conflict, left: candidate.index, right: current.index };
  }
  if (firstProperConflict) {
    generationFailure(`Triangle ${firstProperConflict.conflict}: ${firstProperConflict.left}/${firstProperConflict.right}`);
  }
  return Object.freeze({
    vertexCount,
    weldedVertexCount: weldedPoints.length,
    triangleCount,
    connectedComponents,
    signedVolume,
    broadPhase: 'longest-axis-bvh',
    bvhNodeCount: tree.nodeCount,
    bvhLeafCount: tree.leafCount,
    bvhMaxDepth: tree.maxDepth,
    broadPhaseNodePairsTested: broadPhase.nodePairsTested,
    intersectionCandidates,
    intersectionPairsTested: intersectionCandidates,
  });
}

export function validateClosedSolid(input: ClosedSolidInput): ClosedSolidDiagnostics {
  return guarded('Closed-solid validation', () => validateImplementation(input));
}

export function extractBoundaryMesh(complex: ClippedVolumeComplex): GroupedBoundaryMesh {
  return guarded('Boundary extraction', () => extractionImplementation(complex));
}
