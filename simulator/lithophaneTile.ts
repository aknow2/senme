import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyBrightnessCurve, applyContrast } from './src/lithophane/thickness';

export type TileOutlineVertex = Readonly<{
  position: THREE.Vector3;
  uv: THREE.Vector2;
}>;

export type TileBrightnessSampler = Readonly<{
  sampleBrightness(u: number, v: number): number;
}>;

export type LithophaneTileOptions = Readonly<{
  minThicknessMm: number;
  maxThicknessMm: number;
  rimWidthMm: number;
  rimThicknessMm?: number;
  targetEdgeMm: number;
  brightnessSampler?: TileBrightnessSampler;
  contrast?: number;
  brightnessCurve?: number;
}>;

type Point2 = Readonly<{ x: number; y: number }>;

type ProjectedVertex = Readonly<{
  point: Point2;
  maxPosition: THREE.Vector3;
  sphericalPosition: THREE.Vector3;
  uv: THREE.Vector2;
}>;

type SurfacePoint = Readonly<{
  point: Point2;
  maxPosition: THREE.Vector3;
  basePosition: THREE.Vector3;
  sideBasePosition: THREE.Vector3;
  uv: THREE.Vector2;
  forceRim: boolean;
}>;

const EPSILON = 1e-7;
const MINIMUM_OUTLINE_EDGE_MM = 0.02;
const MAXIMUM_TEXTURE_SANITIZE_EDGE_MM = 0.25;
const MINIMUM_TEXTURE_SEGMENTS = 3;

function cross2(a: Point2, b: Point2): number {
  return a.x * b.y - a.y * b.x;
}

function subtract2(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function signedArea(points: readonly Point2[]): number {
  let area2 = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area2 += current.x * next.y - next.x * current.y;
  }
  return area2 * 0.5;
}

function distance2(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sanitizePolygon(
  vertices: readonly ProjectedVertex[],
  minimumEdgeMm = MINIMUM_OUTLINE_EDGE_MM,
): ProjectedVertex[] {
  const deduplicated = [...vertices];
  let removedShortEdge = true;
  while (removedShortEdge && deduplicated.length > 3) {
    removedShortEdge = false;
    for (let index = 0; index < deduplicated.length; index += 1) {
      const previous = deduplicated[(index + deduplicated.length - 1) % deduplicated.length];
      if (distance2(deduplicated[index].point, previous.point) > minimumEdgeMm) continue;
      deduplicated.splice(index, 1);
      removedShortEdge = true;
      break;
    }
  }
  if (deduplicated.length < 3) return [];

  const result: ProjectedVertex[] = [];
  for (let index = 0; index < deduplicated.length; index += 1) {
    const previous = deduplicated[(index + deduplicated.length - 1) % deduplicated.length];
    const current = deduplicated[index];
    const next = deduplicated[(index + 1) % deduplicated.length];
    const incoming = subtract2(current.point, previous.point);
    const outgoing = subtract2(next.point, current.point);
    if (Math.abs(cross2(incoming, outgoing)) > EPSILON) result.push(current);
  }
  return result;
}

function lineIntersection(
  pointA: Point2,
  directionA: Point2,
  pointB: Point2,
  directionB: Point2,
): Point2 | null {
  const denominator = cross2(directionA, directionB);
  if (Math.abs(denominator) <= EPSILON) return null;
  const amount = cross2(subtract2(pointB, pointA), directionB) / denominator;
  return {
    x: pointA.x + directionA.x * amount,
    y: pointA.y + directionA.y * amount,
  };
}

function insetConvexPolygon(points: readonly Point2[], distanceMm: number): Point2[] | null {
  if (distanceMm <= EPSILON) return points.map((point) => ({ ...point }));
  const inset: Point2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const previousDirection = subtract2(current, previous);
    const currentDirection = subtract2(next, current);
    const previousLength = Math.hypot(previousDirection.x, previousDirection.y);
    const currentLength = Math.hypot(currentDirection.x, currentDirection.y);
    if (previousLength <= EPSILON || currentLength <= EPSILON) return null;

    const previousOffset = {
      x: previous.x - (previousDirection.y / previousLength) * distanceMm,
      y: previous.y + (previousDirection.x / previousLength) * distanceMm,
    };
    const currentOffset = {
      x: current.x - (currentDirection.y / currentLength) * distanceMm,
      y: current.y + (currentDirection.x / currentLength) * distanceMm,
    };
    const intersection = lineIntersection(
      previousOffset,
      previousDirection,
      currentOffset,
      currentDirection,
    );
    if (!intersection) return null;
    inset.push(intersection);
  }

  if (signedArea(inset) <= EPSILON) return null;
  if (inset.some((point, index) => (
    distance2(point, inset[(index + 1) % inset.length]) <= MINIMUM_OUTLINE_EDGE_MM
  ))) return null;
  for (const insetPoint of inset) {
    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
      const edgeStart = points[edgeIndex];
      const edgeEnd = points[(edgeIndex + 1) % points.length];
      if (cross2(subtract2(edgeEnd, edgeStart), subtract2(insetPoint, edgeStart)) < -EPSILON) {
        return null;
      }
    }
  }
  return inset;
}

