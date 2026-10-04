import * as THREE from 'three';
import type { SpiralTileDescriptor } from './spiralTiles';

export type PanelPartitionSettings = Readonly<{
  verticalDivisions: number;
  sectorsPerBand: number;
  staggerSeams: boolean;
}>;

export type PieceCountPanelSettings = Readonly<{
  targetPieceCount: number;
}>;

export type SphericalPanelGroup = Readonly<{
  id: string;
  band: number;
  sector: number;
  component: number | null;
  componentCount: number;
  tiles: SpiralTileDescriptor[];
}>;

function normalizedInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function sphericalPanelFileName(
  band: number,
  sector: number,
  bandDigits = 2,
  sectorDigits = 2,
  component: number | null = null,
): string {
  const base = `panel-b${String(band + 1).padStart(bandDigits, '0')}-s${String(sector + 1).padStart(sectorDigits, '0')}`;
  return `${base}${component === null ? '' : `-c${String(component + 1).padStart(2, '0')}`}.stl`;
}

export function compactPanelFileName(
  panelIndex: number,
  pieceCount: number,
  digits = 4,
): string {
  return `panel-${String(panelIndex + 1).padStart(digits, '0')}-p${String(pieceCount).padStart(2, '0')}.stl`;
}

function pointKey(descriptor: SpiralTileDescriptor, vertexIndex: number): string {
  const point = descriptor.assemblyOutline[vertexIndex].position;
  return `${point.x.toFixed(5)}:${point.y.toFixed(5)}:${point.z.toFixed(5)}`;
}

