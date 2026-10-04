import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import {
  brightnessToTileThicknessMm,
  createLithophaneTileGeometry,
  sampleTileBrightness,
  type TileOutlineVertex,
} from '../../lithophaneTile';
import {
  createFloorAlignedTileUvs,
  findSpiralTileByIndex,
  generateSpiralTileDescriptors,
  insetSphericalTileOutline,
  jointClearanceToTileInset,
  spiralTileFileName,
  textureSourceSpiralIndex,
  type SpiralTileDescriptor,
} from '../../spiralTiles';
import { createSphericalPanelGeometry } from '../../sphericalPanel';
import {
  compactPanelFileName,
  partitionSpiralTiles,
  partitionSpiralTilesByPieceCount,
  sphericalPanelFileName,
} from '../../panelPartition';
import { collectPanelBoundaryEdges } from '../../panelBoundary';
import { validateClosedSolid } from '../../src/lithophane/meshTopology';

const squareOutline: readonly TileOutlineVertex[] = [
  { position: new THREE.Vector3(-10, -10, 100), uv: new THREE.Vector2(0, 0) },
  { position: new THREE.Vector3(10, -10, 100), uv: new THREE.Vector2(1, 0) },
  { position: new THREE.Vector3(10, 10, 100), uv: new THREE.Vector2(1, 1) },
  { position: new THREE.Vector3(-10, 10, 100), uv: new THREE.Vector2(0, 1) },
];

const curvedOutline: readonly TileOutlineVertex[] = [
  { position: new THREE.Vector3(-10, -10, Math.sqrt(9_800)), uv: new THREE.Vector2(0, 0) },
  { position: new THREE.Vector3(12, -8, Math.sqrt(9_792)), uv: new THREE.Vector2(1, 0) },
  { position: new THREE.Vector3(9, 11, Math.sqrt(9_798)), uv: new THREE.Vector2(1, 1) },
  { position: new THREE.Vector3(-11, 8, Math.sqrt(9_815)), uv: new THREE.Vector2(0, 1) },
];