function barycentric(point: Point2, a: Point2, b: Point2, c: Point2): readonly [number, number, number] | null {
  const v0 = subtract2(b, a);
  const v1 = subtract2(c, a);
  const v2 = subtract2(point, a);
  const denominator = cross2(v0, v1);
  if (Math.abs(denominator) <= EPSILON) return null;
  const weightB = cross2(v2, v1) / denominator;
  const weightC = cross2(v0, v2) / denominator;
  const weightA = 1 - weightB - weightC;
  return [weightA, weightB, weightC];
}

function interpolateProjectedVertex(
  point: Point2,
  polygon: readonly ProjectedVertex[],
): Pick<ProjectedVertex, 'maxPosition' | 'sphericalPosition' | 'uv'> {
  for (let index = 1; index < polygon.length - 1; index += 1) {
    const triangle = [polygon[0], polygon[index], polygon[index + 1]] as const;
    const weights = barycentric(point, triangle[0].point, triangle[1].point, triangle[2].point);
    if (!weights || weights.some((weight) => weight < -1e-5)) continue;
    const maxPosition = new THREE.Vector3();
    const sphericalPosition = new THREE.Vector3();
    const uv = new THREE.Vector2();
    triangle.forEach((vertex, vertexIndex) => {
      maxPosition.addScaledVector(vertex.maxPosition, weights[vertexIndex]);
      sphericalPosition.addScaledVector(vertex.sphericalPosition, weights[vertexIndex]);
      uv.addScaledVector(vertex.uv, weights[vertexIndex]);
    });
    return { maxPosition, sphericalPosition, uv };
  }

  let nearest = polygon[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const vertex of polygon) {
    const candidateDistance = distance2(point, vertex.point);
    if (candidateDistance < nearestDistance) {
      nearest = vertex;
      nearestDistance = candidateDistance;
    }
  }
  return {
    maxPosition: nearest.maxPosition.clone(),
    sphericalPosition: nearest.sphericalPosition.clone(),
    uv: nearest.uv.clone(),
  };
}

function sampleLoop(
  points: readonly Point2[],
  edgeSegments: readonly number[],
): Point2[] {
  const result: Point2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const segments = edgeSegments[index];
    for (let step = 0; step < segments; step += 1) {
      const amount = step / segments;
      result.push({
        x: THREE.MathUtils.lerp(current.x, next.x, amount),
        y: THREE.MathUtils.lerp(current.y, next.y, amount),
      });
    }
  }
  return result;
}

function polygonCentroid(points: readonly Point2[]): Point2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const direction = subtract2(end, start);
  const lengthSquared = direction.x * direction.x + direction.y * direction.y;
  if (lengthSquared <= EPSILON) return distance2(point, start);
  const amount = THREE.MathUtils.clamp(
    ((point.x - start.x) * direction.x + (point.y - start.y) * direction.y) / lengthSquared,
    0,
    1,
  );
  return distance2(point, {
    x: start.x + direction.x * amount,
    y: start.y + direction.y * amount,
  });
}

