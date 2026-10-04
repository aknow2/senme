import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackupZip,
  readBackupZip,
} from '../../backupArchive';

export async function registerTests(t: TestContext): Promise<void> {
  await t.test('round-trips settings and ordered spiral images through a standard ZIP archive', () => {
    const settings = {
      diameterMm: 600,
      panelTargetPieceCount: 4,
      panelBackingThicknessMm: 2.5,
      panelGlueAllowanceMm: 1.2,
    };
    const textures = [
      {
        spiral: 1 as const,
        order: 0,
        name: '目-01.png',
        mimeType: 'image/png' as const,
        bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      },
      {
        spiral: 2 as const,
        order: 0,
        name: 'eye-02.jpg',
        mimeType: 'image/jpeg' as const,
        bytes: new Uint8Array([255, 216, 4, 5, 255, 217]),
      },
    ];
    const exportedAt = '2026-08-04T12:34:56.000Z';
    const zip = createBackupZip(settings, textures, exportedAt);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(new TextDecoder().decode(zip).includes(BACKUP_FORMAT), true);
    assert.equal(new TextDecoder().decode(zip).includes(`"version": ${BACKUP_VERSION}`), true);

    const restored = readBackupZip(zip);
    assert.deepEqual(restored.settings, settings);
    assert.equal(restored.exportedAt, exportedAt);
    assert.deepEqual(restored.textures, textures);
  });

  await t.test('rejects a ZIP whose stored content fails its checksum', () => {
    const zip = createBackupZip({}, [], '2026-08-04T00:00:00.000Z');
    const corrupted = zip.slice();
    const view = new DataView(corrupted.buffer);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const firstDataOffset = 30 + nameLength + extraLength;
    corrupted[firstDataOffset] ^= 0xff;
    assert.throws(() => readBackupZip(corrupted), /checksum failed/);
  });

  await t.test('rejects non-contiguous image ordering before export', () => {
    assert.throws(() => createBackupZip({}, [{
      spiral: 1,
      order: 1,
      name: 'late.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1]),
    }]), /contiguous/);
  });

  await t.test('wires ZIP export and import controls to atomic browser persistence', async () => {
    const [html, mainSource, persistenceSource] = await Promise.all([
      readFile(new URL('../../index.html', import.meta.url), 'utf8'),
      readFile(new URL('../../main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../persistence.ts', import.meta.url), 'utf8'),
    ]);
    for (const id of [
      'export-project-backup',
      'import-project-backup',
      'project-backup-status',
    ]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(mainSource, /createBackupZip\(/);
    assert.match(mainSource, /readBackupZip\(/);
    assert.match(mainSource, /replaceStoredTextureRecords\(records\)/);
    assert.match(persistenceSource, /store\.clear\(\)/);
    assert.match(persistenceSource, /for \(const record of records\) store\.put\(record\)/);
  });
}
