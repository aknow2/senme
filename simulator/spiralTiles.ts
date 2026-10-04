import * as THREE from 'three';
import type { TileOutlineVertex } from './lithophaneTile';

export type SpiralTileSettings = Readonly<{
  diameterMm: number;
  topOpeningDiameterMm: number;
  bottomOpeningDiameterMm: number;
  around: number;
  bands: number;
  twist: number;
  jointClearanceMm: number;
  explode: number;
}>;

export type SpiralTileDescriptor = Readonly<{
  spiral: 1 | 2;
  order: number;
  row: number;
  column: number;
  outerRadius: number;
  assemblyOutline: TileOutlineVertex[];
  outline: TileOutlineVertex[];
  outwardCenter: THREE.Vector3;
  textureIndex: number | null;
}>;

export const MIN_FRAGMENT_AREA_RATIO = 0.1;

export function textureSourceSpiralIndex(
  textureCounts: readonly [number, number],
  spiralIndex: 0 | 1,
): 0 | 1 | null {
  if (textureCounts[spiralIndex] > 0) return spiralIndex;
  const otherSpiralIndex = spiralIndex === 0 ? 1 : 0;
  return textureCounts[otherSpiralIndex] > 0 ? otherSpiralIndex : null;
}

export function jointClearanceToTileInset(clearanceMm: number): number {
  return Math.max(0, clearanceMm) * 0.5;
}

export function spiralTileFileName(
  order: number,
  spiral: 1 | 2,
  minimumDigits = 4,
): string {
  const digits = Math.max(minimumDigits, String(Math.max(1, order)).length);
  return `${String(order).padStart(digits, '0')}-s${spiral}.stl`;
}

export function findSpiralTileByIndex(
  descriptors: readonly SpiralTileDescriptor[],
  spiral: 1 | 2,
  index: number,
): SpiralTileDescriptor | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  return descriptors.find((descriptor) => (
    descriptor.spiral === spiral && descriptor.order === index + 1
  ));
}

export function createFloorAlignedTileUvs(
  positions: readonly THREE.Vector3[],
  outwardCenter: THREE.Vector3,
): THREE.Vector2[] {
  const radial = outwardCenter.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const horizontal = worldUp.clone().cross(radial);
  if (horizontal.lengthSq() < 1e-12) horizontal.set(1, 0, 0);
  horizontal.normalize();

  const vertical = worldUp.clone().addScaledVector(radial, -worldUp.dot(radial));
  if (vertical.lengthSq() < 1e-12) vertical.crossVectors(radial, horizontal);
  vertical.normalize();

  const projected = positions.map((position) => {
    const offset = position.clone().sub(outwardCenter);
    return {
      u: offset.dot(horizontal),
      v: offset.dot(vertical),
    };
  });
  const minimumU = Math.min(...projected.map(({ u }) => u));
  const maximumU = Math.max(...projected.map(({ u }) => u));
  const minimumV = Math.min(...projected.map(({ v }) => v));
  const maximumV = Math.max(...projected.map(({ v }) => v));
  const width = Math.max(maximumU - minimumU, 1e-9);
  const height = Math.max(maximumV - minimumV, 1e-9);
  return projected.map(({ u, v }) => new THREE.Vector2(
    (u - minimumU) / width,
    (v - minimumV) / height,
  ));
}

function pointOnSphere(theta: number, phi: number, radius: number): THREE.Vector3 {
  const sinTheta = Math.sin(theta);
  return new THREE.Vector3(
    radius * sinTheta * Math.cos(phi),
    radius * Math.cos(theta),
    radius * sinTheta * Math.sin(phi),
  );
}

function polygonArea(points: readonly THREE.Vector3[]): number {
  let area = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    area += new THREE.Triangle(points[0], points[index], points[index + 1]).getArea();
  }
  return area;
}

