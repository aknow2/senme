import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  createLithophaneTileGeometry,
  type LithophaneTileOptions,
  type TileBrightnessSampler,
} from './lithophaneTile';
import {
  insetSphericalTileOutline,
  type SpiralTileDescriptor,
} from './spiralTiles';

export type SphericalPanelTile = Readonly<{
  descriptor: SpiralTileDescriptor;
  brightnessSampler?: TileBrightnessSampler;
}>;

export type SphericalPanelOptions = Readonly<
  Omit<LithophaneTileOptions, 'brightnessSampler'> & {
    backingThicknessMm: number;
    glueAllowanceMm?: number;
  }
>;

type Point2 = Readonly<{ x: number; y: number }>;

type TileFrame = Readonly<{
  rotation: THREE.Quaternion;
  inverseRotation: THREE.Quaternion;
  outerPlaneZ: number;
  centerX: number;
  centerY: number;
}>;

type OpenTileBoundary = Readonly<{
  local: Point2[];
  world: THREE.Vector3[];
}>;

type PanelEdge = Readonly<{
  start: THREE.Vector3;
  end: THREE.Vector3;
}>;

const BASE_EPSILON = 1e-5;
const PANEL_RELIEF_EDGE_INSET_MM = 0.15;
export const MINIMUM_PANEL_GROOVE_DEPTH_MM = 0.01;
const MAXIMUM_THICKNESS_SAMPLER: TileBrightnessSampler = {
  sampleBrightness: () => 0,
};
// Match the 1e-5 mm vertex welding used for the published panel geometry.
const EDGE_KEY_DIGITS = 5;

function signedArea(points: readonly Point2[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea * 0.5;
}

function convexHullIndices(points: readonly Point2[]): number[] {
  const sorted = points.map((point, index) => ({ point, index })).sort((left, right) => (
    left.point.x - right.point.x || left.point.y - right.point.y
  ));
  const unique = sorted.filter((entry, index) => (
    index === 0
    || Math.hypot(
      entry.point.x - sorted[index - 1].point.x,
      entry.point.y - sorted[index - 1].point.y,
    ) > 1e-6
  ));
  if (unique.length < 3) throw new Error('Spherical panel glue flange outline is degenerate.');
  const cross = (a: Point2, b: Point2, c: Point2): number => (
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  );
  const half = (entries: typeof unique): typeof unique => {
    const result: typeof unique = [];
    for (const entry of entries) {
      while (
        result.length >= 2
        && cross(result[result.length - 2].point, result[result.length - 1].point, entry.point) <= 1e-7
      ) result.pop();
      result.push(entry);
    }
    return result;
  };
  const lower = half(unique);
  const upper = half([...unique].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(({ index }) => index);
}

function pointKey(point: THREE.Vector3): string {
  return `${point.x.toFixed(EDGE_KEY_DIGITS)}:${point.y.toFixed(EDGE_KEY_DIGITS)}:${point.z.toFixed(EDGE_KEY_DIGITS)}`;
}

function edgeKey(start: THREE.Vector3, end: THREE.Vector3): string {
  const startKey = pointKey(start);
  const endKey = pointKey(end);
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function appendTriangle(
  positions: number[],
  indices: number[],
  triangle: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
): void {
  const offset = positions.length / 3;
  for (const point of triangle) positions.push(point.x, point.y, point.z);
  indices.push(offset, offset + 1, offset + 2);
}

function radiallyOrientedTriangle(
  triangle: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  outward: boolean,
): readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const normal = new THREE.Vector3().crossVectors(
    triangle[1].clone().sub(triangle[0]),
    triangle[2].clone().sub(triangle[0]),
  );
  const radial = triangle[0].clone().add(triangle[1]).add(triangle[2]);
  const currentlyOutward = normal.dot(radial) >= 0;
  return currentlyOutward === outward ? triangle : [triangle[0], triangle[2], triangle[1]];
}

function appendRadiallyOrientedTriangle(
  positions: number[],
  indices: number[],
  triangle: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  outward: boolean,
): void {
  appendTriangle(positions, indices, radiallyOrientedTriangle(triangle, outward));
}

function createTileFrame(descriptor: SpiralTileDescriptor): TileFrame {
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    descriptor.outwardCenter.clone().normalize(),
    new THREE.Vector3(0, 0, 1),
  );
  const rotated = descriptor.outline.map((vertex) => (
    vertex.position.clone().applyQuaternion(rotation)
  ));
  const outerPlaneZ = rotated.reduce((sum, point) => sum + point.z, 0) / rotated.length;
  const xs = rotated.map((point) => point.x);
  const ys = rotated.map((point) => point.y);
  return {
    rotation,
    inverseRotation: rotation.clone().invert(),
    outerPlaneZ,
    centerX: (Math.min(...xs) + Math.max(...xs)) * 0.5,
    centerY: (Math.min(...ys) + Math.max(...ys)) * 0.5,
  };
}

function localDirection(frame: TileFrame, point: Point2): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, frame.outerPlaneZ)
    .applyQuaternion(frame.inverseRotation)
    .normalize();
}

