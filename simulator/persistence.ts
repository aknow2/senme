export type PersistedPolyhedronSettings = {
  diameterMm: number;
  tileThicknessMm: number;
  lithophaneMinThicknessMm: number;
  lithophaneRimThicknessMm: number;
  lithophaneResolutionMm: number;
  topOpeningDiameterMm: number;
  bottomOpeningDiameterMm: number;
  around: number;
  bands: number;
  twist: number;
  jointClearanceMm: number;
  stlExportMode: 'individual' | 'panels';
  panelTargetPieceCount: number;
  panelBackingThicknessMm: number;
  panelGlueAllowanceMm: number;
  explode: number;
  rotationSpeedDegPerSec: number;
  refreshRateHz: number;
  autoRotate: boolean;
};

export type StoredTextureRecord = {
  id: number;
  spiral: 1 | 2;
  order: number;
  name: string;
  blob: Blob;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const POLYHEDRON_SETTINGS_STORAGE_KEY = 'rhombic-double-spiral:settings:v1';

export const DEFAULT_POLYHEDRON_SETTINGS: Readonly<PersistedPolyhedronSettings> = {
  diameterMm: 600,
  tileThicknessMm: 3,
  lithophaneMinThicknessMm: 0.8,
  lithophaneRimThicknessMm: 3,
  lithophaneResolutionMm: 1.5,
  topOpeningDiameterMm: 120,
  bottomOpeningDiameterMm: 120,
  around: 30,
  bands: 30,
  twist: 0.18,
  jointClearanceMm: 0.3,
  stlExportMode: 'individual',
  panelTargetPieceCount: 4,
  panelBackingThicknessMm: 0.6,
  panelGlueAllowanceMm: 0,
  explode: 0,
  rotationSpeedDegPerSec: 10,
  refreshRateHz: 60,
  autoRotate: true,
};

function clampedStep(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  step: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(maximum, Math.max(minimum, value));
  const stepped = Math.round((clamped - minimum) / step) * step + minimum;
  return Number(stepped.toFixed(6));
}

export function normalizePolyhedronSettings(value: unknown): PersistedPolyhedronSettings {
  const source = typeof value === 'object' && value !== null
    ? value as Partial<PersistedPolyhedronSettings> & { polarOpeningDiameterMm?: unknown }
    : {};
  const diameterMm = clampedStep(source.diameterMm, 600, 300, 1_000, 10);
  const tileThicknessMm = clampedStep(source.tileThicknessMm, 3, 1, 10, 0.5);
  const minimumThicknessMaximum = Math.max(0.2, tileThicknessMm - 0.1);
  const lithophaneMinThicknessMm = clampedStep(
    source.lithophaneMinThicknessMm,
    Math.min(0.8, minimumThicknessMaximum),
    0.2,
    minimumThicknessMaximum,
    0.1,
  );
  const lithophaneRimThicknessMm = clampedStep(
    source.lithophaneRimThicknessMm,
    tileThicknessMm,
    lithophaneMinThicknessMm,
    tileThicknessMm,
    0.1,
  );
  const polarOpeningMaximum = Math.floor((diameterMm * 0.8) / 10) * 10;
  const legacyOpeningDiameterMm = source.polarOpeningDiameterMm;
  const topOpeningDiameterMm = source.topOpeningDiameterMm ?? legacyOpeningDiameterMm;
  const bottomOpeningDiameterMm = source.bottomOpeningDiameterMm ?? legacyOpeningDiameterMm;

  return {
    diameterMm,
    tileThicknessMm,
    lithophaneMinThicknessMm,
    lithophaneRimThicknessMm,
    lithophaneResolutionMm: clampedStep(
      source.lithophaneResolutionMm,
      1.5,
      0.5,
      3,
      0.1,
    ),
    topOpeningDiameterMm: clampedStep(
      topOpeningDiameterMm,
      Math.min(120, polarOpeningMaximum),
      0,
      polarOpeningMaximum,
      10,
    ),
    bottomOpeningDiameterMm: clampedStep(
      bottomOpeningDiameterMm,
      Math.min(120, polarOpeningMaximum),
      0,
      polarOpeningMaximum,
      10,
    ),
    around: clampedStep(source.around, 30, 12, 48, 2),
    bands: clampedStep(source.bands, 30, 10, 42, 2),
    twist: clampedStep(source.twist, 0.18, -0.8, 0.8, 0.01),
    jointClearanceMm: clampedStep(source.jointClearanceMm, 0.3, 0, 1, 0.05),
    stlExportMode: source.stlExportMode === 'panels' ? 'panels' : 'individual',
    panelTargetPieceCount: clampedStep(source.panelTargetPieceCount, 4, 1, 64, 1),
    panelBackingThicknessMm: clampedStep(
      source.panelBackingThicknessMm,
      Math.min(0.6, lithophaneRimThicknessMm),
      0.1,
      lithophaneRimThicknessMm,
      0.1,
    ),
    panelGlueAllowanceMm: clampedStep(source.panelGlueAllowanceMm, 0, 0, 10, 0.1),
    explode: clampedStep(source.explode, 0, 0, 7, 0.2),
    rotationSpeedDegPerSec: clampedStep(
      source.rotationSpeedDegPerSec,
      10,
      0,
      360,
      1,
    ),
    refreshRateHz: clampedStep(source.refreshRateHz, 60, 10, 120, 5),
    autoRotate: typeof source.autoRotate === 'boolean' ? source.autoRotate : true,
  };
}

export function loadPolyhedronSettings(
  storage: StorageLike | null,
): PersistedPolyhedronSettings {
  if (!storage) return { ...DEFAULT_POLYHEDRON_SETTINGS };
  try {
    const stored = storage.getItem(POLYHEDRON_SETTINGS_STORAGE_KEY);
    return stored
      ? normalizePolyhedronSettings(JSON.parse(stored) as unknown)
      : { ...DEFAULT_POLYHEDRON_SETTINGS };
  } catch {
    return { ...DEFAULT_POLYHEDRON_SETTINGS };
  }
}

export function savePolyhedronSettings(
  storage: StorageLike | null,
  settings: PersistedPolyhedronSettings,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(POLYHEDRON_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

const TEXTURE_DATABASE_NAME = 'rhombic-double-spiral';
const TEXTURE_STORE_NAME = 'textures';
let textureDatabasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

function openTextureDatabase(): Promise<IDBDatabase> {
  if (textureDatabasePromise) return textureDatabasePromise;
  textureDatabasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TEXTURE_DATABASE_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(TEXTURE_STORE_NAME)) {
        request.result.createObjectStore(TEXTURE_STORE_NAME, { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Texture database upgrade was blocked.')), {
      once: true,
    });
  }).catch((error: unknown) => {
    textureDatabasePromise = null;
    throw error;
  });
  return textureDatabasePromise;
}

export async function loadStoredTextureRecords(): Promise<StoredTextureRecord[]> {
  const database = await openTextureDatabase();
  const transaction = database.transaction(TEXTURE_STORE_NAME, 'readonly');
  const completed = transactionComplete(transaction);
  const [records] = await Promise.all([
    requestResult(
      transaction.objectStore(TEXTURE_STORE_NAME).getAll() as IDBRequest<StoredTextureRecord[]>,
    ),
    completed,
  ]);
  return records.sort((left, right) => (
    left.spiral - right.spiral
    || left.order - right.order
    || left.id - right.id
  ));
}

export async function saveStoredTextureRecords(
  records: readonly StoredTextureRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const database = await openTextureDatabase();
  const transaction = database.transaction(TEXTURE_STORE_NAME, 'readwrite');
  const completed = transactionComplete(transaction);
  const store = transaction.objectStore(TEXTURE_STORE_NAME);
  for (const record of records) store.put(record);
  await completed;
}

export async function replaceStoredTextureRecords(
  records: readonly StoredTextureRecord[],
): Promise<void> {
  const database = await openTextureDatabase();
  const transaction = database.transaction(TEXTURE_STORE_NAME, 'readwrite');
  const completed = transactionComplete(transaction);
  const store = transaction.objectStore(TEXTURE_STORE_NAME);
  store.clear();
  for (const record of records) store.put(record);
  await completed;
}

export async function deleteStoredTextureRecord(id: number): Promise<void> {
  const database = await openTextureDatabase();
  const transaction = database.transaction(TEXTURE_STORE_NAME, 'readwrite');
  const completed = transactionComplete(transaction);
  transaction.objectStore(TEXTURE_STORE_NAME).delete(id);
  await completed;
}

export async function clearStoredTextureRecords(): Promise<void> {
  const database = await openTextureDatabase();
  const transaction = database.transaction(TEXTURE_STORE_NAME, 'readwrite');
  const completed = transactionComplete(transaction);
  transaction.objectStore(TEXTURE_STORE_NAME).clear();
  await completed;
}
