export const BACKUP_FORMAT = '360li-experimental-project';
export const BACKUP_VERSION = 1;

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TEXTURE_BYTES = 64 * 1024 * 1024;
const MAX_TEXTURE_COUNT = 1_000;
const UTF8_FLAG = 0x0800;

export type BackupTexture = Readonly<{
  spiral: 1 | 2;
  order: number;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}>;

export type BackupArchive = Readonly<{
  settings: unknown;
  textures: BackupTexture[];
  exportedAt: string;
}>;

type ManifestTexture = Readonly<{
  path: string;
  spiral: 1 | 2;
  order: number;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
}>;

type BackupManifest = Readonly<{
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  settingsPath: 'settings.json';
  textures: ManifestTexture[];
}>;

type ZipEntry = Readonly<{ name: string; data: Uint8Array }>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) === 0 ? crc >>> 1 : 0xedb88320 ^ (crc >>> 1);
      }
      crcTable[value] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (length > MAX_ARCHIVE_BYTES) throw new Error('Backup ZIP exceeds the 512 MB limit.');
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function uint32Fits(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

function createStoredZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Backup ZIP contains too many files.');
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const names = new Set<string>();
  let localOffset = 0;

  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate backup path: ${entry.name}`);
    names.add(entry.name);
    const name = textEncoder.encode(entry.name);
    const size = entry.data.byteLength;
    if (name.byteLength > 0xffff || !uint32Fits(size) || !uint32Fits(localOffset)) {
      throw new Error('Backup ZIP is too large for the supported ZIP format.');
    }
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    localChunks.push(local, entry.data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.byteLength + size;
  }

  const centralDirectory = concatenate(centralChunks);
  if (!uint32Fits(localOffset) || !uint32Fits(centralDirectory.byteLength)) {
    throw new Error('Backup ZIP is too large for the supported ZIP format.');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localOffset, true);
  return concatenate([...localChunks, centralDirectory, end]);
}

function texturePath(texture: Pick<BackupTexture, 'spiral' | 'order' | 'mimeType'>): string {
  const extension = texture.mimeType === 'image/png' ? 'png' : 'jpg';
  return `textures/spiral-${texture.spiral}/${String(texture.order + 1).padStart(4, '0')}.${extension}`;
}

function validateTextures(textures: readonly BackupTexture[]): void {
  if (textures.length > MAX_TEXTURE_COUNT) throw new Error('Backup contains more than 1000 images.');
  const orders: [Set<number>, Set<number>] = [new Set(), new Set()];
  for (const texture of textures) {
    if (texture.spiral !== 1 && texture.spiral !== 2) throw new Error('Invalid texture spiral.');
    if (!Number.isSafeInteger(texture.order) || texture.order < 0) throw new Error('Invalid texture order.');
    if (orders[texture.spiral - 1].has(texture.order)) throw new Error('Duplicate texture order.');
    orders[texture.spiral - 1].add(texture.order);
    if (typeof texture.name !== 'string' || texture.name.length === 0 || texture.name.length > 512) {
      throw new Error('Invalid texture name.');
    }
    if (texture.mimeType !== 'image/png' && texture.mimeType !== 'image/jpeg') {
      throw new Error('Unsupported texture format.');
    }
    if (texture.bytes.byteLength === 0 || texture.bytes.byteLength > MAX_TEXTURE_BYTES) {
      throw new Error('Texture file is empty or exceeds the 64 MB limit.');
    }
  }
  for (const spiralOrders of orders) {
    const sorted = [...spiralOrders].sort((left, right) => left - right);
    if (sorted.some((order, index) => order !== index)) {
      throw new Error('Texture orders must be contiguous and start at zero.');
    }
  }
}

export function createBackupZip(
  settings: unknown,
  textures: readonly BackupTexture[],
  exportedAt = new Date().toISOString(),
): Uint8Array {
  validateTextures(textures);
  if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) {
    throw new Error('Invalid backup export timestamp.');
  }
  const sortedTextures = [...textures].sort((left, right) => (
    left.spiral - right.spiral || left.order - right.order
  ));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    settingsPath: 'settings.json',
    textures: sortedTextures.map((texture) => ({
      path: texturePath(texture),
      spiral: texture.spiral,
      order: texture.order,
      name: texture.name,
      mimeType: texture.mimeType,
    })),
  };
  const manifestBytes = textEncoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const settingsBytes = textEncoder.encode(`${JSON.stringify(settings, null, 2)}\n`);
  if (manifestBytes.byteLength > MAX_JSON_BYTES || settingsBytes.byteLength > MAX_JSON_BYTES) {
    throw new Error('Backup metadata exceeds the 1 MB limit.');
  }
  return createStoredZip([
    { name: 'manifest.json', data: manifestBytes },
    { name: 'settings.json', data: settingsBytes },
    ...sortedTextures.map((texture) => ({
      name: texturePath(texture),
      data: texture.bytes,
    })),
  ]);
}

function safeZipPath(name: string): boolean {
  return name.length > 0
    && !name.includes('\\')
    && !name.startsWith('/')
    && !name.includes('\0')
    && name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 22 - 0xffff);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('The selected file is not a supported ZIP archive.');
}

function readStoredZip(input: Uint8Array): Map<string, Uint8Array> {
  if (input.byteLength < 22 || input.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Backup ZIP is empty or exceeds the 512 MB limit.');
  }
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer);
  const endOffset = findEndOfCentralDirectory(bytes);
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (
    disk !== 0
    || centralDisk !== 0
    || diskEntries !== totalEntries
    || totalEntries > MAX_TEXTURE_COUNT + 2
    || endOffset + 22 + commentLength !== bytes.byteLength
    || centralOffset + centralSize !== endOffset
  ) throw new Error('Unsupported or malformed ZIP directory.');

  const result = new Map<string, Uint8Array>();
  let offset = centralOffset;
  let totalSize = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Malformed ZIP central directory.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (
      nextOffset > endOffset
      || (flags & 0x0001) !== 0
      || (flags & 0x0008) !== 0
      || method !== 0
      || compressedSize !== originalSize
    ) throw new Error('Backup ZIP must contain only unencrypted, uncompressed files.');
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!safeZipPath(name) || result.has(name)) throw new Error('Backup ZIP contains an unsafe or duplicate path.');
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('Malformed ZIP local header.');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + originalSize > centralOffset) throw new Error('ZIP entry exceeds its declared bounds.');
    const localName = textDecoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName !== name) throw new Error('ZIP local and central paths do not match.');
    totalSize += originalSize;
    if (totalSize > MAX_ARCHIVE_BYTES) throw new Error('Unpacked backup exceeds the 512 MB limit.');
    const data = bytes.slice(dataOffset, dataOffset + originalSize);
    if (crc32(data) !== checksum) throw new Error(`ZIP checksum failed: ${name}`);
    result.set(name, data);
    offset = nextOffset;
  }
  if (offset !== endOffset) throw new Error('ZIP central directory size does not match its entries.');
  return result;
}

function parseJson(bytes: Uint8Array | undefined, label: string): unknown {
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`${label} is missing or exceeds the 1 MB limit.`);
  }
  try {
    return JSON.parse(textDecoder.decode(bytes)) as unknown;
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
}

function parseManifest(value: unknown): BackupManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid backup manifest.');
  const source = value as Partial<BackupManifest>;
  if (source.format !== BACKUP_FORMAT || source.version !== BACKUP_VERSION) {
    throw new Error('This backup format or version is not supported.');
  }
  if (
    source.settingsPath !== 'settings.json'
    || typeof source.exportedAt !== 'string'
    || !Number.isFinite(Date.parse(source.exportedAt))
    || !Array.isArray(source.textures)
  ) throw new Error('Invalid backup manifest metadata.');
  return source as BackupManifest;
}

export function readBackupZip(input: Uint8Array): BackupArchive {
  const entries = readStoredZip(input);
  const manifest = parseManifest(parseJson(entries.get('manifest.json'), 'manifest.json'));
  const settings = parseJson(entries.get(manifest.settingsPath), manifest.settingsPath);
  const textures = manifest.textures.map((texture): BackupTexture => {
    if (typeof texture !== 'object' || texture === null) throw new Error('Invalid texture manifest entry.');
    if (typeof texture.path !== 'string') throw new Error('Invalid texture manifest path.');
    const bytes = entries.get(texture.path);
    if (!bytes) throw new Error(`Backup image is missing: ${texture.path}`);
    const result: BackupTexture = {
      spiral: texture.spiral,
      order: texture.order,
      name: texture.name,
      mimeType: texture.mimeType,
      bytes,
    };
    if (texturePath(result) !== texture.path) {
      throw new Error('Texture path does not match its manifest order or format.');
    }
    return result;
  });
  validateTextures(textures);
  const expectedPaths = new Set([
    'manifest.json',
    manifest.settingsPath,
    ...textures.map(texturePath),
  ]);
  if (entries.size !== expectedPaths.size || [...entries.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error('Backup ZIP contains files not declared by its manifest.');
  }
  return { settings, textures, exportedAt: manifest.exportedAt };
}