function translatedFlatPoint(frame: TileFrame, position: THREE.Vector3): Point2 {
  return {
    x: position.x + frame.centerX,
    y: position.y + frame.centerY,
  };
}

function constrainPointToConvexPolygon(point: Point2, polygon: readonly Point2[]): Point2 {
  const orientation = Math.sign(signedArea(polygon));
  const isInside = polygon.every((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const cross = (end.x - start.x) * (point.y - start.y)
      - (end.y - start.y) * (point.x - start.x);
    return cross * orientation >= -1e-8;
  });
  if (isInside) return point;

  let closest = polygon[0];
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared <= 1e-12
      ? 0
      : THREE.MathUtils.clamp(
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
        0,
        1,
      );
    const candidate = { x: start.x + dx * amount, y: start.y + dy * amount };
    const distanceSquared = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
    if (distanceSquared < closestDistanceSquared) {
      closest = candidate;
      closestDistanceSquared = distanceSquared;
    }
  }
  const centroidSum = polygon.reduce(
    (sum, candidate) => ({ x: sum.x + candidate.x, y: sum.y + candidate.y }),
    { x: 0, y: 0 },
  );
  const centroidX = centroidSum.x / polygon.length;
  const centroidY = centroidSum.y / polygon.length;
  const inwardX = centroidX - closest.x;
  const inwardY = centroidY - closest.y;
  const inwardLength = Math.hypot(inwardX, inwardY);
  if (inwardLength <= 1e-12) return closest;
  return {
    x: closest.x + (inwardX / inwardLength) * 1e-4,
    y: closest.y + (inwardY / inwardLength) * 1e-4,
  };
}

function orderBoundaryLoop(edges: readonly (readonly [number, number])[]): number[] {
  if (edges.length < 3) throw new Error('A spherical panel tile has no closed backing boundary.');
  const nextByStart = new Map<number, number>();
  for (const [start, end] of edges) {
    if (nextByStart.has(start)) {
      throw new Error('A spherical panel tile has a branched backing boundary.');
    }
    nextByStart.set(start, end);
  }
  const first = edges[0][0];
  const ordered = [first];
  let current = first;
  for (let index = 0; index < edges.length; index += 1) {
    const next = nextByStart.get(current);
    if (next === undefined) throw new Error('A spherical panel tile has an open backing boundary.');
    if (next === first) {
      if (index !== edges.length - 1) {
        throw new Error('A spherical panel tile has multiple backing boundaries.');
      }
      return ordered;
    }
    ordered.push(next);
    current = next;
  }
  throw new Error('A spherical panel tile backing boundary did not close.');
}