function isOnPolygonBoundary(point: Point2, polygon: readonly Point2[]): boolean {
  return polygon.some((start, index) => (
    distanceToSegment(point, start, polygon[(index + 1) % polygon.length]) <= 1e-5
  ));
}

export function sampleTileBrightness(
  sampler: TileBrightnessSampler,
  u: number,
  v: number,
): number {
  // CanvasTexture uses the conventional UV origin at the lower-left after
  // upload. ImageData starts at the upper-left, so invert V for STL sampling.
  const clampedU = THREE.MathUtils.clamp(u, 0, 1 - 1e-7);
  const imageV = THREE.MathUtils.clamp(1 - v, 0, 1);
  return sampler.sampleBrightness(clampedU, imageV);
}

export function brightnessToTileThicknessMm(
  brightness01: number,
  options: Pick<LithophaneTileOptions, 'minThicknessMm' | 'maxThicknessMm' | 'contrast' | 'brightnessCurve'>,
): number {
  const contrasted = applyContrast(brightness01, options.contrast ?? 1);
  const curved = applyBrightnessCurve(contrasted, options.brightnessCurve ?? 0.6);
  return THREE.MathUtils.lerp(options.maxThicknessMm, options.minThicknessMm, curved);
}

function appendTriangle(
  positions: number[],
  indices: number[],
  points: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  positiveZ: boolean,
): void {
  const ordered = positiveZ ? points : [points[0], points[2], points[1]] as const;
  const offset = positions.length / 3;
  for (const point of ordered) positions.push(point.x, point.y, point.z);
  indices.push(offset, offset + 1, offset + 2);
}

function appendTriangleInOrder(
  positions: number[],
  indices: number[],
  points: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
): void {
  const offset = positions.length / 3;
  for (const point of points) positions.push(point.x, point.y, point.z);
  indices.push(offset, offset + 1, offset + 2);
}

function appendSurfaceCell(
  positions: number[],
  indices: number[],
  topPositions: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3],
): void {
  appendTriangle(positions, indices, topPositions, true);
}