function connectedTileComponents(
  tiles: readonly SpiralTileDescriptor[],
): SpiralTileDescriptor[][] {
  const neighbors = tiles.map(() => new Set<number>());
  const edgeOwners = new Map<string, number[]>();
  tiles.forEach((tile, tileIndex) => {
    for (let vertexIndex = 0; vertexIndex < tile.assemblyOutline.length; vertexIndex += 1) {
      const start = pointKey(tile, vertexIndex);
      const end = pointKey(tile, (vertexIndex + 1) % tile.assemblyOutline.length);
      const edge = start < end ? `${start}|${end}` : `${end}|${start}`;
      edgeOwners.set(edge, [...(edgeOwners.get(edge) ?? []), tileIndex]);
    }
  });
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    neighbors[owners[0]].add(owners[1]);
    neighbors[owners[1]].add(owners[0]);
  }

  const components: SpiralTileDescriptor[][] = [];
  const visited = new Uint8Array(tiles.length);
  for (let start = 0; start < tiles.length; start += 1) {
    if (visited[start]) continue;
    const component: SpiralTileDescriptor[] = [];
    const pending = [start];
    visited[start] = 1;
    while (pending.length > 0) {
      const tileIndex = pending.pop()!;
      component.push(tiles[tileIndex]);
      for (const neighbor of neighbors[tileIndex]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = 1;
        pending.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

export function partitionSpiralTiles(
  descriptors: readonly SpiralTileDescriptor[],
  around: number,
  bands: number,
  settings: PanelPartitionSettings,
): SphericalPanelGroup[] {
  const safeAround = normalizedInteger(around, 'Tiles around one turn', 10_000);
  const safeBands = normalizedInteger(bands, 'Spiral turns', 10_000);
  const verticalDivisions = normalizedInteger(
    settings.verticalDivisions,
    'Vertical panel divisions',
    safeBands,
  );
  const sectorsPerBand = normalizedInteger(
    settings.sectorsPerBand,
    'Panel sectors per band',
    safeAround,
  );
  const groups = new Map<string, SphericalPanelGroup>();

  for (const descriptor of descriptors) {
    const latticeOffset = descriptor.spiral === 2 ? 0.5 : 0;
    const rowCenter = descriptor.row + latticeOffset;
    const columnCenter = descriptor.column + latticeOffset;
    const band = Math.min(
      verticalDivisions - 1,
      Math.floor((rowCenter / safeBands) * verticalDivisions),
    );
    const staggerOffset = settings.staggerSeams && band % 2 === 1
      ? safeAround / sectorsPerBand / 2
      : 0;
    const sector = Math.min(
      sectorsPerBand - 1,
      Math.floor(
        (modulo(columnCenter + staggerOffset, safeAround) / safeAround) * sectorsPerBand,
      ),
    );
    const id = `b${String(band + 1).padStart(2, '0')}-s${String(sector + 1).padStart(2, '0')}`;
    const existing = groups.get(id);
    if (existing) existing.tiles.push(descriptor);
    else groups.set(id, {
      id,
      band,
      sector,
      component: null,
      componentCount: 1,
      tiles: [descriptor],
    });
  }

  return [...groups.values()]
    .sort((left, right) => left.band - right.band || left.sector - right.sector)
    .flatMap((group) => {
      const sortedTiles = [...group.tiles].sort((left, right) => (
        left.row - right.row
        || left.column - right.column
        || left.spiral - right.spiral
        || left.order - right.order
      ));
      const components = connectedTileComponents(sortedTiles);
      return components.map((tiles, component) => ({
        ...group,
        id: components.length === 1
          ? group.id
          : `${group.id}-c${String(component + 1).padStart(2, '0')}`,
        component: components.length === 1 ? null : component,
        componentCount: components.length,
        tiles,
      }));
    });
}

function tileKey(descriptor: SpiralTileDescriptor): string {
  return `${descriptor.spiral}:${descriptor.order}`;
}

function sortedDescriptors(descriptors: readonly SpiralTileDescriptor[]): SpiralTileDescriptor[] {
  return [...descriptors].sort((left, right) => (
    left.row - right.row
    || left.column - right.column
    || left.spiral - right.spiral
    || left.order - right.order
  ));
}

function adjacencyByTile(
  descriptors: readonly SpiralTileDescriptor[],
): Map<string, Set<string>> {
  const adjacency = new Map(descriptors.map((descriptor) => [tileKey(descriptor), new Set<string>()]));
  const edgeOwners = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    const owner = tileKey(descriptor);
    for (let index = 0; index < descriptor.assemblyOutline.length; index += 1) {
      const start = pointKey(descriptor, index);
      const end = pointKey(descriptor, (index + 1) % descriptor.assemblyOutline.length);
      const edge = start < end ? `${start}|${end}` : `${end}|${start}`;
      edgeOwners.set(edge, [...(edgeOwners.get(edge) ?? []), owner]);
    }
  }
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    adjacency.get(owners[0])?.add(owners[1]);
    adjacency.get(owners[1])?.add(owners[0]);
  }
  return adjacency;
}

function boundaryPerimeter(descriptors: readonly SpiralTileDescriptor[]): number {
  const edges = new Map<string, { length: number; count: number }>();
  for (const descriptor of descriptors) {
    for (let index = 0; index < descriptor.assemblyOutline.length; index += 1) {
      const start = descriptor.assemblyOutline[index].position;
      const end = descriptor.assemblyOutline[(index + 1) % descriptor.assemblyOutline.length].position;
      const startKey = pointKey(descriptor, index);
      const endKey = pointKey(descriptor, (index + 1) % descriptor.assemblyOutline.length);
      const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
      const existing = edges.get(key);
      if (existing) existing.count += 1;
      else edges.set(key, { length: start.distanceTo(end), count: 1 });
    }
  }
  return [...edges.values()].reduce(
    (sum, edge) => sum + (edge.count === 1 ? edge.length : 0),
    0,
  );
}

function elongationPenalty(descriptors: readonly SpiralTileDescriptor[]): number {
  if (descriptors.length < 3) return 0;
  const center = descriptors.reduce(
    (sum, descriptor) => sum.add(descriptor.outwardCenter),
    descriptors[0].outwardCenter.clone().set(0, 0, 0),
  ).multiplyScalar(1 / descriptors.length);
  const normal = center.lengthSq() > 1e-12
    ? center.clone().normalize()
    : descriptors[0].outwardCenter.clone().normalize();
  const firstAxis = new THREE.Vector3(0, 1, 0)
    .addScaledVector(normal, -normal.y);
  if (firstAxis.lengthSq() < 1e-12) firstAxis.set(1, 0, 0);
  firstAxis.normalize();
  const secondAxis = normal.clone().cross(firstAxis).normalize();
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const descriptor of descriptors) {
    const offset = descriptor.outwardCenter.clone().sub(center);
    const x = offset.dot(firstAxis);
    const y = offset.dot(secondAxis);
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  const trace = xx + yy;
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy));
  const major = (trace + discriminant) * 0.5;
  const minor = (trace - discriminant) * 0.5;
  if (major <= 1e-12) return 0;
  if (minor <= 1e-12) return 1_000;
  return Math.sqrt(major / minor) - 1;
}