function signedArea2d(points: readonly THREE.Vector2[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea * 0.5;
}

export function insetSphericalTileOutline(
  positions: readonly THREE.Vector3[],
  outwardCenter: THREE.Vector3,
  sphereRadiusMm: number,
  insetMm: number,
): THREE.Vector3[] {
  if (insetMm <= 0) return positions.map((position) => position.clone());
  if (positions.length < 3) throw new Error('Tile outline needs at least three vertices.');

  const uniquePositions: THREE.Vector3[] = [];
  for (const position of positions) {
    const previous = uniquePositions[uniquePositions.length - 1];
    if (!previous || previous.distanceToSquared(position) > 1e-12) {
      uniquePositions.push(position);
    }
  }
  if (
    uniquePositions.length > 1
    && uniquePositions[0].distanceToSquared(uniquePositions[uniquePositions.length - 1]) <= 1e-12
  ) {
    uniquePositions.pop();
  }
  if (uniquePositions.length < 3) throw new Error('Tile outline has fewer than three unique vertices.');

  const radial = outwardCenter.clone().normalize();
  const toLocal = new THREE.Quaternion().setFromUnitVectors(
    radial,
    new THREE.Vector3(0, 0, 1),
  );
  const toWorld = toLocal.clone().invert();
  const localPoints = uniquePositions.map((position) => {
    const local = position.clone().applyQuaternion(toLocal);
    return new THREE.Vector2(local.x, local.y);
  });
  const orientation = Math.sign(signedArea2d(localPoints));
  if (orientation === 0) throw new Error('Tile outline has no area.');

  const offsetLines = localPoints.map((point, index) => {
    const next = localPoints[(index + 1) % localPoints.length];
    const direction = next.clone().sub(point);
    const length = direction.length();
    if (length <= 1e-9) throw new Error('Tile outline contains a zero-length edge.');
    direction.multiplyScalar(1 / length);
    const inwardNormal = orientation > 0
      ? new THREE.Vector2(-direction.y, direction.x)
      : new THREE.Vector2(direction.y, -direction.x);
    return {
      point: point.clone().addScaledVector(inwardNormal, insetMm),
      direction,
    };
  });

  return localPoints.map((_, index) => {
    const previous = offsetLines[(index + offsetLines.length - 1) % offsetLines.length];
    const current = offsetLines[index];
    const denominator = previous.direction.cross(current.direction);
    if (Math.abs(denominator) <= 1e-9) {
      throw new Error('Tile clearance is too large for this outline.');
    }
    const betweenLines = current.point.clone().sub(previous.point);
    const distanceAlongPrevious = betweenLines.cross(current.direction) / denominator;
    const xy = previous.point.clone().addScaledVector(
      previous.direction,
      distanceAlongPrevious,
    );
    const radiusSquared = sphereRadiusMm * sphereRadiusMm;
    const xySquared = xy.lengthSq();
    if (xySquared >= radiusSquared) {
      throw new Error('Tile clearance produced a point outside the sphere.');
    }
    return new THREE.Vector3(
      xy.x,
      xy.y,
      Math.sqrt(radiusSquared - xySquared),
    ).applyQuaternion(toWorld);
  });
}

function clipTexturedPolygonAtY(
  vertices: readonly TileOutlineVertex[],
  boundaryY: number,
  keepBelow: boolean,
): TileOutlineVertex[] {
  const clipped: TileOutlineVertex[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const currentInside = keepBelow ? current.position.y <= boundaryY : current.position.y >= boundaryY;
    const previousInside = keepBelow ? previous.position.y <= boundaryY : previous.position.y >= boundaryY;

    if (currentInside !== previousInside) {
      const denominator = current.position.y - previous.position.y;
      const amount = Math.abs(denominator) < 1e-9
        ? 0
        : (boundaryY - previous.position.y) / denominator;
      clipped.push({
        position: previous.position.clone().lerp(current.position, amount),
        uv: previous.uv.clone().lerp(current.uv, amount),
      });
    }
    if (currentInside) {
      clipped.push({ position: current.position.clone(), uv: current.uv.clone() });
    }
  }
  return clipped;
}

function sanitizeTileOutlineVertices(
  vertices: readonly TileOutlineVertex[],
): TileOutlineVertex[] {
  const result: TileOutlineVertex[] = [];
  for (const vertex of vertices) {
    const previous = result[result.length - 1];
    if (previous && previous.position.distanceToSquared(vertex.position) <= 1e-12) continue;
    result.push({ position: vertex.position.clone(), uv: vertex.uv.clone() });
  }
  if (
    result.length > 1
    && result[0].position.distanceToSquared(result[result.length - 1].position) <= 1e-12
  ) result.pop();
  return result;
}

export function generateSpiralTileDescriptors(
  config: SpiralTileSettings,
  textureCounts: readonly [number, number],
): SpiralTileDescriptor[] {
  const descriptors: SpiralTileDescriptor[] = [];
  const turnPitch = Math.PI / config.bands;
  const phiStep = (Math.PI * 2) / config.around;
  const tileCount = config.around * config.bands;
  const radius = config.diameterMm * 0.5;
  const topOpeningRadius = THREE.MathUtils.clamp(
    config.topOpeningDiameterMm * 0.5,
    0,
    radius * 0.8,
  );
  const bottomOpeningRadius = THREE.MathUtils.clamp(
    config.bottomOpeningDiameterMm * 0.5,
    0,
    radius * 0.8,
  );
  const topOpeningHalfAngle = Math.asin(topOpeningRadius / radius);
  const bottomOpeningHalfAngle = Math.asin(bottomOpeningRadius / radius);

  const latticePoint = (
    aroundPosition: number,
    turnPosition: number,
    pointRadius: number,
  ): THREE.Vector3 => {
    const theta = THREE.MathUtils.clamp(
      (turnPosition + (aroundPosition + 0.5) / config.around) * turnPitch,
      0,
      Math.PI,
    );
    const phi = aroundPosition * phiStep + config.twist * theta;
    return pointOnSphere(theta, phi, pointRadius);
  };

  const append = (
    outerInput: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
    outwardCenter: THREE.Vector3,
    outerRadius: number,
    spiralIndex: 0 | 1,
    orderIndex: number,
    row: number,
    column: number,
  ): void => {
    const rawUvs = createFloorAlignedTileUvs(outerInput, outwardCenter);
    const rawTexturedOuter = outerInput.map((position, index) => ({
      position: position.clone(),
      uv: rawUvs[index],
    }));
    const outer = insetSphericalTileOutline(
      outerInput,
      outwardCenter,
      outerRadius,
      jointClearanceToTileInset(config.jointClearanceMm),
    );
    const originalArea = polygonArea(outer);
    const localUvs = createFloorAlignedTileUvs(outer, outwardCenter);
    const texturedOuter = outer.map((position, index) => ({
      position,
      uv: localUvs[index],
    }));
    const topCapY = outerRadius * Math.cos(topOpeningHalfAngle);
    const bottomCapY = -outerRadius * Math.cos(bottomOpeningHalfAngle);
    const assemblyOutline = sanitizeTileOutlineVertices(clipTexturedPolygonAtY(
      clipTexturedPolygonAtY(rawTexturedOuter, topCapY, true),
      bottomCapY,
      false,
    ));
    const clipped = clipTexturedPolygonAtY(
      clipTexturedPolygonAtY(texturedOuter, topCapY, true),
      bottomCapY,
      false,
    );
    const clippedArea = polygonArea(clipped.map((vertex) => vertex.position));
    if (
      clipped.length < 3
      || originalArea <= 1e-9
      || clippedArea / originalArea < MIN_FRAGMENT_AREA_RATIO
    ) return;

    const textureSource = textureSourceSpiralIndex(textureCounts, spiralIndex);
    const textureCount = textureSource === null ? 0 : textureCounts[textureSource];
    descriptors.push({
      spiral: spiralIndex === 0 ? 1 : 2,
      order: orderIndex + 1,
      row,
      column,
      outerRadius,
      assemblyOutline,
      outline: clipped,
      outwardCenter: outwardCenter.clone(),
      textureIndex: textureCount > 0 ? orderIndex % textureCount : null,
    });
  };

  for (let tileSequence = 0; tileSequence < tileCount; tileSequence += 1) {
    const row = Math.floor(tileSequence / config.around);
    const column = tileSequence % config.around;
    const radialOffset = config.explode * (0.55 + (tileSequence % 7) / 14);
    const outerRadius = radius + radialOffset;
    const center = latticePoint(column, row, outerRadius);
    append(
      [
        latticePoint(column, row - 0.5, outerRadius),
        latticePoint(column + 0.5, row, outerRadius),
        latticePoint(column, row + 0.5, outerRadius),
        latticePoint(column - 0.5, row, outerRadius),
      ],
      center,
      outerRadius,
      0,
      tileSequence,
      row,
      column,
    );
  }

  for (let row = 0; row < config.bands - 1; row += 1) {
    for (let column = 0; column < config.around; column += 1) {
      const fillerSequence = tileCount + row * config.around + column;
      const radialOffset = config.explode * (0.55 + (fillerSequence % 7) / 14);
      const outerRadius = radius + radialOffset;
      const center = latticePoint(column + 0.5, row + 0.5, outerRadius);
      append(
        [
          latticePoint(column + 0.5, row, outerRadius),
          latticePoint(column + 1, row + 0.5, outerRadius),
          latticePoint(column + 0.5, row + 1, outerRadius),
          latticePoint(column, row + 0.5, outerRadius),
        ],
        center,
        outerRadius,
        1,
        row * config.around + column,
        row,
        column,
      );
    }
  }

  return descriptors;
}
