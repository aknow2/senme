import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import {
  DEFAULT_POLYHEDRON_SETTINGS,
  loadPolyhedronSettings,
  normalizePolyhedronSettings,
  POLYHEDRON_SETTINGS_STORAGE_KEY,
  savePolyhedronSettings,
} from '../../persistence';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

export async function registerTests(t: TestContext): Promise<void> {
  await t.test('round-trips every polyhedron setting through browser storage', () => {
    const storage = createMemoryStorage();
    const settings = normalizePolyhedronSettings({
      ...DEFAULT_POLYHEDRON_SETTINGS,
      diameterMm: 760,
      tileThicknessMm: 4.5,
      lithophaneMinThicknessMm: 1.1,
      lithophaneRimThicknessMm: 2.4,
      lithophaneResolutionMm: 0.9,
      topOpeningDiameterMm: 180,
      bottomOpeningDiameterMm: 240,
      around: 36,
      bands: 34,
      twist: -0.24,
      jointClearanceMm: 0.45,
      stlExportMode: 'panels',
      panelTargetPieceCount: 4,
      panelBackingThicknessMm: 0.7,
      panelGlueAllowanceMm: 3.2,
      explode: 1.4,
      rotationSpeedDegPerSec: 220,
      refreshRateHz: 90,
      autoRotate: false,
    });

    assert.equal(savePolyhedronSettings(storage, settings), true);
    assert.deepEqual(loadPolyhedronSettings(storage), settings);
  });

  await t.test('falls back safely when saved settings are corrupt', () => {
    const storage = createMemoryStorage();
    storage.setItem(POLYHEDRON_SETTINGS_STORAGE_KEY, '{invalid');
    assert.deepEqual(loadPolyhedronSettings(storage), DEFAULT_POLYHEDRON_SETTINGS);
  });

  await t.test('migrates the former shared opening diameter to both openings', () => {
    const restored = normalizePolyhedronSettings({
      ...DEFAULT_POLYHEDRON_SETTINGS,
      topOpeningDiameterMm: undefined,
      bottomOpeningDiameterMm: undefined,
      polarOpeningDiameterMm: 220,
    });
    assert.equal(restored.topOpeningDiameterMm, 220);
    assert.equal(restored.bottomOpeningDiameterMm, 220);
  });

  await t.test('migrates a missing rim height to the former maximum-thickness behavior', () => {
    const restored = normalizePolyhedronSettings({
      ...DEFAULT_POLYHEDRON_SETTINGS,
      tileThicknessMm: 4.5,
      lithophaneRimThicknessMm: undefined,
    });
    assert.equal(restored.lithophaneRimThicknessMm, 4.5);
  });

  await t.test('allows panel backing above minimum thickness up to rim height', () => {
    const restored = normalizePolyhedronSettings({
      ...DEFAULT_POLYHEDRON_SETTINGS,
      lithophaneMinThicknessMm: 0.8,
      lithophaneRimThicknessMm: 2,
      panelBackingThicknessMm: 2,
    });
    assert.equal(restored.panelBackingThicknessMm, 2);
  });

  await t.test('migrates former grid panel settings to a four-piece maximum', () => {
    const restored = normalizePolyhedronSettings({
      ...DEFAULT_POLYHEDRON_SETTINGS,
      panelTargetPieceCount: undefined,
      panelVerticalDivisions: 8,
      panelSectorsPerBand: 9,
      panelStaggerSeams: true,
    });
    assert.equal(restored.panelTargetPieceCount, 4);
    assert.equal('panelVerticalDivisions' in restored, false);
    assert.equal('panelSectorsPerBand' in restored, false);
    assert.equal('panelStaggerSeams' in restored, false);
  });

  await t.test('normalizes restored values to the supported control ranges', () => {
    const restored = normalizePolyhedronSettings({
      diameterMm: 9999,
      tileThicknessMm: 1,
      lithophaneMinThicknessMm: 9,
      lithophaneRimThicknessMm: -5,
      topOpeningDiameterMm: 9999,
      bottomOpeningDiameterMm: -20,
      around: 13,
      bands: 2,
      jointClearanceMm: -5,
      stlExportMode: 'unsupported',
      panelTargetPieceCount: 999,
      panelBackingThicknessMm: 99,
      panelGlueAllowanceMm: 99,
      rotationSpeedDegPerSec: 999,
    });
    assert.equal(restored.diameterMm, 1_000);
    assert.equal(restored.lithophaneMinThicknessMm, 0.9);
    assert.equal(restored.lithophaneRimThicknessMm, 0.9);
    assert.equal(restored.topOpeningDiameterMm, 800);
    assert.equal(restored.bottomOpeningDiameterMm, 0);
    assert.equal(restored.around, 14);
    assert.equal(restored.bands, 10);
    assert.equal(restored.jointClearanceMm, 0);
    assert.equal(restored.stlExportMode, 'individual');
    assert.equal(restored.panelTargetPieceCount, 64);
    assert.equal(restored.panelBackingThicknessMm, 0.9);
    assert.equal(restored.panelGlueAllowanceMm, 10);
    assert.equal(restored.rotationSpeedDegPerSec, 360);
  });
}