function appendCurvedTileRelief(
  positions: number[],
  indices: number[],
  tile: SphericalPanelTile,
  options: SphericalPanelOptions,
): OpenTileBoundary {
  const { descriptor } = tile;
  const frame = createTileFrame(descriptor);
  const assemblyLocal = descriptor.assemblyOutline.map((vertex) => {
    const position = vertex.position.clone().applyQuaternion(frame.rotation);
    return { x: position.x, y: position.y };
  });
  const reliefPositions = insetSphericalTileOutline(
    descriptor.outline.map(({ position }) => position),
    descriptor.outwardCenter,
    descriptor.outerRadius,
    PANEL_RELIEF_EDGE_INSET_MM,
  );
  const reliefOutline = reliefPositions.map((position, index) => ({
    position,
    uv: descriptor.outline[index].uv,
  }));
  const flat = createLithophaneTileGeometry(
    reliefOutline,
    descriptor.outwardCenter,
    {
      minThicknessMm: options.minThicknessMm,
      maxThicknessMm: options.maxThicknessMm,
      rimThicknessMm: tile.brightnessSampler
        ? options.rimThicknessMm
        : options.maxThicknessMm,
      rimWidthMm: options.rimWidthMm,
      targetEdgeMm: options.targetEdgeMm,
      // Use the same tessellated topology for untextured panel tiles. The
      // former coarse fan could omit a short clipped polar edge, while a black
      // sampler preserves the exact uniformly-maximum-thickness surface.
      brightnessSampler: tile.brightnessSampler ?? MAXIMUM_THICKNESS_SAMPLER,
      contrast: options.contrast,
      brightnessCurve: options.brightnessCurve,
    },
  );
  try {
    const position = flat.getAttribute('position');
    const geometryIndex = flat.getIndex();
    if (!geometryIndex) throw new Error('A spherical panel tile requires indexed relief geometry.');

    const transformed = new Map<number, THREE.Vector3>();
    const curvedPoint = (vertexIndex: number): THREE.Vector3 => {
      const cached = transformed.get(vertexIndex);
      if (cached) return cached;
      const source = new THREE.Vector3(
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
      );
      const translated = translatedFlatPoint(frame, source);
      const local = source.z <= BASE_EPSILON
        ? constrainPointToConvexPolygon(translated, assemblyLocal)
        : translated;
      const thickness = source.z <= BASE_EPSILON
        ? options.backingThicknessMm
        : source.z;
      const targetRadius = descriptor.outerRadius - options.maxThicknessMm + thickness;
      const result = localDirection(frame, local).multiplyScalar(targetRadius);
      transformed.set(vertexIndex, result);
      return result;
    };

    const keptTriangles: Array<readonly [number, number, number]> = [];
    const indexArray = geometryIndex.array;
    for (let offset = 0; offset < indexArray.length; offset += 3) {
      const triangle = [
        Number(indexArray[offset]),
        Number(indexArray[offset + 1]),
        Number(indexArray[offset + 2]),
      ] as const;
      if (triangle.every((vertexIndex) => position.getZ(vertexIndex) <= BASE_EPSILON)) continue;
      keptTriangles.push(triangle);
      appendTriangle(
        positions,
        indices,
        triangle.map(curvedPoint) as [THREE.Vector3, THREE.Vector3, THREE.Vector3],
      );
    }

    const edgeIncidence = new Map<string, { count: number; directed: readonly [number, number] }>();
    for (const triangle of keptTriangles) {
      const directedEdges = [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]],
      ] as const;
      for (const directed of directedEdges) {
        const key = directed[0] < directed[1]
          ? `${directed[0]}:${directed[1]}`
          : `${directed[1]}:${directed[0]}`;
        const existing = edgeIncidence.get(key);
        if (existing) existing.count += 1;
        else edgeIncidence.set(key, { count: 1, directed });
      }
    }
    const boundaryEdges = [...edgeIncidence.values()]
      .filter(({ count }) => count === 1)
      .map(({ directed }) => directed);
    if (boundaryEdges.some(([start, end]) => (
      position.getZ(start) > BASE_EPSILON || position.getZ(end) > BASE_EPSILON
    ))) {
      throw new Error('A spherical panel tile relief has a non-backing open edge.');
    }
    const ordered = orderBoundaryLoop(boundaryEdges);
    return {
      local: ordered.map((vertexIndex) => constrainPointToConvexPolygon(
        translatedFlatPoint(frame, new THREE.Vector3(
          position.getX(vertexIndex),
          position.getY(vertexIndex),
          position.getZ(vertexIndex),
        )),
        assemblyLocal,
      )),
      world: ordered.map(curvedPoint),
    };
  } finally {
    flat.dispose();
  }
}