export function createLithophaneTileGeometry(
  outline: readonly TileOutlineVertex[],
  outwardCenter: THREE.Vector3,
  options: LithophaneTileOptions,
): THREE.BufferGeometry {
  if (!(options.minThicknessMm > 0 && options.minThicknessMm < options.maxThicknessMm)) {
    throw new Error('Lithophane minimum thickness must be greater than 0 and less than maximum thickness.');
  }
  const rimThicknessMm = options.rimThicknessMm ?? options.maxThicknessMm;
  if (!(rimThicknessMm >= options.minThicknessMm && rimThicknessMm <= options.maxThicknessMm)) {
    throw new Error('Lithophane rim thickness must be between minimum and maximum thickness.');
  }
  if (outline.length < 3) throw new Error('A tile requires at least three outline vertices.');

  const rotation = new THREE.Quaternion().setFromUnitVectors(
    outwardCenter.clone().normalize(),
    new THREE.Vector3(0, 0, 1),
  );
  const rotatedOutline = outline.map((vertex) => ({
    position: vertex.position.clone().applyQuaternion(rotation),
    uv: vertex.uv,
  }));
  const outerPlaneZ = rotatedOutline.reduce(
    (sum, vertex) => sum + vertex.position.z,
    0,
  ) / rotatedOutline.length;
  const targetEdgeMm = Math.max(0.25, options.targetEdgeMm);
  const sanitizeEdgeMm = options.brightnessSampler
    ? Math.max(
      MINIMUM_OUTLINE_EDGE_MM,
      Math.min(MAXIMUM_TEXTURE_SANITIZE_EDGE_MM, targetEdgeMm * 0.5),
    )
    : MINIMUM_OUTLINE_EDGE_MM;
  let polygon = sanitizePolygon(outline.map((vertex): ProjectedVertex => {
    const sphericalPosition = vertex.position.clone().applyQuaternion(rotation);
    const maxPosition = new THREE.Vector3(
      sphericalPosition.x,
      sphericalPosition.y,
      outerPlaneZ,
    );
    return {
      point: { x: maxPosition.x, y: maxPosition.y },
      maxPosition,
      sphericalPosition,
      uv: vertex.uv.clone(),
    };
  }), sanitizeEdgeMm);
  if (polygon.length < 3) throw new Error('The tile outline is degenerate.');
  if (signedArea(polygon.map((vertex) => vertex.point)) < 0) polygon = [...polygon].reverse();

  const polygonPoints = polygon.map((vertex) => vertex.point);
  const requestedRimWidth = Math.max(0, options.rimWidthMm);

  type InsetCandidate = Readonly<{
    points: Point2[];
    rimWidthMm: number;
    idealSegments: number;
    safeSegments: number;
  }>;
  const insetCandidate = (rimWidthMm: number): InsetCandidate | null => {
    if (rimWidthMm <= EPSILON) return null;
    const points = insetConvexPolygon(polygonPoints, rimWidthMm);
    if (!points) return null;
    const edgeLengths = polygonPoints.flatMap((point, index) => {
      const next = polygonPoints[(index + 1) % polygonPoints.length];
      return [
        distance2(point, next),
        distance2(points[index], points[(index + 1) % points.length]),
      ];
    });
    const idealSegments = Math.max(
      1,
      Math.ceil(Math.max(...edgeLengths) / targetEdgeMm),
    );
    // The comparison in the old all-or-nothing fallback was strict: an edge
    // segment exactly at the minimum was also unsafe. Preserve that boundary
    // while allowing the subdivision count to be reduced for narrow fragments.
    const safeSegments = Math.max(
      0,
      Math.ceil(Math.min(...edgeLengths) / MINIMUM_OUTLINE_EDGE_MM) - 1,
    );
    return { points, rimWidthMm, idealSegments, safeSegments };
  };

  let selectedInset = insetCandidate(requestedRimWidth);
  if (
    options.brightnessSampler
    && requestedRimWidth > EPSILON
    && (!selectedInset || selectedInset.safeSegments < selectedInset.idealSegments)
  ) {
    const minimumAdaptiveRimWidth = Math.min(
      requestedRimWidth,
      MINIMUM_OUTLINE_EDGE_MM,
    );
    const minimumInset = insetCandidate(minimumAdaptiveRimWidth);
    if (minimumInset && minimumInset.safeSegments >= MINIMUM_TEXTURE_SEGMENTS) {
      selectedInset = minimumInset;
      if (minimumInset.safeSegments >= minimumInset.idealSegments) {
        let lowerWidth = minimumAdaptiveRimWidth;
        let upperWidth = requestedRimWidth;
        for (let iteration = 0; iteration < 16; iteration += 1) {
          const candidateWidth = (lowerWidth + upperWidth) * 0.5;
          const candidate = insetCandidate(candidateWidth);
          if (candidate && candidate.safeSegments >= candidate.idealSegments) {
            selectedInset = candidate;
            lowerWidth = candidateWidth;
          } else {
            upperWidth = candidateWidth;
          }
        }
      }
    } else {
      selectedInset = null;
    }
  }
  const insetPoints = selectedInset?.points ?? null;
  const segmentsPerEdge = selectedInset
    ? Math.max(
      MINIMUM_TEXTURE_SEGMENTS,
      Math.min(selectedInset.idealSegments, selectedInset.safeSegments),
    )
    : 1;
  const hasVariableInterior = Boolean(options.brightnessSampler);
  const edgeSegments = insetPoints
    ? polygonPoints.map(() => segmentsPerEdge)
    : polygonPoints.map((point, index) => Math.max(
      1,
      Math.ceil(distance2(point, polygonPoints[(index + 1) % polygonPoints.length]) / targetEdgeMm),
    ));
  const outerLoop = sampleLoop(polygonPoints, edgeSegments);
  const innerRimLoop = insetPoints ? sampleLoop(insetPoints, edgeSegments) : null;
  const maximumSideBevelInset = options.brightnessSampler
    ? selectedInset?.rimWidthMm ? selectedInset.rimWidthMm * 0.5 : 0
    : Number.POSITIVE_INFINITY;

  const toSurfacePoint = (point: Point2, forceRim = false): SurfacePoint => {
    const interpolated = interpolateProjectedVertex(point, polygon);
    const radial = interpolated.sphericalPosition.clone().normalize();
    const basePosition = interpolated.maxPosition.clone().add(
      new THREE.Vector3(0, 0, -options.maxThicknessMm),
    );
    const sideBasePosition = interpolated.maxPosition.clone().addScaledVector(
      radial,
      -options.maxThicknessMm,
    );
    sideBasePosition.z = basePosition.z;
    const sideBevelOffset = new THREE.Vector2(
      sideBasePosition.x - basePosition.x,
      sideBasePosition.y - basePosition.y,
    );
    if (sideBevelOffset.length() > maximumSideBevelInset) {
      sideBevelOffset.setLength(maximumSideBevelInset);
      sideBasePosition.x = basePosition.x + sideBevelOffset.x;
      sideBasePosition.y = basePosition.y + sideBevelOffset.y;
    }
    return {
      point,
      maxPosition: interpolated.maxPosition,
      basePosition,
      sideBasePosition,
      uv: interpolated.uv,
      forceRim,
    };
  };
  const outerSurfaceLoop = outerLoop.map((point) => toSurfacePoint(point, true));
  const innerRimSurfaceLoop = innerRimLoop?.map((point) => toSurfacePoint(point, true)) ?? null;

  const topPosition = (sample: SurfacePoint, forceRim = false): THREE.Vector3 => {
    if (!options.brightnessSampler) return sample.maxPosition.clone();
    if (forceRim || sample.forceRim) {
      return sample.basePosition.clone().add(new THREE.Vector3(0, 0, rimThicknessMm));
    }
    const thickness = brightnessToTileThicknessMm(
      sampleTileBrightness(options.brightnessSampler, sample.uv.x, sample.uv.y),
      options,
    );
    return sample.basePosition.clone().add(new THREE.Vector3(0, 0, thickness));
  };

  const positions: number[] = [];
  const indices: number[] = [];
  const appendQuad = (
    a: SurfacePoint,
    b: SurfacePoint,
    c: SurfacePoint,
    d: SurfacePoint,
    forceRim: boolean,
  ): void => {
    appendSurfaceCell(
      positions,
      indices,
      [topPosition(a, forceRim), topPosition(b, forceRim), topPosition(c, forceRim)],
    );
    appendSurfaceCell(
      positions,
      indices,
      [topPosition(a, forceRim), topPosition(c, forceRim), topPosition(d, forceRim)],
    );
  };

  if (hasVariableInterior && insetPoints && innerRimLoop && innerRimSurfaceLoop) {
    for (let index = 0; index < outerSurfaceLoop.length; index += 1) {
      const next = (index + 1) % outerSurfaceLoop.length;
      appendQuad(
        outerSurfaceLoop[index],
        outerSurfaceLoop[next],
        innerRimSurfaceLoop[next],
        innerRimSurfaceLoop[index],
        true,
      );
    }

    const canonicalPoints = new Map<string, Point2>();
    const canonicalPoint = (point: Point2): Point2 => {
      const key = `${point.x.toFixed(8)}:${point.y.toFixed(8)}`;
      const existing = canonicalPoints.get(key);
      if (existing) return existing;
      canonicalPoints.set(key, point);
      return point;
    };
    const triangles = THREE.ShapeUtils.triangulateShape(
      insetPoints.map((point) => new THREE.Vector2(point.x, point.y)),
      [],
    );
    for (const triangleIndices of triangles) {
      let triangle = triangleIndices.map((index) => insetPoints[index]) as [Point2, Point2, Point2];
      if (cross2(subtract2(triangle[1], triangle[0]), subtract2(triangle[2], triangle[0])) < 0) {
        triangle = [triangle[0], triangle[2], triangle[1]];
      }
      const samples = new Map<string, SurfacePoint>();
      const sampleAt = (alongB: number, alongC: number): SurfacePoint => {
        const key = `${alongB}:${alongC}`;
        const existing = samples.get(key);
        if (existing) return existing;
        const weightB = alongB / segmentsPerEdge;
        const weightC = alongC / segmentsPerEdge;
        const weightA = 1 - weightB - weightC;
        const point = canonicalPoint({
          x: triangle[0].x * weightA + triangle[1].x * weightB + triangle[2].x * weightC,
          y: triangle[0].y * weightA + triangle[1].y * weightB + triangle[2].y * weightC,
        });
        const sample = toSurfacePoint(point, isOnPolygonBoundary(point, insetPoints));
        samples.set(key, sample);
        return sample;
      };
      for (let alongB = 0; alongB < segmentsPerEdge; alongB += 1) {
        for (let alongC = 0; alongC < segmentsPerEdge - alongB; alongC += 1) {
          const a = sampleAt(alongB, alongC);
          const b = sampleAt(alongB + 1, alongC);
          const c = sampleAt(alongB, alongC + 1);
          appendSurfaceCell(positions, indices, [topPosition(a), topPosition(b), topPosition(c)]);
          if (alongB + alongC < segmentsPerEdge - 1) {
            const d = sampleAt(alongB + 1, alongC + 1);
            appendSurfaceCell(positions, indices, [topPosition(b), topPosition(d), topPosition(c)]);
          }
        }
      }
    }
  } else {
    const center = toSurfacePoint(polygonCentroid(polygonPoints));
    const forceRimCenter = !options.brightnessSampler;
    for (let index = 0; index < outerSurfaceLoop.length; index += 1) {
      const next = (index + 1) % outerSurfaceLoop.length;
      appendSurfaceCell(
        positions,
        indices,
        [
          topPosition(center, forceRimCenter),
          topPosition(outerSurfaceLoop[index], true),
          topPosition(outerSurfaceLoop[next], true),
        ],
      );
    }
  }

  const bottomCenter = outerSurfaceLoop.reduce(
    (center, sample) => center.add(sample.sideBasePosition),
    new THREE.Vector3(),
  ).multiplyScalar(1 / outerSurfaceLoop.length);
  for (let index = 0; index < outerSurfaceLoop.length; index += 1) {
    const next = (index + 1) % outerSurfaceLoop.length;
    appendTriangleInOrder(
      positions,
      indices,
      [
        bottomCenter,
        outerSurfaceLoop[next].sideBasePosition,
        outerSurfaceLoop[index].sideBasePosition,
      ],
    );
  }

  for (let index = 0; index < outerSurfaceLoop.length; index += 1) {
    const next = (index + 1) % outerSurfaceLoop.length;
    const current = outerSurfaceLoop[index];
    const following = outerSurfaceLoop[next];
    appendTriangleInOrder(
      positions,
      indices,
      [topPosition(current, true), current.sideBasePosition, following.sideBasePosition],
    );
    appendTriangleInOrder(
      positions,
      indices,
      [topPosition(current, true), following.sideBasePosition, topPosition(following, true)],
    );
  }

  const unmergedGeometry = new THREE.BufferGeometry();
  unmergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  unmergedGeometry.setIndex(indices);
  const geometry = mergeVertices(unmergedGeometry, 1e-5);
  unmergedGeometry.dispose();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -bounds.min.z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.lithophane = {
    minThicknessMm: options.minThicknessMm,
    maxThicknessMm: options.maxThicknessMm,
    rimWidthMm: options.brightnessSampler ? selectedInset?.rimWidthMm ?? 0 : 0,
    rimThicknessMm: options.brightnessSampler ? rimThicknessMm : options.maxThicknessMm,
    textured: hasVariableInterior,
    flatPrintFaces: true,
  };
  return geometry;
}