function compactnessScore(descriptors: readonly SpiralTileDescriptor[]): number {
  const perimeter = boundaryPerimeter(descriptors);
  const meanEdgeLength = descriptors.reduce((tileSum, descriptor) => (
    tileSum + descriptor.assemblyOutline.reduce((edgeSum, vertex, index) => (
      edgeSum + vertex.position.distanceTo(
        descriptor.assemblyOutline[(index + 1) % descriptor.assemblyOutline.length].position,
      )
    ), 0) / descriptor.assemblyOutline.length
  ), 0) / descriptors.length;
  return perimeter + elongationPenalty(descriptors) * meanEdgeLength;
}

function connectedKeys(
  start: string,
  allowed: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const result: string[] = [];
  const visited = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!allowed.has(neighbor) || visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return result;
}

function remainderFragmentation(
  component: readonly string[],
  removed: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  targetPieceCount: number,
): readonly [number, number] {
  const remaining = new Set(component.filter((key) => !removed.has(key)));
  if (remaining.size === 0) return [0, 0];
  const componentSizes: number[] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as string;
    const keys = connectedKeys(start, remaining, adjacency);
    for (const key of keys) remaining.delete(key);
    componentSizes.push(keys.length);
  }
  const minimumPanelCount = Math.ceil(componentSizes.reduce((sum, size) => sum + size, 0) / targetPieceCount);
  const fragmentedPanelCount = componentSizes.reduce(
    (sum, size) => sum + Math.ceil(size / targetPieceCount),
    0,
  );
  const idealRemainderCount = componentSizes.reduce((sum, size) => sum + size, 0) % targetPieceCount === 0
    ? 0
    : 1;
  const remainderCount = componentSizes.filter((size) => size % targetPieceCount !== 0).length;
  return [
    fragmentedPanelCount - minimumPanelCount,
    Math.max(0, remainderCount - idealRemainderCount),
  ];
}