function appendBackingSurfaces(
  positions: number[],
  indices: number[],
  descriptor: SpiralTileDescriptor,
  boundary: OpenTileBoundary,
  options: SphericalPanelOptions,
  innerExtensionMm: number,
): void {
  const frame = createTileFrame(descriptor);
  let outerLocal = descriptor.assemblyOutline.map((vertex) => {
    const position = vertex.position.clone().applyQuaternion(frame.rotation);
    return { x: position.x, y: position.y };
  });
  const reverseAssembly = signedArea(outerLocal) < 0;
  if (reverseAssembly) outerLocal = [...outerLocal].reverse();

  const holeLocal = [...boundary.local];
  const holeWorld = [...boundary.world];
  if (signedArea(holeLocal) < 0) {
    holeLocal.reverse();
    holeWorld.reverse();
  }

  const outerRadius = descriptor.outerRadius - options.maxThicknessMm + options.backingThicknessMm;
  let assemblyDirections = descriptor.assemblyOutline.map((vertex) => (
    vertex.position.clone().normalize()
  ));
  if (reverseAssembly) assemblyDirections = [...assemblyDirections].reverse();
  const outerWorld = assemblyDirections.map((direction) => direction.clone().multiplyScalar(outerRadius));
  if (outerLocal.length < 3 || holeLocal.length < 3) {
    throw new Error('A spherical panel tile backing annulus could not be triangulated.');
  }

  // Both loops are convex and enclose the same center. Zippering them in
  // angular order ensures every finely sampled groove vertex is connected to
  // an outer vertex. A generic polygon-with-hole triangulator may instead emit
  // triangles made from three collinear groove samples, which collapse after
  // the spherical coordinates are rounded to Float32 for STL export.
  const centerSum = holeLocal.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  const center = {
    x: centerSum.x / holeLocal.length,
    y: centerSum.y / holeLocal.length,
  };
  const angularLoop = (local: readonly Point2[], world: readonly THREE.Vector3[]) => (
    local.map((point, index) => ({
      angle: Math.atan2(point.y - center.y, point.x - center.x),
      world: world[index],
    })).sort((left, right) => left.angle - right.angle)
  );
  const outerLoop = angularLoop(outerLocal, outerWorld);
  const holeLoop = angularLoop(holeLocal, holeWorld);
  const nextAngle = (loop: readonly { angle: number }[], step: number): number => (
    step + 1 < loop.length ? loop[step + 1].angle : loop[0].angle + Math.PI * 2
  );
  let outerStep = 0;
  let holeStep = 0;
  while (outerStep < outerLoop.length || holeStep < holeLoop.length) {
    const outer = outerLoop[outerStep % outerLoop.length];
    const hole = holeLoop[holeStep % holeLoop.length];
    if (
      outerStep < outerLoop.length
      && (holeStep >= holeLoop.length
        || nextAngle(outerLoop, outerStep) <= nextAngle(holeLoop, holeStep))
    ) {
      const nextOuter = outerLoop[(outerStep + 1) % outerLoop.length];
      appendTriangle(
        positions,
        indices,
        [outer.world, nextOuter.world, hole.world],
      );
      outerStep += 1;
    } else {
      const nextHole = holeLoop[(holeStep + 1) % holeLoop.length];
      appendTriangle(
        positions,
        indices,
        [outer.world, nextHole.world, hole.world],
      );
      holeStep += 1;
    }
  }

  const innerRadius = descriptor.outerRadius - options.maxThicknessMm;
  if (innerExtensionMm <= 0) {
    const innerWorld = assemblyDirections.map((direction) => (
      direction.clone().multiplyScalar(innerRadius)
    ));
    const innerTriangles = THREE.ShapeUtils.triangulateShape(
      outerLocal.map(({ x, y }) => new THREE.Vector2(x, y)),
      [],
    );
    for (const triangle of innerTriangles) {
      appendRadiallyOrientedTriangle(
        positions,
        indices,
        triangle.map((index) => innerWorld[index]) as [THREE.Vector3, THREE.Vector3, THREE.Vector3],
        false,
      );
    }
    return;
  }

  const insetPositions = insetSphericalTileOutline(
    descriptor.assemblyOutline.map(({ position }) => position),
    descriptor.outwardCenter,
    descriptor.outerRadius,
    PANEL_RELIEF_EDGE_INSET_MM,
  );
  const rawInsetDirections = insetPositions.map((position) => position.clone().normalize());
  const rawInsetLocal = insetPositions.map((position) => {
    const local = position.clone().applyQuaternion(frame.rotation);
    return { x: local.x, y: local.y };
  });
  const hullIndices = convexHullIndices(rawInsetLocal);
  const insetDirections = hullIndices.map((index) => rawInsetDirections[index]);
  const insetLocal = hullIndices.map((index) => rawInsetLocal[index]);
  const deepRadius = innerRadius - innerExtensionMm;
  const outerDeep = assemblyDirections.map((direction) => direction.clone().multiplyScalar(deepRadius));
  const insetDeep = insetDirections.map((direction) => direction.clone().multiplyScalar(deepRadius));
  const insetInner = insetDirections.map((direction) => direction.clone().multiplyScalar(innerRadius));

  const centralTriangles = THREE.ShapeUtils.triangulateShape(
    insetLocal.map(({ x, y }) => new THREE.Vector2(x, y)),
    [],
  );
  for (const [first, second, third] of centralTriangles) {
    appendTriangle(positions, indices, [
      insetInner[first],
      insetInner[third],
      insetInner[second],
    ]);
  }
  const flangeCenter = insetLocal.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  flangeCenter.x /= insetLocal.length;
  flangeCenter.y /= insetLocal.length;
  const angularGlueLoop = (local: readonly Point2[], world: readonly THREE.Vector3[]) => (
    local.map((point, index) => ({
      angle: Math.atan2(point.y - flangeCenter.y, point.x - flangeCenter.x),
      world: world[index],
    })).sort((left, right) => left.angle - right.angle)
  );
  const deepOuterLoop = angularGlueLoop(outerLocal, outerDeep);
  const deepInsetLoop = angularGlueLoop(insetLocal, insetDeep);
  const nextGlueAngle = (loop: readonly { angle: number }[], step: number): number => (
    step + 1 < loop.length ? loop[step + 1].angle : loop[0].angle + Math.PI * 2
  );
  let deepOuterStep = 0;
  let insetStep = 0;
  while (deepOuterStep < deepOuterLoop.length || insetStep < deepInsetLoop.length) {
    const outer = deepOuterLoop[deepOuterStep % deepOuterLoop.length];
    const inset = deepInsetLoop[insetStep % deepInsetLoop.length];
    if (
      deepOuterStep < deepOuterLoop.length
      && (insetStep >= deepInsetLoop.length
        || nextGlueAngle(deepOuterLoop, deepOuterStep) <= nextGlueAngle(deepInsetLoop, insetStep))
    ) {
      const nextOuter = deepOuterLoop[(deepOuterStep + 1) % deepOuterLoop.length];
      appendRadiallyOrientedTriangle(
        positions,
        indices,
        [outer.world, nextOuter.world, inset.world],
        false,
      );
      deepOuterStep += 1;
    } else {
      const nextInset = deepInsetLoop[(insetStep + 1) % deepInsetLoop.length];
      appendRadiallyOrientedTriangle(
        positions,
        indices,
        [outer.world, nextInset.world, inset.world],
        false,
      );
      insetStep += 1;
    }
  }

  for (let index = 0; index < insetDirections.length; index += 1) {
    const next = (index + 1) % insetDirections.length;
    appendTriangle(positions, indices, [insetInner[index], insetInner[next], insetDeep[next]]);
    appendTriangle(positions, indices, [insetInner[index], insetDeep[next], insetDeep[index]]);
  }
}