export async function registerTests(t: TestContext): Promise<void> {
  await t.test('maps black to maximum and white to configurable minimum thickness', () => {
    const options = {
      minThicknessMm: 0.8,
      maxThicknessMm: 3,
      contrast: 1,
      brightnessCurve: 0.6,
    };
    assert.equal(brightnessToTileThicknessMm(0, options), 3);
    assert.equal(brightnessToTileThicknessMm(1, options), 0.8);
    assert.ok(brightnessToTileThicknessMm(0.5, options) > 0.8);
    assert.ok(brightnessToTileThicknessMm(0.5, options) < 3);
  });

  await t.test('uses the same top-left image orientation as the texture preview', () => {
    const calls: Array<readonly [number, number]> = [];
    const sampler = {
      sampleBrightness(u: number, v: number) {
        calls.push([u, v]);
        return v;
      },
    };
    assert.equal(sampleTileBrightness(sampler, 0.25, 1), 0);
    assert.equal(sampleTileBrightness(sampler, 0.75, 0), 1);
    assert.deepEqual(calls, [[0.25, 0], [0.75, 1]]);
  });

  await t.test('creates a watertight relief with a maximum-thickness perimeter', () => {
    const geometry = createLithophaneTileGeometry(
      squareOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm: 2,
        brightnessSampler: { sampleBrightness: () => 1 },
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const zValues = Array.from({ length: position.count }, (_, index) => position.getZ(index));
      assert.ok(zValues.some((z) => Math.abs(z - 3) < 1e-4), 'perimeter must remain at 3 mm');
      assert.ok(zValues.some((z) => Math.abs(z - 0.8) < 1e-4), 'white interior must reach 0.8 mm');

      const index = geometry.getIndex();
      assert.ok(index);
      const diagnostics = validateClosedSolid({
        positions: position.array as Float32Array,
        indices: index.array as Uint16Array | Uint32Array,
      });
      assert.equal(diagnostics.connectedComponents, 1);
      assert.ok(diagnostics.signedVolume > 0);
    } finally {
      geometry.dispose();
    }
  });

  await t.test('uses an independently configured perimeter height', () => {
    const geometry = createLithophaneTileGeometry(
      squareOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimThicknessMm: 1.4,
        rimWidthMm: 0.3,
        targetEdgeMm: 2,
        brightnessSampler: { sampleBrightness: () => 1 },
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const zValues = Array.from({ length: position.count }, (_, index) => position.getZ(index));
      assert.ok(zValues.some((z) => Math.abs(z - 1.4) < 1e-4), 'perimeter must use 1.4 mm');
      assert.ok(zValues.some((z) => Math.abs(z - 0.8) < 1e-4), 'white interior must remain 0.8 mm');
      assert.ok(!zValues.some((z) => Math.abs(z - 3) < 1e-4), 'perimeter must not be forced to 3 mm');
      assert.equal(geometry.userData.lithophane.rimThicknessMm, 1.4);
      const index = geometry.getIndex();
      assert.ok(index);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: index.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('keeps an untextured tile uniformly at maximum thickness', () => {
    const geometry = createLithophaneTileGeometry(
      squareOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm: 2,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      assert.deepEqual(geometry.userData.lithophane, {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0,
        rimThicknessMm: 3,
        textured: false,
        flatPrintFaces: true,
      });
      const index = geometry.getIndex();
      assert.ok(index);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: index.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('retains a texture when a narrow tile cannot fit a perimeter rim', () => {
    const narrowOutline: readonly TileOutlineVertex[] = [
      { position: new THREE.Vector3(-0.015, -0.015, 100), uv: new THREE.Vector2(0, 0) },
      { position: new THREE.Vector3(0.015, -0.015, 100), uv: new THREE.Vector2(1, 0) },
      { position: new THREE.Vector3(0.015, 0.015, 100), uv: new THREE.Vector2(1, 1) },
      { position: new THREE.Vector3(-0.015, 0.015, 100), uv: new THREE.Vector2(0, 1) },
    ];
    const geometry = createLithophaneTileGeometry(
      narrowOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm: 0.5,
        brightnessSampler: { sampleBrightness: () => 1 },
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      assert.equal(geometry.userData.lithophane.rimWidthMm, 0);
      assert.equal(geometry.userData.lithophane.textured, true);
      assert.ok(Array.from(
        { length: position.count },
        (_, index) => position.getZ(index),
      ).some((z) => Math.abs(z - 0.8) < 1e-4));
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('does not let a short polar clipping edge reduce a large tile to three texture samples', () => {
    const descriptor = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 200,
      bottomOpeningDiameterMm: 240,
      around: 26,
      bands: 10,
      twist: 0.01,
      jointClearanceMm: 0,
      explode: 0,
    }, [1, 1]).find(({ spiral, order }) => spiral === 2 && order === 28);
    assert.ok(descriptor);
    const panelReliefPositions = insetSphericalTileOutline(
      descriptor.outline.map(({ position }) => position),
      descriptor.outwardCenter,
      descriptor.outerRadius,
      0.15,
    );
    const geometry = createLithophaneTileGeometry(
      panelReliefPositions.map((position, index) => ({
        position,
        uv: descriptor.outline[index].uv,
      })),
      descriptor.outwardCenter,
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3.5,
        rimWidthMm: 0.3,
        targetEdgeMm: 0.5,
        brightnessSampler: { sampleBrightness: (u, v) => (u + v) * 0.5 },
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      assert.equal(geometry.userData.lithophane.textured, true);
      assert.equal(geometry.userData.lithophane.rimWidthMm, 0.3);
      assert.ok(position.count > 1_000, 'the large clipped face must retain high-resolution sampling');
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('flattens curved sphere tiles while keeping only their side walls beveled', () => {
    const geometry = createLithophaneTileGeometry(
      curvedOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm: 1.5,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const zValues = Array.from({ length: position.count }, (_, index) => position.getZ(index));
      const uniqueZ = [...new Set(zValues.map((value) => Number(value.toFixed(4))))].sort();
      assert.deepEqual(uniqueZ, [0, 3], 'untextured front and print-bed faces must both be planar');

      const spanX = (indices: number[]) => {
        const values = indices.map((index) => position.getX(index));
        return Math.max(...values) - Math.min(...values);
      };
      const topIndices = zValues.flatMap((value, index) => Math.abs(value - 3) < 1e-4 ? [index] : []);
      const bottomIndices = zValues.flatMap((value, index) => Math.abs(value) < 1e-4 ? [index] : []);
      assert.ok(spanX(bottomIndices) < spanX(topIndices), 'the lower outline must taper inward');

      const index = geometry.getIndex();
      assert.ok(index);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: index.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('rejects a minimum thickness that is not below maximum thickness', () => {
    assert.throws(() => createLithophaneTileGeometry(
      squareOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 3,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm: 2,
      },
    ), /minimum thickness/i);
  });

  await t.test('increases mesh detail when the configured sampling interval is smaller', () => {
    const createAtResolution = (targetEdgeMm: number) => createLithophaneTileGeometry(
      squareOutline,
      new THREE.Vector3(0, 0, 100),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        rimWidthMm: 0.3,
        targetEdgeMm,
        brightnessSampler: { sampleBrightness: (u, v) => (u + v) * 0.5 },
      },
    );
    const coarse = createAtResolution(3);
    const fine = createAtResolution(1);
    try {
      assert.ok(
        fine.getAttribute('position').count > coarse.getAttribute('position').count,
        'a smaller millimeter interval must create more mesh vertices',
      );
    } finally {
      coarse.dispose();
      fine.dispose();
    }
  });

  await t.test('cycles textures independently for both spirals', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [2, 3]);
    assert.ok(descriptors.length > 1_000);
    for (const tile of descriptors) {
      const textureCount = tile.spiral === 1 ? 2 : 3;
      assert.equal(tile.textureIndex, (tile.order - 1) % textureCount);
    }
  });

  await t.test('shares the populated texture sequence when the other spiral is empty', () => {
    assert.equal(textureSourceSpiralIndex([2, 0], 0), 0);
    assert.equal(textureSourceSpiralIndex([2, 0], 1), 0);
    assert.equal(textureSourceSpiralIndex([0, 3], 0), 1);
    assert.equal(textureSourceSpiralIndex([0, 3], 1), 1);
    assert.equal(textureSourceSpiralIndex([0, 0], 0), null);
    assert.equal(textureSourceSpiralIndex([0, 0], 1), null);

    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [2, 0]);
    for (const tile of descriptors) {
      assert.equal(tile.textureIndex, (tile.order - 1) % 2);
    }
  });

  await t.test('finds a tile from its zero-based index within each spiral', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 0,
      bottomOpeningDiameterMm: 0,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    assert.equal(findSpiralTileByIndex(descriptors, 1, 0)?.order, 1);
    assert.equal(findSpiralTileByIndex(descriptors, 2, 0)?.order, 1);
    assert.equal(findSpiralTileByIndex(descriptors, 1, 17)?.order, 18);
    assert.equal(findSpiralTileByIndex(descriptors, 2, 17)?.order, 18);
    assert.equal(findSpiralTileByIndex(descriptors, 1, -1), undefined);
    assert.equal(findSpiralTileByIndex(descriptors, 2, 108), undefined);
  });

  await t.test('insets every tile edge by half the configured joint clearance', () => {
    const radius = 100;
    const pointOnSphere = (x: number, y: number) => new THREE.Vector3(
      x,
      y,
      Math.sqrt(radius * radius - x * x - y * y),
    );
    const diamond = [
      pointOnSphere(0, 10),
      pointOnSphere(-10, 0),
      pointOnSphere(0, -10),
      pointOnSphere(10, 0),
    ];
    const inset = insetSphericalTileOutline(
      diamond,
      new THREE.Vector3(0, 0, radius),
      radius,
      jointClearanceToTileInset(0.3),
    );
    assert.equal(jointClearanceToTileInset(0.3), 0.15);
    const expectedExtent = 10 - 0.15 * Math.SQRT2;
    assert.ok(Math.abs(Math.max(...inset.map((point) => point.x)) - expectedExtent) < 1e-6);
    assert.ok(Math.abs(Math.max(...inset.map((point) => point.y)) - expectedExtent) < 1e-6);
    for (const point of inset) {
      assert.ok(Math.abs(point.length() - radius) < 1e-9, 'inset vertices must remain on sphere');
    }
  });

  await t.test('joins adjacent tiles into one curved solid while retaining a backed surface groove', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 0,
      bottomOpeningDiameterMm: 0,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    const edgeOwners = new Map<string, typeof descriptors>();
    const keyForPoint = (point: THREE.Vector3) => (
      `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.z.toFixed(6)}`
    );
    for (const descriptor of descriptors.filter(({ assemblyOutline }) => assemblyOutline.length === 4)) {
      for (let index = 0; index < descriptor.assemblyOutline.length; index += 1) {
        const start = keyForPoint(descriptor.assemblyOutline[index].position);
        const end = keyForPoint(
          descriptor.assemblyOutline[(index + 1) % descriptor.assemblyOutline.length].position,
        );
        const key = start < end ? `${start}|${end}` : `${end}|${start}`;
        const owners = edgeOwners.get(key) ?? [];
        owners.push(descriptor);
        edgeOwners.set(key, owners);
      }
    }
    const adjacent = [...edgeOwners.values()].find((owners) => (
      owners.length === 2
      && owners[0].spiral !== owners[1].spiral
      && owners.every(({ outwardCenter }) => Math.abs(outwardCenter.y) < 50)
    ));
    assert.ok(adjacent, 'expected a pair of adjacent tiles with one exact shared assembly edge');

    const options = {
      minThicknessMm: 0.8,
      maxThicknessMm: 3,
      backingThicknessMm: 0.6,
      rimWidthMm: 0.3,
      targetEdgeMm: 5,
    };
    const create = () => createSphericalPanelGeometry(
      adjacent.map((descriptor) => ({
        descriptor,
        brightnessSampler: { sampleBrightness: () => 1 },
      })),
      options,
    );
    const first = create();
    const second = create();
    try {
      const position = first.getAttribute('position');
      const geometryIndex = first.getIndex();
      assert.ok(geometryIndex);
      const radii = Array.from({ length: position.count }, (_, index) => (
        Math.hypot(position.getX(index), position.getY(index), position.getZ(index))
      ));
      assert.ok(radii.some((radius) => Math.abs(radius - 100) < 1e-4));
      assert.ok(radii.some((radius) => Math.abs(radius - 97.8) < 1e-4));
      assert.ok(radii.some((radius) => Math.abs(radius - 97.6) < 1e-4));
      assert.ok(radii.some((radius) => Math.abs(radius - 97) < 1e-4));
      assert.deepEqual(first.userData.sphericalPanel, {
        tileCount: 2,
        radiusMm: 100,
        backingThicknessMm: 0.6,
        glueAllowanceMm: 0,
        preservesSphereCurvature: true,
        visibleTileGrooves: true,
      });
      const diagnostics = validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      });
      assert.equal(diagnostics.connectedComponents, 1);
      assert.ok(diagnostics.signedVolume > 0);
      assert.deepEqual(first.getAttribute('position').array, second.getAttribute('position').array);
      assert.deepEqual(first.getIndex()?.array, second.getIndex()?.array);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  await t.test('formats assembly filenames in lexical pair order', () => {
    assert.deepEqual(
      [
        spiralTileFileName(1, 1),
        spiralTileFileName(1, 2),
        spiralTileFileName(2, 1),
        spiralTileFileName(2, 2),
      ],
      ['0001-s1.stl', '0001-s2.stl', '0002-s1.stl', '0002-s2.stl'],
    );
    assert.equal(compactPanelFileName(0, 4), 'panel-0001-p04.stl');
    assert.equal(compactPanelFileName(11, 2), 'panel-0012-p02.stl');
  });

  await t.test('groups a regular tile grid into compact adjacent four-piece panels', () => {
    const descriptors: SpiralTileDescriptor[] = [];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const points = [
          new THREE.Vector3(column, row, 100),
          new THREE.Vector3(column + 1, row, 100),
          new THREE.Vector3(column + 1, row + 1, 100),
          new THREE.Vector3(column, row + 1, 100),
        ];
        descriptors.push({
          spiral: 1,
          order: row * 4 + column + 1,
          row,
          column,
          outerRadius: 100,
          assemblyOutline: points.map((position) => ({
            position,
            uv: new THREE.Vector2(),
          })),
          outline: points.map((position) => ({
            position: position.clone(),
            uv: new THREE.Vector2(),
          })),
          outwardCenter: new THREE.Vector3(column + 0.5, row + 0.5, 100),
          textureIndex: null,
        });
      }
    }
    const first = partitionSpiralTilesByPieceCount(descriptors, { targetPieceCount: 4 });
    const second = partitionSpiralTilesByPieceCount(descriptors, { targetPieceCount: 4 });
    assert.equal(first.length, 4);
    assert.deepEqual(
      first.map(({ tiles }) => tiles.map(({ order }) => order)),
      second.map(({ tiles }) => tiles.map(({ order }) => order)),
    );
    for (const panel of first) {
      assert.equal(panel.tiles.length, 4);
      const rows = panel.tiles.map(({ row }) => row);
      const columns = panel.tiles.map(({ column }) => column);
      assert.equal(Math.max(...rows) - Math.min(...rows), 1, `${panel.id} must span two rows`);
      assert.equal(Math.max(...columns) - Math.min(...columns), 1, `${panel.id} must span two columns`);
    }

    const fivePieceMaximum = partitionSpiralTilesByPieceCount(descriptors, { targetPieceCount: 5 });
    assert.equal(fivePieceMaximum.flatMap(({ tiles }) => tiles).length, descriptors.length);
    assert.ok(fivePieceMaximum.every(({ tiles }) => tiles.length >= 1 && tiles.length <= 5));
    for (const panel of fivePieceMaximum.filter(({ tiles }) => tiles.length === 5)) {
      const rows = panel.tiles.map(({ row }) => row);
      const columns = panel.tiles.map(({ column }) => column);
      assert.ok(Math.max(...rows) - Math.min(...rows) < 3, `${panel.id} must not form a tall chain`);
      assert.ok(Math.max(...columns) - Math.min(...columns) < 3, `${panel.id} must not form a wide chain`);
    }
  });

  await t.test('partitions every tile exactly once into deterministic staggered spherical panels', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 20,
      bottomOpeningDiameterMm: 20,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    const settings = {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    };
    const first = partitionSpiralTiles(descriptors, 12, 10, settings);
    const second = partitionSpiralTiles(descriptors, 12, 10, settings);
    assert.deepEqual(
      first.map(({ id, tiles }) => [id, tiles.map(({ spiral, order }) => `${spiral}:${order}`)]),
      second.map(({ id, tiles }) => [id, tiles.map(({ spiral, order }) => `${spiral}:${order}`)]),
    );
    assert.equal(first.flatMap(({ tiles }) => tiles).length, descriptors.length);
    assert.equal(
      new Set(first.flatMap(({ tiles }) => tiles.map(({ spiral, order }) => `${spiral}:${order}`))).size,
      descriptors.length,
    );
    assert.equal(first.length, 30);
    assert.equal(sphericalPanelFileName(0, 0), 'panel-b01-s01.stl');
    assert.equal(sphericalPanelFileName(4, 5), 'panel-b05-s06.stl');
    assert.equal(sphericalPanelFileName(0, 0, 2, 2, 0), 'panel-b01-s01-c01.stl');
    assert.equal(sphericalPanelFileName(0, 0, 2, 2, 1), 'panel-b01-s01-c02.stl');
    const aligned = partitionSpiralTiles(descriptors, 12, 10, {
      ...settings,
      staggerSeams: false,
    });
    const alignedGroupByTile = new Map(aligned.flatMap(({ id, tiles }) => (
      tiles.map(({ spiral, order }) => [`${spiral}:${order}`, id] as const)
    )));
    assert.ok(first.some(({ band, id, tiles }) => (
      band % 2 === 1 && tiles.some(({ spiral, order }) => alignedGroupByTile.get(`${spiral}:${order}`) !== id)
    )), 'odd bands must move at least one seam when staggering is enabled');

    for (const group of first) {
      const tileByKey = new Map(group.tiles.map((tile) => [`${tile.spiral}:${tile.order}`, tile]));
      const neighbors = new Map([...tileByKey.keys()].map((key) => [key, new Set<string>()]));
      const edgeOwners = new Map<string, string[]>();
      for (const [tileKey, tile] of tileByKey) {
        for (let index = 0; index < tile.assemblyOutline.length; index += 1) {
          const pointKey = (point: THREE.Vector3) => (
            `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.z.toFixed(6)}`
          );
          const start = pointKey(tile.assemblyOutline[index].position);
          const end = pointKey(tile.assemblyOutline[(index + 1) % tile.assemblyOutline.length].position);
          const edge = start < end ? `${start}|${end}` : `${end}|${start}`;
          const owners = edgeOwners.get(edge) ?? [];
          owners.push(tileKey);
          edgeOwners.set(edge, owners);
        }
      }
      for (const owners of edgeOwners.values()) {
        if (owners.length !== 2) continue;
        neighbors.get(owners[0])?.add(owners[1]);
        neighbors.get(owners[1])?.add(owners[0]);
      }
      const pending = [tileByKey.keys().next().value as string];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const current = pending.pop();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        pending.push(...neighbors.get(current) ?? []);
      }
      assert.equal(visited.size, group.tiles.length, `${group.id} must be edge-connected`);
    }
  });

  await t.test('splits disconnected islands when seven vertical divisions isolate one spiral', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 200,
      bottomOpeningDiameterMm: 240,
      around: 26,
      bands: 10,
      twist: 0.01,
      jointClearanceMm: 0,
      explode: 0,
    }, [1, 1]);
    const panels = partitionSpiralTiles(descriptors, 26, 10, {
      verticalDivisions: 7,
      sectorsPerBand: 6,
      staggerSeams: true,
    });
    assert.equal(panels.flatMap(({ tiles }) => tiles).length, descriptors.length);
    const firstCell = panels.filter(({ band, sector }) => band === 0 && sector === 0);
    assert.ok(firstCell.length > 1, 'the disconnected first cell must be emitted as safe components');
    assert.equal(
      new Set(firstCell.map(({ component }) => sphericalPanelFileName(0, 0, 2, 2, component))).size,
      firstCell.length,
    );
    for (const panel of firstCell) {
      const geometry = createSphericalPanelGeometry(
        panel.tiles.map((descriptor) => ({
          descriptor,
          brightnessSampler: { sampleBrightness: () => 0.5 },
        })),
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3.5,
          backingThicknessMm: 0.6,
          rimWidthMm: 0.3,
          targetEdgeMm: 0.5,
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const geometryIndex = geometry.getIndex();
        assert.ok(geometryIndex);
        assert.doesNotThrow(() => validateClosedSolid({
          positions: position.array as Float32Array,
          indices: geometryIndex.array as Uint16Array | Uint32Array,
        }), panel.id);
      } finally {
        geometry.dispose();
      }
    }
  });

  await t.test('collects only STL-independent outer and inter-panel preview borders', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 20,
      bottomOpeningDiameterMm: 20,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [1, 1]);
    const panels = partitionSpiralTiles(descriptors, 12, 10, {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    });
    const borders = collectPanelBoundaryEdges(panels);
    assert.ok(borders.length > 0);
    assert.ok(borders.length < descriptors.reduce(
      (sum, descriptor) => sum + descriptor.assemblyOutline.length,
      0,
    ), 'edges inside one panel must not be drawn');
    assert.deepEqual(
      borders.map(({ start, end }) => [start.toArray(), end.toArray()]),
      collectPanelBoundaryEdges(panels).map(({ start, end }) => [start.toArray(), end.toArray()]),
    );
  });

  await t.test('exposes spherical panel partition controls and the curved export route in the simulator UI', async () => {
    const [html, source] = await Promise.all([
      readFile(new URL('../../index.html', import.meta.url), 'utf8'),
      readFile(new URL('../../main.ts', import.meta.url), 'utf8'),
    ]);
    for (const id of [
      'lithophane-rim-thickness',
      'stl-export-mode',
      'panel-target-piece-count',
      'panel-backing-thickness',
      'panel-glue-allowance',
      'tile-highlight-panel',
      'highlight-heading',
      'highlight-spiral-field',
      'highlight-index-label',
      'highlight-note',
    ]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(source, /partitionSpiralTilesByPieceCount\(/);
    assert.match(source, /createSphericalPanelGeometry\(/);
    assert.match(source, /createPanelBoundaryPreview\(/);
    assert.match(source, /createPanelHighlight\(/);
    assert.match(source, /panelHighlightMaterial/);
    assert.match(source, /パネルIndex .*を緑枠で表示中/);
    assert.match(source, /rimThicknessMm: settings\.lithophaneRimThicknessMm/);
    assert.match(html, /STLには含まれません/);
    assert.match(source, /球面パネルSTLを出力/);
  });

  await t.test('builds every panel in a complete small sphere partition as one closed curved solid', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 20,
      bottomOpeningDiameterMm: 20,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    const panels = partitionSpiralTiles(descriptors, 12, 10, {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    });
    for (const panel of panels) {
      const geometry = createSphericalPanelGeometry(
        panel.tiles.map((descriptor) => ({ descriptor })),
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3,
          backingThicknessMm: 0.6,
          glueAllowanceMm: 2,
          rimWidthMm: 0.3,
          targetEdgeMm: 5,
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const geometryIndex = geometry.getIndex();
        assert.ok(geometryIndex, `${panel.id} requires an index`);
        const diagnostics = validateClosedSolid({
          positions: position.array as Float32Array,
          indices: geometryIndex.array as Uint16Array | Uint32Array,
        });
        assert.equal(diagnostics.connectedComponents, 1, panel.id);
        assert.ok(diagnostics.signedVolume > 0, panel.id);
        assert.equal(geometry.userData.sphericalPanel.glueAllowanceMm, 2);
        const radii = Array.from({ length: position.count }, (_, vertexIndex) => Math.hypot(
          position.getX(vertexIndex),
          position.getY(vertexIndex),
          position.getZ(vertexIndex),
        ));
        assert.ok(Math.abs(Math.min(...radii) - 95) < 1e-4, panel.id);
        assert.ok(
          radii.filter((radius) => Math.abs(radius - 97) < 1e-4).length >= panel.tiles.length,
          `${panel.id} must retain the original lithophane inner radius`,
        );
        assert.ok(
          radii.filter((radius) => Math.abs(radius - 95) < 1e-4).length >= panel.tiles.length * 3,
          `${panel.id} must add an inward flange around every tile`,
        );
      } catch (error) {
        assert.fail(`${panel.id}: ${String(error)}`);
      } finally {
        geometry.dispose();
      }
    }
  });

  await t.test('keeps a custom perimeter height after relief is curved onto a spherical panel', () => {
    const descriptor = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 20,
      bottomOpeningDiameterMm: 20,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [1, 1]).find(({ row }) => row === 5);
    assert.ok(descriptor);
    const rimThicknessMm = 1.4;
    const maxThicknessMm = 3;
    const geometry = createSphericalPanelGeometry(
      [{ descriptor, brightnessSampler: { sampleBrightness: () => 1 } }],
      {
        minThicknessMm: 0.8,
        maxThicknessMm,
        rimThicknessMm,
        backingThicknessMm: rimThicknessMm,
        rimWidthMm: 0.3,
        targetEdgeMm: 2,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const radii = Array.from({ length: position.count }, (_, index) => Math.hypot(
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      ));
      const expectedRimRadius = descriptor.outerRadius - maxThicknessMm + rimThicknessMm;
      assert.ok(Math.abs(Math.max(...radii) - expectedRimRadius) < 1e-4);
      assert.ok(Math.abs(geometry.userData.sphericalPanel.backingThicknessMm - 1.39) < 1e-9);
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('keeps the formerly failing lower tiles manifold in compact four-piece panels', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 200,
      bottomOpeningDiameterMm: 240,
      around: 26,
      bands: 10,
      twist: 0.01,
      jointClearanceMm: 0,
      explode: 0,
    }, [1, 1]);
    const formerlyFailingTiles = new Set(['2:200', '1:227', '2:201', '1:228', '2:202', '1:229']);
    const panels = partitionSpiralTilesByPieceCount(descriptors, {
      targetPieceCount: 4,
    }).filter(({ tiles }) => tiles.some(({ spiral, order }) => (
      formerlyFailingTiles.has(`${spiral}:${order}`)
    )));
    assert.equal(
      panels.flatMap(({ tiles }) => tiles).filter(({ spiral, order }) => (
        formerlyFailingTiles.has(`${spiral}:${order}`)
      )).length,
      formerlyFailingTiles.size,
    );
    for (const panel of panels) {
      const geometry = createSphericalPanelGeometry(
        panel.tiles.map((descriptor) => ({
          descriptor,
          brightnessSampler: {
            sampleBrightness: (u, v) => (Math.floor(u * 8) + Math.floor(v * 8)) % 2,
          },
        })),
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3.5,
          rimThicknessMm: 3.5,
          backingThicknessMm: 2.5,
          glueAllowanceMm: 1.2,
          rimWidthMm: 0.3,
          targetEdgeMm: 0.5,
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const geometryIndex = geometry.getIndex();
        assert.ok(geometryIndex);
        const diagnostics = validateClosedSolid({
          positions: position.array as Float32Array,
          indices: geometryIndex.array as Uint16Array | Uint32Array,
        });
        assert.equal(diagnostics.connectedComponents, 1, panel.id);
        assert.ok(diagnostics.signedVolume > 0, panel.id);
        const radii = Array.from({ length: position.count }, (_, index) => Math.hypot(
          position.getX(index),
          position.getY(index),
          position.getZ(index),
        ));
        assert.ok(radii.some((radius) => Math.abs(radius - 296.5) < 1e-4), panel.id);
        assert.ok(radii.some((radius) => Math.abs(radius - 295.3) < 1e-4), panel.id);
      } finally {
        geometry.dispose();
      }
    }
  });

  await t.test('exports the complete compact four-piece panel set in matching spherical assembly coordinates', () => {
    const radiusMm = 300;
    const maxThicknessMm = 3.5;
    const backingThicknessMm = 2.5;
    const glueAllowanceMm = 1.2;
    const topOpeningDiameterMm = 200;
    const bottomOpeningDiameterMm = 240;
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: radiusMm * 2,
      topOpeningDiameterMm,
      bottomOpeningDiameterMm,
      around: 26,
      bands: 10,
      twist: 0.01,
      jointClearanceMm: 0,
      explode: 0,
    }, [0, 0]);
    const panels = partitionSpiralTilesByPieceCount(descriptors, {
      targetPieceCount: 4,
    });
    assert.ok(panels.every(({ tiles }) => tiles.length >= 1 && tiles.length <= 4));
    assert.ok(
      panels.filter(({ tiles }) => tiles.length === 4).length >= panels.length * 0.9,
      'most panels should reach the requested four-piece maximum',
    );
    const coordinateKey = (point: THREE.Vector3): string => (
      `${point.x.toFixed(4)}:${point.y.toFixed(4)}:${point.z.toFixed(4)}`
    );
    const undirectedEdgeKey = (start: THREE.Vector3, end: THREE.Vector3): string => {
      const startKey = coordinateKey(start);
      const endKey = coordinateKey(end);
      return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
    };
    type EdgeOwner = Readonly<{
      panelId: string;
      start: THREE.Vector3;
      end: THREE.Vector3;
    }>;
    const edgeOwners = new Map<string, EdgeOwner[]>();
    const tileOwners = new Map<string, string>();
    for (const panel of panels) {
      for (const descriptor of panel.tiles) {
        const tileKey = `${descriptor.spiral}:${descriptor.order}`;
        assert.equal(tileOwners.has(tileKey), false, `${tileKey} must occur in only one panel`);
        tileOwners.set(tileKey, panel.id);
        for (let edgeIndex = 0; edgeIndex < descriptor.assemblyOutline.length; edgeIndex += 1) {
          const start = descriptor.assemblyOutline[edgeIndex].position;
          const end = descriptor.assemblyOutline[
            (edgeIndex + 1) % descriptor.assemblyOutline.length
          ].position;
          assert.ok(Number.isFinite(start.length()) && start.length() > 0);
          const key = undirectedEdgeKey(start, end);
          edgeOwners.set(key, [...(edgeOwners.get(key) ?? []), { panelId: panel.id, start, end }]);
        }
      }
    }
    assert.equal(tileOwners.size, descriptors.length, 'every source tile must be exported exactly once');

    const interfaceEdges: EdgeOwner[][] = [];
    const openingEdges: EdgeOwner[] = [];
    for (const owners of edgeOwners.values()) {
      assert.ok(owners.length === 1 || owners.length === 2, 'assembly edges must be manifold');
      if (owners.length === 1) {
        openingEdges.push(owners[0]);
        continue;
      }
      assert.equal(coordinateKey(owners[0].start), coordinateKey(owners[1].end));
      assert.equal(coordinateKey(owners[0].end), coordinateKey(owners[1].start));
      if (owners[0].panelId === owners[1].panelId) continue;
      interfaceEdges.push(owners);
    }
    assert.ok(interfaceEdges.length > panels.length, 'expected seams between the exported panels');
    assert.ok(openingEdges.length > 0, 'expected top and bottom opening boundaries');
    const topOpeningY = Math.sqrt(radiusMm ** 2 - (topOpeningDiameterMm * 0.5) ** 2);
    const bottomOpeningY = -Math.sqrt(radiusMm ** 2 - (bottomOpeningDiameterMm * 0.5) ** 2);
    const openingNeighbors = new Map<string, Set<string>>();
    const openingPoints = new Map<string, THREE.Vector3>();
    for (const { start, end } of openingEdges) {
      const startKey = coordinateKey(start);
      const endKey = coordinateKey(end);
      openingPoints.set(startKey, start);
      openingPoints.set(endKey, end);
      openingNeighbors.set(startKey, new Set([...(openingNeighbors.get(startKey) ?? []), endKey]));
      openingNeighbors.set(endKey, new Set([...(openingNeighbors.get(endKey) ?? []), startKey]));
    }
    for (const [point, neighbors] of openingNeighbors) {
      assert.equal(neighbors.size, 2, `opening boundary must not branch or stop at ${point}`);
    }
    const openingComponents: string[][] = [];
    const visitedOpeningPoints = new Set<string>();
    for (const start of openingNeighbors.keys()) {
      if (visitedOpeningPoints.has(start)) continue;
      const component: string[] = [];
      const pending = [start];
      while (pending.length > 0) {
        const current = pending.pop();
        if (!current || visitedOpeningPoints.has(current)) continue;
        visitedOpeningPoints.add(current);
        component.push(current);
        pending.push(...openingNeighbors.get(current) ?? []);
      }
      openingComponents.push(component);
    }
    assert.equal(openingComponents.length, 2, 'the assembled sphere must have only two opening loops');
    const topOpening = openingComponents.find((component) => component.every((key) => (
      (openingPoints.get(key)?.y ?? 0) > 0
    )));
    const bottomOpening = openingComponents.find((component) => component.every((key) => (
      (openingPoints.get(key)?.y ?? 0) < 0
    )));
    assert.ok(topOpening, 'one closed opening loop must surround the north pole');
    assert.ok(bottomOpening, 'one closed opening loop must surround the south pole');
    assert.ok(topOpening.some((key) => Math.abs((openingPoints.get(key)?.y ?? 0) - topOpeningY) < 1e-6));
    assert.ok(bottomOpening.some((key) => Math.abs((openingPoints.get(key)?.y ?? 0) - bottomOpeningY) < 1e-6));

    const exporter = new STLExporter();
    const stlVerticesByPanel = new Map<string, THREE.Vector3[]>();
    for (const panel of panels) {
      const geometry = createSphericalPanelGeometry(
        panel.tiles.map((descriptor) => ({ descriptor })),
        {
          minThicknessMm: 0.8,
          maxThicknessMm,
          rimThicknessMm: maxThicknessMm,
          backingThicknessMm,
          glueAllowanceMm,
          rimWidthMm: 0.3,
          // Assembly matching is independent of relief sampling density. Keep
          // the complete compact-panel export regression fast enough for every test run.
          targetEdgeMm: 12,
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const geometryIndex = geometry.getIndex();
        assert.ok(geometryIndex);
        const diagnostics = validateClosedSolid({
          positions: position.array as Float32Array,
          indices: geometryIndex.array as Uint16Array | Uint32Array,
        });
        assert.equal(diagnostics.connectedComponents, 1, panel.id);
        assert.ok(diagnostics.signedVolume > 0, panel.id);

        const exported = exporter.parse(new THREE.Mesh(geometry), { binary: true });
        assert.notEqual(typeof exported, 'string');
        const bytes = new Uint8Array(exported.buffer, exported.byteOffset, exported.byteLength);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const triangleCount = view.getUint32(80, true);
        assert.equal(bytes.byteLength, 84 + triangleCount * 50, panel.id);
        const exportedVertices = new Map<string, THREE.Vector3>();
        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
          const triangleOffset = 84 + triangle * 50;
          for (let vertex = 0; vertex < 3; vertex += 1) {
            const vertexOffset = triangleOffset + 12 + vertex * 12;
            const point = new THREE.Vector3(
              view.getFloat32(vertexOffset, true),
              view.getFloat32(vertexOffset + 4, true),
              view.getFloat32(vertexOffset + 8, true),
            );
            const pointRadius = point.length();
            assert.ok(Number.isFinite(pointRadius), `${panel.id} must export finite STL coordinates`);
            assert.ok(pointRadius <= radiusMm + 1e-3, `${panel.id} must stay inside the outer sphere`);
            assert.ok(
              pointRadius >= radiusMm - maxThicknessMm - glueAllowanceMm - 1e-3,
              `${panel.id} must not extend past the configured inward glue allowance`,
            );
            exportedVertices.set(coordinateKey(point), point);
          }
        }
        stlVerticesByPanel.set(panel.id, [...exportedVertices.values()]);
      } finally {
        geometry.dispose();
      }
    }

    const backingRadius = radiusMm - maxThicknessMm + backingThicknessMm;
    const glueInnerRadius = radiusMm - maxThicknessMm - glueAllowanceMm;
    for (const owners of interfaceEdges) {
      const expectedInterfaceVertices = [
        owners[0].start.clone().setLength(backingRadius),
        owners[0].end.clone().setLength(backingRadius),
        owners[0].start.clone().setLength(glueInnerRadius),
        owners[0].end.clone().setLength(glueInnerRadius),
      ];
      for (const owner of owners) {
        const stlVertices = stlVerticesByPanel.get(owner.panelId);
        assert.ok(stlVertices);
        for (const expected of expectedInterfaceVertices) {
          const nearestDistance = Math.sqrt(stlVertices.reduce(
            (nearest, actual) => Math.min(nearest, actual.distanceToSquared(expected)),
            Number.POSITIVE_INFINITY,
          ));
          assert.ok(
            nearestDistance <= 2e-4,
            `${owner.panelId} assembly vertex differs by ${nearestDistance} mm at ${coordinateKey(expected)}`,
          );
        }
      }
    }
  });

  await t.test('builds a default polar panel with textured relief as one closed curved solid', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [1, 1]);
    const panels = partitionSpiralTiles(descriptors, 30, 30, {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    });
    const panel = panels.find(({ band, sector }) => band === 0 && sector === 0);
    assert.ok(panel);
    const geometry = createSphericalPanelGeometry(
      panel.tiles.map((descriptor) => ({
        descriptor,
        brightnessSampler: {
          sampleBrightness: (u, v) => (Math.floor(u * 8) + Math.floor(v * 8)) % 2,
        },
      })),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        backingThicknessMm: 0.6,
        rimWidthMm: 0.3,
        targetEdgeMm: 1.5,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      const diagnostics = validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      });
      assert.equal(diagnostics.connectedComponents, 1);
      assert.ok(diagnostics.signedVolume > 0);
    } finally {
      geometry.dispose();
    }
  });

  await t.test('avoids collinear triangles in a curved panel backing annulus', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 360,
      bottomOpeningDiameterMm: 440,
      around: 28,
      bands: 40,
      twist: -0.2704618386924267,
      jointClearanceMm: 0.7,
      explode: 0,
    }, [1, 1]);
    const descriptor = descriptors.find(({ spiral, order }) => spiral === 1 && order === 230);
    assert.ok(descriptor);
    const geometry = createSphericalPanelGeometry(
      [{
        descriptor,
        brightnessSampler: { sampleBrightness: () => 0.5 },
      }],
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3,
        backingThicknessMm: 0.6,
        rimWidthMm: 0.3,
        targetEdgeMm: 1.8,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('keeps zero-clearance high-resolution neighboring reliefs disjoint', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 200,
      bottomOpeningDiameterMm: 240,
      around: 26,
      bands: 10,
      twist: 0.01,
      jointClearanceMm: 0,
      explode: 0,
    }, [1, 1]);
    const panel = partitionSpiralTiles(descriptors, 26, 10, {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    }).find(({ band, sector }) => band === 0 && sector === 0);
    assert.ok(panel);
    const geometry = createSphericalPanelGeometry(
      panel.tiles.map((descriptor) => ({
        descriptor,
        brightnessSampler: { sampleBrightness: () => 0.5 },
      })),
      {
        minThicknessMm: 0.8,
        maxThicknessMm: 3.5,
        backingThicknessMm: 0.6,
        rimWidthMm: 0.3,
        targetEdgeMm: 0.5,
      },
    );
    try {
      const position = geometry.getAttribute('position');
      const geometryIndex = geometry.getIndex();
      assert.ok(geometryIndex);
      assert.doesNotThrow(() => validateClosedSolid({
        positions: position.array as Float32Array,
        indices: geometryIndex.array as Uint16Array | Uint32Array,
      }));
    } finally {
      geometry.dispose();
    }
  });

  await t.test('rejects spherical panel geometry that reaches an unclipped pole', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 200,
      topOpeningDiameterMm: 0,
      bottomOpeningDiameterMm: 0,
      around: 12,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    const panel = partitionSpiralTiles(descriptors, 12, 10, {
      verticalDivisions: 5,
      sectorsPerBand: 6,
      staggerSeams: true,
    }).find(({ tiles }) => tiles.some(({ assemblyOutline, outerRadius }) => (
      assemblyOutline.some(({ position }) => Math.abs(Math.abs(position.y) - outerRadius) <= 1e-7)
    )));
    assert.ok(panel);
    assert.throws(() => createSphericalPanelGeometry(
        panel.tiles.map((descriptor) => ({ descriptor })),
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3,
          backingThicknessMm: 0.6,
          rimWidthMm: 0.3,
          targetEdgeMm: 5,
        },
      ),
      /requires non-zero top and bottom polar openings/i,
    );
  });

  await t.test('aligns texture horizontal and vertical axes to the floor and world Y', () => {
    const positions = [
      new THREE.Vector3(0, 2, 100),
      new THREE.Vector3(2, 0, 100),
      new THREE.Vector3(0, -2, 100),
      new THREE.Vector3(-2, 0, 100),
    ];
    const uvs = createFloorAlignedTileUvs(positions, new THREE.Vector3(0, 0, 100));
    assert.deepEqual(
      uvs.map((uv) => [Number(uv.x.toFixed(6)), Number(uv.y.toFixed(6))]),
      [[0.5, 1], [1, 0.5], [0.5, 0], [0, 0.5]],
    );
  });

  await t.test('clips the top and bottom openings at independent diameters', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 0,
      bottomOpeningDiameterMm: 240,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    const yValues = descriptors.flatMap((tile) => (
      tile.outline.map((vertex) => vertex.position.y)
    ));
    const bottomCapY = -Math.sqrt(300 * 300 - 120 * 120);
    assert.ok(Math.max(...yValues) > 295, 'a zero-size top opening must retain the north pole');
    assert.ok(Math.min(...yValues) >= bottomCapY - 1e-6, 'the bottom opening must use its own cap');
    assert.ok(Math.min(...yValues) < -270, 'tiles must reach the configured bottom cap');
  });

  await t.test('builds every ten-band tile as a closed printable solid', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 10,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [0, 0]);
    assert.ok(descriptors.length > 500);
    for (const tile of descriptors) {
      const geometry = createLithophaneTileGeometry(
        tile.outline,
        tile.outwardCenter,
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3,
          rimWidthMm: 0.3,
          targetEdgeMm: 5,
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        assert.ok(index, `missing index for ${tile.order}-s${tile.spiral}`);
        validateClosedSolid({
          positions: position.array as Float32Array,
          indices: index.array as Uint16Array | Uint32Array,
        });
      } catch (error) {
        assert.fail(`${tile.order}-s${tile.spiral}: ${String(error)}`);
      } finally {
        geometry.dispose();
      }
    }
  });

  await t.test('builds every default polar-clipped tile as a closed lithophane solid', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [1, 1]);
    for (const tile of descriptors) {
      const geometry = createLithophaneTileGeometry(
        tile.outline,
        tile.outwardCenter,
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3,
          rimWidthMm: 0.3,
          targetEdgeMm: 1.5,
          brightnessSampler: { sampleBrightness: () => 1 },
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        assert.ok(index, `missing index for ${tile.order}-s${tile.spiral}`);
        assert.equal(
          geometry.userData.lithophane.textured,
          true,
          `${tile.order}-s${tile.spiral} must retain its assigned texture`,
        );
        assert.ok(
          Array.from(
            { length: position.count },
            (_, vertexIndex) => position.getZ(vertexIndex),
          ).some((z) => Math.abs(z - 0.8) < 1e-4),
          `${tile.order}-s${tile.spiral} must contain white-image relief`,
        );
        validateClosedSolid({
          positions: position.array as Float32Array,
          indices: index.array as Uint16Array | Uint32Array,
        });
      } catch (error) {
        assert.fail(`${tile.order}-s${tile.spiral}: ${String(error)}`);
      } finally {
        geometry.dispose();
      }
    }
  });

  await t.test('keeps adaptive polar rims clear of high-contrast relief and side bevels', () => {
    const descriptors = generateSpiralTileDescriptors({
      diameterMm: 600,
      topOpeningDiameterMm: 120,
      bottomOpeningDiameterMm: 120,
      around: 30,
      bands: 30,
      twist: 0.18,
      jointClearanceMm: 0.3,
      explode: 0,
    }, [1, 1]);
    const formerlyIntersectingTiles = [
      [1, 58],
      [1, 59],
      [1, 842],
      [1, 843],
      [2, 57],
      [2, 813],
    ] as const;

    for (const [spiral, order] of formerlyIntersectingTiles) {
      const tile = descriptors.find((descriptor) => (
        descriptor.spiral === spiral && descriptor.order === order
      ));
      assert.ok(tile, `missing regression tile ${order}-s${spiral}`);
      const geometry = createLithophaneTileGeometry(
        tile.outline,
        tile.outwardCenter,
        {
          minThicknessMm: 0.8,
          maxThicknessMm: 3,
          rimWidthMm: 0.3,
          targetEdgeMm: 0.5,
          brightnessSampler: {
            sampleBrightness: (u, v) => (
              (Math.floor(u * 16) + Math.floor(v * 16)) % 2
            ),
          },
        },
      );
      try {
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        assert.ok(index);
        assert.ok(
          geometry.userData.lithophane.rimWidthMm < 0.3,
          `${order}-s${spiral} must exercise an adaptive rim`,
        );
        assert.doesNotThrow(() => validateClosedSolid({
          positions: position.array as Float32Array,
          indices: index.array as Uint16Array | Uint32Array,
        }), `${order}-s${spiral} must not intersect its beveled sides`);
      } finally {
        geometry.dispose();
      }
    }
  });
}