function chooseCompactGroup(
  seed: string,
  component: readonly string[],
  targetPieceCount: number,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  byKey: ReadonlyMap<string, SpiralTileDescriptor>,
  orderByKey: ReadonlyMap<string, number>,
): Set<string> {
  const desiredSize = Math.min(targetPieceCount, component.length);
  if (desiredSize === component.length) return new Set(component);
  const componentSet = new Set(component);
  const beamWidth = desiredSize <= 8 ? 256 : desiredSize <= 16 ? 96 : 32;
  let states: Set<string>[] = [new Set([seed])];
  while (states[0].size < desiredSize) {
    const expanded = new Map<string, Set<string>>();
    for (const state of states) {
      for (const member of state) {
        for (const neighbor of adjacency.get(member) ?? []) {
          if (!componentSet.has(neighbor) || state.has(neighbor)) continue;
          const next = new Set(state).add(neighbor);
          const signature = [...next].map((key) => orderByKey.get(key)!).sort((a, b) => a - b).join(':');
          if (!expanded.has(signature)) expanded.set(signature, next);
        }
      }
    }
    if (expanded.size === 0) break;
    states = [...expanded.values()].map((keys) => ({
      keys,
      score: compactnessScore([...keys].map((key) => byKey.get(key)!)),
      signature: [...keys].map((key) => orderByKey.get(key)!).sort((a, b) => a - b).join(':'),
    })).sort((left, right) => left.score - right.score || left.signature.localeCompare(right.signature))
      .slice(0, beamWidth)
      .map(({ keys }) => keys);
  }
  const finalists = states.map((keys) => {
    const fragmentation = remainderFragmentation(component, keys, adjacency, targetPieceCount);
    return {
      keys,
      extraPanels: fragmentation[0],
      extraRemainders: fragmentation[1],
      score: compactnessScore([...keys].map((key) => byKey.get(key)!)),
      signature: [...keys].map((key) => orderByKey.get(key)!).sort((a, b) => a - b).join(':'),
    };
  }).sort((left, right) => (
    left.score - right.score
    || left.extraPanels - right.extraPanels
    || left.extraRemainders - right.extraRemainders
    || left.signature.localeCompare(right.signature)
  ));
  const selected = finalists[0]?.keys ?? new Set([seed]);
  if (
    desiredSize >= 5
    && desiredSize <= 8
    && elongationPenalty([...selected].map((key) => byKey.get(key)!)) > 0.8
  ) {
    return chooseCompactGroup(
      seed,
      component,
      desiredSize - 1,
      adjacency,
      byKey,
      orderByKey,
    );
  }
  return selected;
}

export function partitionSpiralTilesByPieceCount(
  descriptors: readonly SpiralTileDescriptor[],
  settings: PieceCountPanelSettings,
): SphericalPanelGroup[] {
  const targetPieceCount = normalizedInteger(
    settings.targetPieceCount,
    'Target pieces per panel',
    1_000,
  );
  if (descriptors.length === 0) return [];
  const ordered = sortedDescriptors(descriptors);
  const byKey = new Map(ordered.map((descriptor) => [tileKey(descriptor), descriptor]));
  const orderByKey = new Map(ordered.map((descriptor, index) => [tileKey(descriptor), index]));
  if (byKey.size !== ordered.length) throw new Error('Spherical panel tiles must have unique identities.');
  const adjacency = adjacencyByTile(ordered);
  const unassigned = new Set(byKey.keys());
  const groups: SpiralTileDescriptor[][] = [];

  while (unassigned.size > 0) {
    let seed = '';
    let seedDegree = Number.POSITIVE_INFINITY;
    let seedOrder = Number.POSITIVE_INFINITY;
    for (const key of unassigned) {
      const order = orderByKey.get(key)!;
      const degree = targetPieceCount <= 4
        ? [...(adjacency.get(key) ?? [])].filter((neighbor) => unassigned.has(neighbor)).length
        : 0;
      if (degree < seedDegree || (degree === seedDegree && order < seedOrder)) {
        seed = key;
        seedDegree = degree;
        seedOrder = order;
      }
    }
    const component = connectedKeys(seed, unassigned, adjacency);
    const groupKeys = chooseCompactGroup(
      seed,
      component,
      targetPieceCount,
      adjacency,
      byKey,
      orderByKey,
    );
    for (const key of groupKeys) unassigned.delete(key);
    groups.push(sortedDescriptors([...groupKeys].map((key) => byKey.get(key)!)));
  }

  const digits = Math.max(4, String(groups.length).length);
  return groups.map((tiles, index) => ({
    id: `p${String(index + 1).padStart(digits, '0')}`,
    band: 0,
    sector: index,
    component: null,
    componentCount: 1,
    tiles,
  }));
}