export function createSphericalPanelGeometry(
  tiles: readonly SphericalPanelTile[],
  options: SphericalPanelOptions,
): THREE.BufferGeometry {
  if (tiles.length === 0) throw new Error('A spherical panel requires at least one tile.');
  const rimThicknessMm = options.rimThicknessMm ?? options.maxThicknessMm;
  if (!(options.backingThicknessMm > 0 && options.backingThicknessMm <= rimThicknessMm)) {
    throw new Error('Spherical panel backing thickness must be greater than 0 and no greater than rim thickness.');
  }
  // Exactly coplanar relief rims and backing annuli can intersect after their
  // independent triangulations are curved and rounded to Float32 for STL.
  const effectiveBackingThicknessMm = Math.min(
    options.backingThicknessMm,
    rimThicknessMm - MINIMUM_PANEL_GROOVE_DEPTH_MM,
  );
  const panelOptions: SphericalPanelOptions = {
    ...options,
    backingThicknessMm: effectiveBackingThicknessMm,
  };
  const radius = tiles[0].descriptor.outerRadius;
  const glueAllowanceMm = options.glueAllowanceMm ?? 0;
  if (!(Number.isFinite(glueAllowanceMm) && glueAllowanceMm >= 0)) {
    throw new Error('Spherical panel glue allowance must be a finite non-negative thickness.');
  }
  if (radius - panelOptions.maxThicknessMm - glueAllowanceMm <= 0) {
    throw new Error('Spherical panel glue allowance reaches or crosses the sphere center.');
  }
  if (tiles.some(({ descriptor }) => Math.abs(descriptor.outerRadius - radius) > 1e-7)) {
    throw new Error('Every spherical panel tile must use the same outer radius.');
  }
  if (tiles.some(({ descriptor }) => descriptor.assemblyOutline.some(({ position }) => (
    Math.abs(Math.abs(position.y) - descriptor.outerRadius) <= 1e-7
  )))) {
    throw new Error('Spherical panel export requires non-zero top and bottom polar openings.');
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const edgeIncidence = new Map<string, { edge: PanelEdge; count: number }>();
  tiles.forEach((tile) => {
    const outline = tile.descriptor.assemblyOutline.map((vertex) => vertex.position);
    for (let index = 0; index < outline.length; index += 1) {
      const edge = { start: outline[index], end: outline[(index + 1) % outline.length] };
      const key = edgeKey(edge.start, edge.end);
      const existing = edgeIncidence.get(key);
      if (existing) existing.count += 1;
      else edgeIncidence.set(key, { edge, count: 1 });
    }
  });
  for (const { count } of edgeIncidence.values()) {
    if (count !== 1 && count !== 2) throw new Error('A spherical panel assembly edge is non-manifold.');
  }

  tiles.forEach((tile) => {
    const boundary = appendCurvedTileRelief(positions, indices, tile, panelOptions);
    appendBackingSurfaces(
      positions,
      indices,
      tile.descriptor,
      boundary,
      panelOptions,
      glueAllowanceMm,
    );
  });

  const innerRadius = radius - panelOptions.maxThicknessMm;
  const glueInnerRadius = innerRadius - glueAllowanceMm;
  const backingRadius = innerRadius + panelOptions.backingThicknessMm;
  for (const { count, edge } of edgeIncidence.values()) {
    if (count === 2) continue;
    const outerStart = edge.start.clone().setLength(backingRadius);
    const outerEnd = edge.end.clone().setLength(backingRadius);
    const innerStart = edge.start.clone().setLength(glueInnerRadius);
    const innerEnd = edge.end.clone().setLength(glueInnerRadius);
    appendTriangle(positions, indices, [outerStart, innerStart, innerEnd]);
    appendTriangle(positions, indices, [outerStart, innerEnd, outerEnd]);
  }

  const unmerged = new THREE.BufferGeometry();
  unmerged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  unmerged.setIndex(indices);
  const geometry = mergeVertices(unmerged, 1e-5);
  unmerged.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.sphericalPanel = {
    tileCount: tiles.length,
    radiusMm: radius,
    backingThicknessMm: panelOptions.backingThicknessMm,
    glueAllowanceMm,
    preservesSphereCurvature: true,
    visibleTileGrooves: true,
  };
  return geometry;
}
